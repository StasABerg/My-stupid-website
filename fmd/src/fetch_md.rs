use anyhow::Result;
use futures_util::StreamExt;
use http::HeaderValue;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;
use tokio::net::lookup_host;
use url::Url;

const MAX_URL_CHARS: usize = 2048;
const MAX_REDIRECT_LOCATION_CHARS: usize = 256;

#[derive(Clone, Debug)]
pub struct FetchLimits {
    pub timeout: Duration,
    pub max_html_bytes: usize,
    pub max_md_bytes: usize,
}

#[derive(Debug)]
pub enum FetchMdError {
    BadRequest(String),
    Forbidden(String),
    UnsupportedMediaType(String),
    TooLarge(String),
    Upstream(String),
}

impl FetchMdError {
    pub fn status_code(&self) -> http::StatusCode {
        match self {
            FetchMdError::BadRequest(_) => http::StatusCode::BAD_REQUEST,
            FetchMdError::Forbidden(_) => http::StatusCode::FORBIDDEN,
            FetchMdError::UnsupportedMediaType(_) => http::StatusCode::UNSUPPORTED_MEDIA_TYPE,
            FetchMdError::TooLarge(_) => http::StatusCode::PAYLOAD_TOO_LARGE,
            FetchMdError::Upstream(_) => http::StatusCode::BAD_GATEWAY,
        }
    }

    pub fn message(&self) -> &'static str {
        "Request failed"
    }

    pub fn detail(&self) -> &str {
        match self {
            FetchMdError::BadRequest(message)
            | FetchMdError::Forbidden(message)
            | FetchMdError::UnsupportedMediaType(message)
            | FetchMdError::TooLarge(message)
            | FetchMdError::Upstream(message) => message.as_str(),
        }
    }
}

pub async fn fetch_markdown(
    url: &str,
    limits: &FetchLimits,
) -> std::result::Result<String, FetchMdError> {
    let parsed = validate_url(url)?;
    let host = parsed
        .host_str()
        .ok_or_else(|| FetchMdError::BadRequest("URL missing hostname".into()))?;
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| FetchMdError::BadRequest("URL missing port".into()))?;
    if port != 80 && port != 443 {
        return Err(FetchMdError::BadRequest(
            "Only ports 80 and 443 are allowed".into(),
        ));
    }

    let addresses = resolve_public_addrs(host, port).await?;
    for addr in addresses.into_iter().take(3) {
        match fetch_html_with_resolved_addr(&parsed, addr, limits).await {
            Ok(html) => return convert_html_to_md(&html, limits),
            Err(FetchMdError::Upstream(_)) => continue,
            Err(other) => return Err(other),
        }
    }

    Err(FetchMdError::Upstream("Upstream fetch failed".into()))
}

fn validate_url(raw: &str) -> std::result::Result<Url, FetchMdError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(FetchMdError::BadRequest("URL is required".into()));
    }
    if trimmed.len() > MAX_URL_CHARS {
        return Err(FetchMdError::BadRequest("URL too long".into()));
    }

    let parsed = Url::parse(trimmed).map_err(|_| FetchMdError::BadRequest("Invalid URL".into()))?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => {
            return Err(FetchMdError::BadRequest(
                "Only http/https URLs are allowed".into(),
            ));
        }
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(FetchMdError::BadRequest(
            "URL credentials are not allowed".into(),
        ));
    }
    if parsed.fragment().is_some() {
        return Err(FetchMdError::BadRequest(
            "URL fragments are not allowed".into(),
        ));
    }

    Ok(parsed)
}

async fn resolve_public_addrs(
    host: &str,
    port: u16,
) -> std::result::Result<Vec<SocketAddr>, FetchMdError> {
    let mut addrs: Vec<SocketAddr> = lookup_host((host, port))
        .await
        .map_err(|_| FetchMdError::BadRequest("Failed to resolve hostname".into()))?
        .filter(|addr| is_public_ip(addr.ip()))
        .collect();

    addrs.sort_by_key(|addr| addr.ip().to_string());
    addrs.dedup_by(|a, b| a.ip() == b.ip() && a.port() == b.port());

    if addrs.is_empty() {
        return Err(FetchMdError::Forbidden(
            "Destination is not publicly routable".into(),
        ));
    }
    Ok(addrs)
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_ipv4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4() {
                return is_public_ipv4(v4);
            }
            is_public_ipv6(v6)
        }
    }
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    let first = octets[0];
    let second = octets[1];

    if ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_multicast()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
    {
        return false;
    }

    // 0.0.0.0/8 (current network)
    if first == 0 {
        return false;
    }

    // 100.64.0.0/10 (carrier-grade NAT)
    if first == 100 && (64..=127).contains(&second) {
        return false;
    }

    // 198.18.0.0/15 (benchmarking)
    if first == 198 && (18..=19).contains(&second) {
        return false;
    }

    // 192.0.0.0/24 (IETF protocol assignments)
    if first == 192 && second == 0 && octets[2] == 0 {
        return false;
    }

    // 240.0.0.0/4 and above (reserved, including 255.0.0.0/8)
    if first >= 240 {
        return false;
    }

    true
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    if ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || ip.is_unicast_link_local()
        || ip.is_unique_local()
    {
        return false;
    }

    // Documentation prefix 2001:db8::/32
    let segments = ip.segments();
    if segments[0] == 0x2001 && segments[1] == 0x0db8 {
        return false;
    }

    // Site-local is deprecated but still non-public; block fec0::/10
    if (segments[0] & 0xffc0) == 0xfec0 {
        return false;
    }

    true
}

async fn fetch_html_with_resolved_addr(
    url: &Url,
    addr: SocketAddr,
    limits: &FetchLimits,
) -> std::result::Result<String, FetchMdError> {
    let host = url
        .host_str()
        .ok_or_else(|| FetchMdError::BadRequest("URL missing hostname".into()))?;
    let client = reqwest::Client::builder()
        .timeout(limits.timeout)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("gitgud.zip fmd")
        .resolve(host, addr)
        .build()
        .map_err(|_| FetchMdError::Upstream("Failed to build HTTP client".into()))?;

    let response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|_| FetchMdError::Upstream("Upstream request failed".into()))?;

    if response.status().is_redirection() {
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        let location = truncate(location, MAX_REDIRECT_LOCATION_CHARS);
        return Err(FetchMdError::BadRequest(format!(
            "Redirects are not allowed (Location: {location})"
        )));
    }

    if !response.status().is_success() {
        return Err(FetchMdError::Upstream(format!(
            "Upstream returned {}",
            response.status()
        )));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !is_allowed_content_type(content_type) {
        return Err(FetchMdError::UnsupportedMediaType(
            "Only HTML pages are supported".into(),
        ));
    }

    let bytes = match read_limited_body(response, limits.max_html_bytes).await {
        Ok(bytes) => bytes,
        Err(error) => {
            return Err(if error.to_string().contains("body too large") {
                FetchMdError::TooLarge("Fetched HTML too large".into())
            } else {
                FetchMdError::Upstream("Failed to read upstream response".into())
            });
        }
    };
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

fn is_allowed_content_type(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let main = lower.split(';').next().unwrap_or("").trim();
    main == "text/html" || main == "application/xhtml+xml"
}

async fn read_limited_body(response: reqwest::Response, max_bytes: usize) -> Result<Vec<u8>> {
    if let Some(len) = response.content_length()
        && len as usize > max_bytes
    {
        return Err(anyhow::anyhow!("body too large"));
    }

    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();
    while let Some(next) = stream.next().await {
        let chunk = next?;
        if buffer.len() + chunk.len() > max_bytes {
            return Err(anyhow::anyhow!("body too large"));
        }
        buffer.extend_from_slice(&chunk);
    }
    Ok(buffer)
}

fn convert_html_to_md(
    html: &str,
    limits: &FetchLimits,
) -> std::result::Result<String, FetchMdError> {
    let sanitized = ammonia::clean(html);
    let extracted = extract_main_html(&sanitized);
    let markdown = html2md::parse_html(&extracted);
    if markdown.len() > limits.max_md_bytes {
        return Err(FetchMdError::TooLarge(
            "Converted markdown too large".into(),
        ));
    }
    Ok(markdown)
}

fn extract_main_html(html: &str) -> String {
    let document = scraper::Html::parse_document(html);
    let candidates = ["main", "article", "[role=\"main\"]"];

    let mut best_html: Option<String> = None;
    let mut best_len: usize = 0;

    for selector in candidates {
        let Ok(sel) = scraper::Selector::parse(selector) else {
            continue;
        };
        for element in document.select(&sel) {
            let text_len: usize = element
                .text()
                .map(|part| part.trim())
                .collect::<String>()
                .len();
            if text_len > best_len {
                best_len = text_len;
                best_html = Some(format!("<div>{}</div>", element.inner_html()));
            }
        }
    }

    if let Some(html) = best_html {
        return html;
    }

    // Fallback: entire body or the whole document if body is missing.
    if let Ok(sel) = scraper::Selector::parse("body")
        && let Some(body) = document.select(&sel).next()
    {
        return format!("<div>{}</div>", body.inner_html());
    }

    html.to_string()
}

fn truncate(value: &str, max: usize) -> String {
    if value.len() <= max {
        return value.to_string();
    }
    value.chars().take(max).collect()
}

pub fn content_type_text_markdown() -> HeaderValue {
    HeaderValue::from_static("text/markdown; charset=utf-8")
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn rejects_non_http_scheme() {
        assert_eq!(
            validate_url("file:///etc/passwd").unwrap_err().detail(),
            "Only http/https URLs are allowed",
        );
    }

    #[test]
    fn rejects_credentials() {
        assert_eq!(
            validate_url("https://user:pass@example.com")
                .unwrap_err()
                .detail(),
            "URL credentials are not allowed",
        );
    }

    #[test]
    fn rejects_fragment() {
        assert_eq!(
            validate_url("https://example.com/#frag")
                .unwrap_err()
                .detail(),
            "URL fragments are not allowed",
        );
    }
}
