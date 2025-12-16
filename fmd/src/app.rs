use crate::config::Config;
use crate::fetch_md::{FetchLimits, fetch_markdown};
use crate::logger::Logger;
use axum::Json;
use axum::Router;
use axum::body::Body;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::Deserialize;
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Semaphore;
use uuid::Uuid;

const TOKEN_HEADER: &str = "x-fmd-token";

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub limits: FetchLimits,
    pub logger: Logger,
    pub semaphore: Arc<Semaphore>,
}

pub fn build_router(config: Arc<Config>, logger: Logger) -> Router {
    let limits = FetchLimits {
        timeout: config.timeout,
        max_html_bytes: config.max_html_bytes,
        max_md_bytes: config.max_md_bytes,
    };
    let state = Arc::new(AppState {
        semaphore: Arc::new(Semaphore::new(config.max_concurrency)),
        config,
        limits,
        logger,
    });

    Router::new()
        .route("/healthz", get(handle_healthz))
        .route("/v1/fetch-md", post(handle_fetch_md))
        .with_state(state)
}

async fn handle_healthz() -> impl IntoResponse {
    StatusCode::OK
}

#[derive(Deserialize)]
struct FetchMdRequest {
    url: String,
}

async fn handle_fetch_md(
    State(state): State<Arc<AppState>>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    uri: Uri,
    Json(payload): Json<FetchMdRequest>,
) -> Response<Body> {
    let request_id = resolve_request_id(&headers);
    let started_at = Instant::now();
    let origin = headers
        .get("origin")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    state.logger.info(
        "request.received",
        json!({
            "requestId": request_id,
            "method": Method::POST.as_str(),
            "rawUrl": uri.to_string(),
            "origin": origin,
            "clientIp": remote.ip().to_string(),
        }),
    );

    if !is_authorized(&headers, &state.config.token) {
        let response = json_error(
            StatusCode::UNAUTHORIZED,
            "Unauthorized",
            request_id.as_str(),
        );
        log_complete(
            &state.logger,
            started_at,
            request_id.as_str(),
            uri.to_string(),
            401,
        );
        return response;
    }

    let permit = match state.semaphore.clone().acquire_owned().await {
        Ok(permit) => permit,
        Err(_) => {
            let response = json_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Service shutting down",
                request_id.as_str(),
            );
            log_complete(
                &state.logger,
                started_at,
                request_id.as_str(),
                uri.to_string(),
                503,
            );
            return response;
        }
    };

    let result = fetch_markdown(&payload.url, &state.limits).await;
    drop(permit);

    let response = match result {
        Ok(markdown) => {
            let mut headers = HeaderMap::new();
            headers.insert(
                header::CONTENT_TYPE,
                crate::fetch_md::content_type_text_markdown(),
            );
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            headers.insert(
                HeaderName::from_static("x-request-id"),
                HeaderValue::from_str(request_id.as_str())
                    .unwrap_or_else(|_| HeaderValue::from_static("")),
            );
            (StatusCode::OK, headers, markdown).into_response()
        }
        Err(error) => {
            let status = error.status_code();
            json_error(status, error.detail(), request_id.as_str())
        }
    };

    log_complete(
        &state.logger,
        started_at,
        request_id.as_str(),
        uri.to_string(),
        response.status().as_u16(),
    );
    response
}

fn resolve_request_id(headers: &HeaderMap) -> String {
    headers
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string())
}

fn is_authorized(headers: &HeaderMap, expected: &str) -> bool {
    let provided = headers
        .get(TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    constant_time_eq(provided.as_bytes(), expected.as_bytes())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn json_error(status: StatusCode, message: &str, request_id: &str) -> Response<Body> {
    let body = json!({ "error": message }).to_string();
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        HeaderName::from_static("x-request-id"),
        HeaderValue::from_str(request_id).unwrap_or_else(|_| HeaderValue::from_static("")),
    );
    (status, headers, body).into_response()
}

fn log_complete(
    logger: &Logger,
    started_at: Instant,
    request_id: &str,
    raw_url: String,
    status: u16,
) {
    let duration_ms = started_at.elapsed().as_secs_f64() * 1000.0;
    logger.info(
        "request.completed",
        json!({
            "requestId": request_id,
            "method": Method::POST.as_str(),
            "rawUrl": raw_url,
            "statusCode": status,
            "durationMs": duration_ms,
        }),
    );
}
