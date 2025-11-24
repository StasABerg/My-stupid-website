use crate::cache::CacheHandle;
use crate::headers::{
    append_forwarded_for, find_header_key, resolve_client_ip, sanitize_headers_for_cache,
    sanitize_request_headers, sanitize_response_headers,
};
use crate::logger::Logger;
use crate::routing::Target;
use crate::session::SessionSnapshot;
use async_trait::async_trait;
use axum::body::Body;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use bytes::Bytes;
use futures_util::StreamExt;
use http::{HeaderMap, HeaderName, HeaderValue, Response, StatusCode, header};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::io;
use std::net::SocketAddr;
use std::str;

const MAX_CACHE_BODY_BYTES: usize = 512 * 1024;

#[async_trait]
pub trait GatewayProxy: Send + Sync {
    async fn forward(
        &self,
        parts: http::request::Parts,
        body_bytes: Option<Bytes>,
        options: ProxyOptions<'_>,
    ) -> Response<Body>;
}

pub struct Proxy {
    client: Client,
    cache: CacheHandle,
    logger: Logger,
    trust_proxy: bool,
}

pub struct ProxyOptions<'a> {
    pub target: &'a Target,
    pub query: Option<&'a str>,
    pub session: Option<&'a SessionSnapshot>,
    pub cors_headers: HeaderMap,
    pub cache_key: Option<String>,
    pub cacheable: bool,
    pub remote_addr: Option<SocketAddr>,
    pub request_id: &'a str,
    pub is_streaming: bool,
}

impl Proxy {
    pub fn new(client: Client, cache: CacheHandle, logger: Logger, trust_proxy: bool) -> Self {
        Self {
            client,
            cache,
            logger,
            trust_proxy,
        }
    }
}

#[async_trait]
impl GatewayProxy for Proxy {
    async fn forward(
        &self,
        parts: http::request::Parts,
        body_bytes: Option<Bytes>,
        options: ProxyOptions<'_>,
    ) -> Response<Body> {
        if options.cacheable
            && let Some(cache_key) = &options.cache_key
            && let Some(cached) = self.cache.get(cache_key).await
            && let Ok(entry) = serde_json::from_str::<CacheEntry>(&cached)
        {
            return build_cached_response(entry, &options.cors_headers);
        }

        let target_url = build_target_url(options.target, options.query);
        let mut outbound_headers = sanitize_request_headers(&parts.headers);
        append_forwarded_for(&mut outbound_headers, options.remote_addr.as_ref());
        let client_ip = resolve_client_ip(
            &parts.headers,
            options.remote_addr.as_ref(),
            self.trust_proxy,
        );
        if let Some(ip) = &client_ip.ip {
            self.logger.debug(
                "request.client_ip_resolved",
                serde_json::json!({ "ip": ip, "source": client_ip.source }),
            );
        }
        set_client_ip_headers(&mut outbound_headers, &client_ip);

        if let Some(session) = options.session {
            outbound_headers.insert(
                HeaderName::from_static("x-gateway-csrf-token"),
                HeaderValue::from_str(&session.nonce)
                    .unwrap_or_else(|_| HeaderValue::from_static("")),
            );
            outbound_headers.insert(
                HeaderName::from_static("x-gateway-session"),
                HeaderValue::from_str(&session.nonce)
                    .unwrap_or_else(|_| HeaderValue::from_static("")),
            );
            outbound_headers.insert(
                HeaderName::from_static("x-gateway-csrf-proof"),
                HeaderValue::from_str(&session.csrf_proof)
                    .unwrap_or_else(|_| HeaderValue::from_static("")),
            );
        }

        let mut request_builder = self
            .client
            .request(parts.method.clone(), &target_url)
            .headers(convert_headers(&outbound_headers));

        if let Some(body) = body_bytes {
            request_builder = request_builder.body(body);
        }

        let response = match request_builder.send().await {
            Ok(resp) => resp,
            Err(error) => {
                self.logger.error(
                    "proxy.request_failed",
                    serde_json::json!({
                        "requestId": options.request_id,
                        "target": target_url,
                        "error": error.to_string(),
                    }),
                );
                return build_error_response(
                    StatusCode::BAD_GATEWAY,
                    "Upstream request failed",
                    &options.cors_headers,
                );
            }
        };

        let status = response.status();
        let headers = sanitize_response_headers(response.headers());
        let is_stream_target = options.is_streaming;
        let cacheable = options.cacheable && !is_stream_target;

        let mut response_headers = HeaderMap::new();
        for (key, value) in headers.iter() {
            response_headers.insert(key.clone(), value.clone());
        }
        for (key, value) in options.cors_headers.iter() {
            response_headers.insert(key.clone(), value.clone());
        }
        response_headers.insert(
            HeaderName::from_static("x-cache"),
            HeaderValue::from_static(if cacheable { "MISS" } else { "BYPASS" }),
        );

        if !is_stream_target && response_headers.get(header::CONTENT_TYPE).is_none() {
            response_headers.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            );
        }
        response_headers.remove(header::CONTENT_LENGTH);

        if let Some(session) = options.session {
            if response_headers.get("x-gateway-session").is_none() {
                response_headers.insert(
                    HeaderName::from_static("x-gateway-session"),
                    HeaderValue::from_str(&session.nonce)
                        .unwrap_or_else(|_| HeaderValue::from_static("")),
                );
            }
            response_headers.insert(
                HeaderName::from_static("x-gateway-csrf"),
                HeaderValue::from_str(&session.nonce)
                    .unwrap_or_else(|_| HeaderValue::from_static("")),
            );
            response_headers.insert(
                HeaderName::from_static("x-gateway-csrf-proof"),
                HeaderValue::from_str(&session.csrf_proof)
                    .unwrap_or_else(|_| HeaderValue::from_static("")),
            );
        }

        if is_stream_target {
            let logger = self.logger.clone();
            let request_id = options.request_id.to_string();
            let target = target_url.clone();
            let stream = response.bytes_stream().map(move |chunk| match chunk {
                Ok(bytes) => Ok(bytes),
                Err(error) => {
                    logger.warn(
                        "proxy.stream_forward_error",
                        json!({
                            "requestId": request_id,
                            "target": target,
                            "error": error.to_string(),
                        }),
                    );
                    Err(io::Error::other(error))
                }
            });
            let mut builder = Response::builder().status(status);
            *builder.headers_mut().unwrap() = response_headers;
            return builder.body(Body::from_stream(stream)).unwrap_or_else(|_| {
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(Body::from("{}"))
                    .expect("failed to build streaming proxy response")
            });
        }

        let bytes = match response.bytes().await {
            Ok(body) => body,
            Err(error) => {
                self.logger.error(
                    "proxy.response_read_failed",
                    json!({
                        "requestId": options.request_id,
                        "target": target_url,
                        "error": error.to_string(),
                    }),
                );
                return build_error_response(
                    StatusCode::BAD_GATEWAY,
                    "Upstream response invalid",
                    &options.cors_headers,
                );
            }
        };

        if cacheable
            && let Some(cache_key) = &options.cache_key
            && let Some(content_type) = response_headers
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
            && content_type.contains("application/json")
            && status.is_success()
            && bytes.len() <= MAX_CACHE_BODY_BYTES
        {
            let cache_headers = sanitize_headers_for_cache(&headers);
            let entry = CacheEntry {
                status: status.as_u16(),
                headers: header_map_to_string(cache_headers),
                body_b64: STANDARD.encode(&bytes),
                body_len: bytes.len(),
            };
            if let Ok(serialized) = serde_json::to_string(&entry) {
                self.cache.set(cache_key, &serialized, None).await;
            }
        }

        let mut builder = Response::builder().status(status);
        *builder.headers_mut().unwrap() = response_headers;
        builder.body(Body::from(bytes)).unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from("{}"))
                .expect("failed to build proxy fallback response")
        })
    }
}

fn build_target_url(target: &Target, query: Option<&str>) -> String {
    let mut url = format!("{}{}", target.base_url, target.path);
    if let Some(q) = query
        && !q.is_empty()
    {
        url.push('?');
        url.push_str(q);
    }
    url
}

fn convert_headers(headers: &HeaderMap) -> reqwest::header::HeaderMap {
    let mut map = reqwest::header::HeaderMap::new();
    for (key, value) in headers.iter() {
        if let Ok(name) = reqwest::header::HeaderName::from_bytes(key.as_str().as_bytes()) {
            map.insert(name, value.clone());
        }
    }
    map
}

fn set_client_ip_headers(headers: &mut HeaderMap, client_ip: &crate::headers::ClientIp) {
    if let Some(ip) = &client_ip.ip {
        let connecting_key = find_header_key(headers, "cf-connecting-ip")
            .unwrap_or(HeaderName::from_static("cf-connecting-ip"));
        headers.insert(
            connecting_key,
            HeaderValue::from_str(ip).unwrap_or_else(|_| HeaderValue::from_static("")),
        );
        let connection_key = find_header_key(headers, "cf-connection-ip")
            .unwrap_or(HeaderName::from_static("cf-connection-ip"));
        headers.insert(
            connection_key,
            HeaderValue::from_str(ip).unwrap_or_else(|_| HeaderValue::from_static("")),
        );
        headers.insert(
            HeaderName::from_static("x-real-ip"),
            HeaderValue::from_str(ip).unwrap_or_else(|_| HeaderValue::from_static("")),
        );
    }
}

fn build_error_response(status: StatusCode, message: &str, cors: &HeaderMap) -> Response<Body> {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    for (key, value) in cors.iter() {
        headers.insert(key.clone(), value.clone());
    }
    let body = serde_json::json!({ "error": message }).to_string();
    let mut builder = Response::builder().status(status);
    *builder.headers_mut().unwrap() = headers;
    builder.body(Body::from(body)).unwrap_or_else(|_| {
        Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from("{}"))
            .expect("failed to build error response")
    })
}

#[derive(Serialize, Deserialize)]
struct CacheEntry {
    status: u16,
    headers: HashMap<String, String>,
    #[serde(alias = "body")]
    body_b64: String,
    #[serde(default)]
    body_len: usize,
}

fn build_cached_response(entry: CacheEntry, cors_headers: &HeaderMap) -> Response<Body> {
    let mut headers = HeaderMap::new();
    for (key, value) in entry.headers.iter() {
        if let Ok(name) = HeaderName::from_bytes(key.as_bytes())
            && let Ok(header_value) = HeaderValue::from_str(value)
        {
            headers.insert(name, header_value);
        }
    }
    for (key, value) in cors_headers.iter() {
        headers.insert(key.clone(), value.clone());
    }
    headers.insert(
        HeaderName::from_static("x-cache"),
        HeaderValue::from_static("HIT"),
    );
    let body_bytes = STANDARD
        .decode(entry.body_b64.as_bytes())
        .unwrap_or_default();
    let mut builder =
        Response::builder().status(StatusCode::from_u16(entry.status).unwrap_or(StatusCode::OK));
    *builder.headers_mut().unwrap() = headers;
    builder.body(Body::from(body_bytes)).unwrap_or_else(|_| {
        Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from("{}"))
            .expect("failed to build cached response fallback")
    })
}

fn header_map_to_string(headers: HeaderMap) -> HashMap<String, String> {
    headers
        .iter()
        .filter_map(|(key, value)| {
            value
                .to_str()
                .ok()
                .map(|raw| (key.as_str().to_string(), raw.to_string()))
        })
        .collect()
}
