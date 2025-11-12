use http::{HeaderMap, HeaderName, HeaderValue};
use std::net::SocketAddr;

const HOP_BY_HOP_HEADERS: [&str; 12] = [
    "connection",
    "keep-alive",
    "proxy-connection",
    "transfer-encoding",
    "upgrade",
    "te",
    "trailer",
    "proxy-authorization",
    "proxy-authenticate",
    "host",
    "content-length",
    "expect",
];

pub fn sanitize_request_headers(headers: &HeaderMap) -> HeaderMap {
    let mut result = HeaderMap::new();
    for (key, value) in headers.iter() {
        let lower = key.as_str().to_ascii_lowercase();
        if HOP_BY_HOP_HEADERS.contains(&lower.as_str()) {
            continue;
        }
        result.insert(key.clone(), value.clone());
    }
    result
}

pub fn sanitize_response_headers(headers: &HeaderMap) -> HeaderMap {
    let mut result = HeaderMap::new();
    for (key, value) in headers.iter() {
        let lower = key.as_str().to_ascii_lowercase();
        if HOP_BY_HOP_HEADERS.contains(&lower.as_str()) {
            continue;
        }
        result.insert(key.clone(), value.clone());
    }
    result
}

pub fn sanitize_headers_for_cache(headers: &HeaderMap) -> HeaderMap {
    let mut filtered = HeaderMap::new();
    for (key, value) in headers.iter() {
        let lower = key.as_str().to_ascii_lowercase();
        if lower == "set-cookie" || lower == "set-cookie2" || lower == "content-length" {
            continue;
        }
        filtered.insert(key.clone(), value.clone());
    }
    filtered
}

pub fn find_header_key(headers: &HeaderMap, target: &str) -> Option<HeaderName> {
    let target_lower = target.to_ascii_lowercase();
    headers
        .keys()
        .find(|name| name.as_str().eq_ignore_ascii_case(&target_lower))
        .cloned()
}

fn normalize_address(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(stripped) = trimmed.strip_prefix("::ffff:") {
        return Some(stripped.to_string());
    }
    if trimmed == "::1" {
        return Some("127.0.0.1".into());
    }
    Some(trimmed.to_string())
}

pub fn append_forwarded_for(headers: &mut HeaderMap, remote: Option<&SocketAddr>) {
    let ip = remote.map(|addr| addr.ip().to_string());
    let Some(ip) = ip else {
        return;
    };

    if let Some(existing_key) = find_header_key(headers, "x-forwarded-for")
        && let Some(existing) = headers.get_mut(&existing_key)
    {
        let mut parts: Vec<String> = existing
            .to_str()
            .unwrap_or_default()
            .split(',')
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect();
        if !parts.iter().any(|item| item == &ip) {
            parts.push(ip.clone());
        }
        if let Ok(value) = HeaderValue::from_str(&parts.join(", ")) {
            *existing = value;
        }
        return;
    }

    if let Ok(value) = HeaderValue::from_str(&ip) {
        headers.insert(HeaderName::from_static("x-forwarded-for"), value);
    }
}

pub struct ClientIp {
    pub ip: Option<String>,
    #[allow(dead_code)]
    pub source: Option<&'static str>,
}

pub fn resolve_client_ip(
    headers: &HeaderMap,
    remote: Option<&SocketAddr>,
    trust_proxy: bool,
) -> ClientIp {
    if trust_proxy {
        for header in ["cf-connecting-ip", "cf-connection-ip"] {
            if let Some(value) = headers.get(header).and_then(|value| value.to_str().ok())
                && let Some(ip) = normalize_address(value)
            {
                return ClientIp {
                    ip: Some(ip),
                    source: Some(header),
                };
            }
        }

        if let Some(value) = headers
            .get("x-forwarded-for")
            .and_then(|value| value.to_str().ok())
            && let Some(first) = value.split(',').next().map(|item| item.trim())
            && let Some(ip) = normalize_address(first)
        {
            return ClientIp {
                ip: Some(ip),
                source: Some("x-forwarded-for"),
            };
        }
    }

    let socket_addr = remote.map(|addr| addr.ip().to_string());
    let source = socket_addr.as_ref().map(|_| "remote-address");
    ClientIp {
        ip: socket_addr,
        source,
    }
}
