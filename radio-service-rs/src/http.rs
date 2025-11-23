use std::{
    collections::HashMap,
    io,
    net::SocketAddr,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Body,
    extract::{ConnectInfo, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use chrono::Utc;
use futures_util::TryStreamExt;
use reqwest::header::{HeaderMap as ReqwestHeaderMap, HeaderName};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::{
    net::TcpListener,
    time::{timeout, Duration},
};
use url::Url;
use uuid::Uuid;

use crate::logging::logger;
use crate::{
    app_state::{AppState, RateLimitMetadata},
    favorites::{
        build_favorites_key, dedupe_entries, is_valid_favorites_session, is_valid_session_token,
        sanitize_station_id, FavoriteEntry, FavoriteStation, MAX_FAVORITES,
    },
    stations::{intersect_lists, ProcessedStations, Station, StationsPayload},
    stream_pipeline::PipelineDecision,
};

const OPENAPI_SPEC: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/openapi.json"));
const SWAGGER_UI_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Radio Service API</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
    <style>
      html, body { margin: 0; padding: 0; background-color: #fafafa; }
      #swagger-ui { width: 100%; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        const basePath = window.location.pathname.replace(/\/$/, "");
        const specUrl = basePath + "/json";
        window.ui = SwaggerUIBundle({
          url: specUrl,
          dom_id: '#swagger-ui',
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIBundle.SwaggerUIStandalonePreset
          ],
          layout: 'BaseLayout'
        });
      };
    </script>
  </body>
</html>
"#;

type ApiResponse = Result<Response, ApiError>;

fn extract_request_id(headers: &HeaderMap) -> String {
    headers
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string())
}

fn extract_client_ip(headers: &HeaderMap, remote: Option<&SocketAddr>) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|raw| raw.split(',').next())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|value| value.to_str().ok())
                .map(|value| value.to_string())
        })
        .or_else(|| remote.map(|addr| addr.ip().to_string()))
}

async fn log_requests(request: Request<Body>, next: Next) -> Response {
    let request_id = extract_request_id(request.headers());
    let method = request.method().clone();
    let raw_url = request.uri().to_string();
    let origin = request
        .headers()
        .get("origin")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let remote = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|info| &info.0);
    let client_ip = extract_client_ip(request.headers(), remote);
    let user_agent = request
        .headers()
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let started_at = Instant::now();

    logger().info(
        "request.received",
        json!({
            "requestId": request_id,
            "method": method.as_str(),
            "rawUrl": raw_url,
            "origin": origin,
            "clientIp": client_ip,
            "userAgent": user_agent,
        }),
    );

    let mut response = next.run(request).await;
    let status = response.status().as_u16();
    let duration_ms = started_at.elapsed().as_secs_f64() * 1000.0;

    logger().info(
        "request.completed",
        json!({
            "requestId": request_id,
            "method": method.as_str(),
            "rawUrl": raw_url,
            "statusCode": status,
            "durationMs": duration_ms,
            "origin": origin,
            "clientIp": client_ip,
            "userAgent": user_agent,
        }),
    );

    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response
            .headers_mut()
            .insert(header::HeaderName::from_static("x-request-id"), value);
    }

    response
}

fn json_response<T>(status: StatusCode, payload: T) -> Response
where
    T: Serialize,
{
    (status, Json(payload)).into_response()
}

#[derive(Debug)]
enum ApiError {
    ServiceUnavailable(&'static str),
    Internal(anyhow::Error),
    Unauthorized(&'static str),
    BadRequest(&'static str),
    BadRequestWithDetails {
        message: &'static str,
        details: Vec<String>,
    },
    NotFound(&'static str),
    Conflict(&'static str),
    Forbidden(&'static str),
    TooManyRequests {
        message: &'static str,
        info: RateLimitMetadata,
    },
}

impl ApiError {
    fn internal(error: anyhow::Error) -> Self {
        ApiError::Internal(error)
    }
}

#[derive(Serialize)]
struct ErrorResponse<'a> {
    error: &'a str,
}

fn upstream_error_response(status: StatusCode, message: String) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            ApiError::ServiceUnavailable(message) => (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorResponse { error: message }),
            )
                .into_response(),
            ApiError::Unauthorized(message) => (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse { error: message }),
            )
                .into_response(),
            ApiError::BadRequest(message) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse { error: message }),
            )
                .into_response(),
            ApiError::BadRequestWithDetails { message, details } => (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": message,
                    "details": details,
                })),
            )
                .into_response(),
            ApiError::NotFound(message) => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse { error: message }),
            )
                .into_response(),
            ApiError::Conflict(message) => {
                (StatusCode::CONFLICT, Json(ErrorResponse { error: message })).into_response()
            }
            ApiError::Forbidden(message) => (
                StatusCode::FORBIDDEN,
                Json(ErrorResponse { error: message }),
            )
                .into_response(),
            ApiError::TooManyRequests { message, info } => {
                let mut response = (
                    StatusCode::TOO_MANY_REQUESTS,
                    Json(ErrorResponse { error: message }),
                )
                    .into_response();
                apply_rate_limit_headers(response.headers_mut(), &info);
                let retry_after = info
                    .reset_epoch
                    .saturating_sub(
                        SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs(),
                    )
                    .max(1);
                if let Ok(value) = HeaderValue::from_str(&retry_after.to_string()) {
                    response.headers_mut().insert(header::RETRY_AFTER, value);
                }
                response
            }
            ApiError::Internal(error) => {
                logger().error(
                    "internal.error",
                    json!({
                        "error": {
                            "message": error.to_string(),
                            "debug": format!("{:?}", error),
                        }
                    }),
                );
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "Internal Server Error",
                    }),
                )
                    .into_response()
            }
        }
    }
}

#[derive(Serialize)]
struct HealthResponse<'a> {
    status: &'a str,
}

pub async fn serve(state: AppState) -> anyhow::Result<()> {
    let addr = SocketAddr::from(([0, 0, 0, 0], state.config.port));
    let router = Router::new()
        .route("/healthz", get(healthz))
        .route("/internal/status", get(internal_status))
        .route("/openapi.json", get(openapi_spec))
        .route("/docs/json", get(openapi_spec))
        .route("/docs", get(swagger_ui))
        .route("/stations", get(get_stations))
        .route("/stations/refresh", post(refresh_stations))
        .route("/stations/{station_id}/stream", get(stream_station))
        .route("/stations/{station_id}/stream/segment", get(stream_segment))
        .route("/stations/{station_id}/click", post(record_click))
        .route("/favorites", get(get_favorites))
        .route(
            "/favorites/{station_id}",
            put(upsert_favorite).delete(delete_favorite),
        )
        .with_state(state.clone())
        .layer(middleware::from_fn(log_requests));

    let listener = TcpListener::bind(addr).await?;
    logger().info(
        "server.listening",
        json!({
            "address": addr.to_string()
        }),
    );

    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    Ok(())
}

async fn healthz(State(state): State<AppState>) -> Response {
    match state.ping_redis().await {
        Ok(_) => json_response(StatusCode::OK, HealthResponse { status: "ok" }),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({
                "status": "error",
                "message": error.to_string(),
            }),
        ),
    }
}

async fn internal_status(State(state): State<AppState>) -> Response {
    let redis_ok = state.ping_redis().await.is_ok();
    let postgres_ok = state.ping_postgres().await.is_ok();
    let metrics = state.status_snapshot().await;
    let overall_ok = redis_ok && postgres_ok;
    let status = if overall_ok { "ok" } else { "error" };
    let body = json!({
        "status": status,
        "timestamp": Utc::now().to_rfc3339(),
        "checks": {
            "redis": if redis_ok { "ok" } else { "error" },
            "postgres": if postgres_ok { "ok" } else { "error" },
        },
        "metrics": {
            "eventLoopDelayMs": metrics.event_loop_delay_ms,
            "memory": {
                "rssBytes": metrics.memory_used_bytes,
                "totalBytes": metrics.memory_total_bytes,
            },
            "uptimeSeconds": metrics.uptime_seconds,
        }
    });

    let code = if overall_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    json_response(code, body)
}

async fn openapi_spec() -> impl IntoResponse {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "public, max-age=60")
        .body(Body::from(OPENAPI_SPEC))
        .unwrap_or_else(|err| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from(err.to_string()))
                .unwrap()
        })
}

async fn swagger_ui() -> impl IntoResponse {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(SWAGGER_UI_HTML))
        .unwrap_or_else(|err| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from(err.to_string()))
                .unwrap()
        })
}

#[derive(Serialize)]
struct StationsMeta {
    total: usize,
    filtered: usize,
    matches: usize,
    #[serde(rename = "hasMore")]
    has_more: bool,
    page: usize,
    limit: usize,
    #[serde(rename = "maxLimit")]
    max_limit: usize,
    #[serde(rename = "requestedLimit")]
    requested_limit: Option<RequestedLimitMetaValue>,
    offset: usize,
    #[serde(rename = "cacheSource")]
    cache_source: String,
    origin: Option<String>,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    countries: Vec<String>,
    genres: Vec<String>,
}

#[derive(Serialize)]
struct StationsListResponse {
    meta: StationsMeta,
    items: Vec<StationListItem>,
}

#[derive(Serialize, Clone)]
struct StationListItem {
    id: String,
    name: String,
    #[serde(rename = "streamUrl")]
    stream_url: String,
    homepage: Option<String>,
    favicon: Option<String>,
    country: Option<String>,
    #[serde(rename = "countryCode")]
    country_code: Option<String>,
    state: Option<String>,
    languages: Vec<String>,
    tags: Vec<String>,
    bitrate: Option<i32>,
    codec: Option<String>,
    hls: bool,
    #[serde(rename = "isOnline")]
    is_online: bool,
    #[serde(rename = "clickCount")]
    click_count: i32,
}

#[derive(Serialize)]
struct FavoritesResponse {
    meta: FavoritesMeta,
    items: Vec<FavoriteStation>,
}

#[derive(Serialize)]
struct FavoritesMeta {
    #[serde(rename = "maxSlots")]
    max_slots: usize,
}

fn project_stations(
    payload: &StationsPayload,
    processed: &ProcessedStations,
    query: &NormalizedStationsQuery,
    max_limit: usize,
    cache_source: &str,
) -> StationsListResponse {
    let total = payload.stations.len();
    let mut candidate_lists: Vec<Vec<usize>> = Vec::new();
    if let Some(country) = &query.country {
        if let Some(indexes) = processed.indexes_for_country(country) {
            candidate_lists.push(indexes.to_vec());
        } else {
            return empty_stations_response(payload, processed, query, max_limit, cache_source);
        }
    }
    if let Some(language) = &query.language {
        if let Some(indexes) = processed.indexes_for_language(language) {
            candidate_lists.push(indexes.to_vec());
        } else {
            return empty_stations_response(payload, processed, query, max_limit, cache_source);
        }
    }
    if let Some(tag) = &query.tag {
        if let Some(indexes) = processed.indexes_for_tag(tag) {
            candidate_lists.push(indexes.to_vec());
        } else {
            return empty_stations_response(payload, processed, query, max_limit, cache_source);
        }
    }
    if let Some(genre) = &query.genre {
        if let Some(indexes) = processed.indexes_for_tag(genre) {
            candidate_lists.push(indexes.to_vec());
        } else {
            return empty_stations_response(payload, processed, query, max_limit, cache_source);
        }
    }

    let mut indexes = intersect_lists(&candidate_lists, processed.station_count);
    if let Some(search) = &query.search {
        processed.search_matches(search, &mut indexes);
    }

    let mut filtered_indexes = Vec::new();
    for idx in indexes {
        if let Some(station) = payload.stations.get(idx) {
            if station_matches_filters(station, query) {
                filtered_indexes.push(idx);
            }
        }
    }

    let total_matches = filtered_indexes.len();
    let start = query.offset.min(total_matches);
    let end = (start + query.limit).min(total_matches);
    let has_more = end < total_matches;
    let items = filtered_indexes[start..end]
        .iter()
        .filter_map(|idx| payload.stations.get(*idx).map(project_station_for_client))
        .collect::<Vec<_>>();

    StationsListResponse {
        meta: StationsMeta {
            total,
            filtered: items.len(),
            matches: total_matches,
            has_more,
            page: query.page,
            limit: query.limit,
            max_limit,
            requested_limit: query
                .requested_limit
                .as_ref()
                .map(RequestedLimitMetaValue::from),
            offset: query.offset,
            cache_source: cache_source.to_string(),
            origin: payload.source.clone(),
            updated_at: payload.updated_at.to_rfc3339(),
            countries: processed.countries.clone(),
            genres: processed.genres.clone(),
        },
        items,
    }
}

fn empty_stations_response(
    payload: &StationsPayload,
    processed: &ProcessedStations,
    query: &NormalizedStationsQuery,
    max_limit: usize,
    cache_source: &str,
) -> StationsListResponse {
    StationsListResponse {
        meta: StationsMeta {
            total: payload.stations.len(),
            filtered: 0,
            matches: 0,
            has_more: false,
            page: query.page,
            limit: query.limit,
            max_limit,
            requested_limit: query
                .requested_limit
                .as_ref()
                .map(RequestedLimitMetaValue::from),
            offset: query.offset,
            cache_source: cache_source.to_string(),
            origin: payload.source.clone(),
            updated_at: payload.updated_at.to_rfc3339(),
            countries: processed.countries.clone(),
            genres: processed.genres.clone(),
        },
        items: Vec::new(),
    }
}

fn station_matches_filters(station: &Station, filters: &NormalizedStationsQuery) -> bool {
    if let Some(country) = &filters.country {
        if station
            .country
            .as_ref()
            .map(|value| !value.eq_ignore_ascii_case(country))
            .unwrap_or(true)
            && station
                .country_code
                .as_ref()
                .map(|value| !value.eq_ignore_ascii_case(country))
                .unwrap_or(true)
        {
            return false;
        }
    }
    if let Some(language) = &filters.language {
        if !station
            .languages
            .iter()
            .any(|value| value.eq_ignore_ascii_case(language))
        {
            return false;
        }
    }
    if let Some(tag) = &filters.tag {
        if !station
            .tags
            .iter()
            .any(|value| value.eq_ignore_ascii_case(tag))
        {
            return false;
        }
    }
    if let Some(genre) = &filters.genre {
        if !station
            .tags
            .iter()
            .any(|value| value.eq_ignore_ascii_case(genre))
        {
            return false;
        }
    }
    // Search is already handled by ProcessedStations::search_matches; skip redundant work.
    true
}

fn build_favorites_response(
    payload: &StationsPayload,
    processed: &ProcessedStations,
    entries: Vec<FavoriteEntry>,
) -> (FavoritesResponse, bool, Vec<FavoriteEntry>) {
    let mut items = Vec::new();
    let mut persist = false;
    let mut next_entries = Vec::new();

    for entry in entries.into_iter().take(MAX_FAVORITES) {
        if let Some(station) = get_station_by_id(payload, processed, &entry.id) {
            let projected = project_station(&station);
            let changed = entry.station.as_ref() != Some(&projected);
            if changed {
                persist = true;
            }
            items.push(projected.clone());
            next_entries.push(FavoriteEntry {
                station: Some(projected),
                ..entry
            });
        } else if let Some(snapshot) = entry.station.clone() {
            items.push(snapshot.clone());
            next_entries.push(entry);
        }
    }

    (
        FavoritesResponse {
            meta: FavoritesMeta {
                max_slots: MAX_FAVORITES,
            },
            items,
        },
        persist,
        next_entries,
    )
}

fn project_station_for_client(station: &Station) -> StationListItem {
    StationListItem {
        id: station.id.clone(),
        name: station.name.clone(),
        stream_url: station.stream_url.clone(),
        homepage: station.homepage.clone(),
        favicon: station.favicon.clone(),
        country: station.country.clone(),
        country_code: station.country_code.clone(),
        state: station.state.clone(),
        languages: station.languages.clone(),
        tags: station.tags.iter().take(12).cloned().collect(),
        bitrate: station.bitrate,
        codec: station.codec.clone(),
        hls: station.hls,
        is_online: station.is_online,
        click_count: station.click_count,
    }
}

fn project_station(station: &Station) -> FavoriteStation {
    FavoriteStation {
        id: station.id.clone(),
        name: station.name.clone(),
        stream_url: station.stream_url.clone(),
        homepage: station.homepage.clone(),
        favicon: station.favicon.clone(),
        country: station.country.clone(),
        country_code: station.country_code.clone(),
        state: station.state.clone(),
        languages: station.languages.clone(),
        tags: station.tags.iter().take(12).cloned().collect(),
        bitrate: station.bitrate,
        codec: station.codec.clone(),
        hls: station.hls,
        is_online: station.is_online,
        click_count: station.click_count,
    }
}

fn get_station_by_id(
    payload: &StationsPayload,
    processed: &ProcessedStations,
    station_id: &str,
) -> Option<Station> {
    processed
        .station_index(station_id)
        .and_then(|idx| payload.stations.get(idx))
        .cloned()
}

fn apply_rate_limit_headers(headers: &mut HeaderMap, info: &RateLimitMetadata) {
    let limit = info.limit.to_string();
    if let Ok(value) = HeaderValue::from_str(&limit) {
        headers.insert("x-ratelimit-limit", value);
    }
    let remaining = info.remaining.to_string();
    if let Ok(value) = HeaderValue::from_str(&remaining) {
        headers.insert("x-ratelimit-remaining", value);
    }
    let reset = info.reset_epoch.to_string();
    if let Ok(value) = HeaderValue::from_str(&reset) {
        headers.insert("x-ratelimit-reset", value);
    }
}

fn with_rate_limit(mut response: Response, info: &RateLimitMetadata) -> Response {
    apply_rate_limit_headers(response.headers_mut(), info);
    response
}

async fn enforce_rate_limit(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<RateLimitMetadata, ApiError> {
    let key = resolve_client_key(headers);
    let decision = state.check_rate_limit(&key).await;
    if decision.allowed {
        Ok(decision.metadata)
    } else {
        Err(ApiError::TooManyRequests {
            message: "Too many requests. Please try again soon.",
            info: decision.metadata,
        })
    }
}

fn resolve_client_key(headers: &HeaderMap) -> String {
    if let Some(value) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = value.split(',').next() {
            let trimmed = first.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    if let Some(value) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    "unknown".into()
}

fn extract_session_token(headers: &HeaderMap) -> Result<String, ApiError> {
    let header = headers
        .get("x-gateway-session")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_lowercase())
        .ok_or(ApiError::Unauthorized("Session token required"))?;
    if !is_valid_session_token(&header) {
        return Err(ApiError::Unauthorized("Invalid session token"));
    }
    Ok(header)
}

fn extract_favorites_session(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-favorites-session")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| is_valid_favorites_session(value))
}

fn current_timestamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn ensure_refresh_authorized(headers: &HeaderMap, expected_token: &str) -> Result<(), ApiError> {
    let provided = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if provided == format!("Bearer {expected_token}") {
        Ok(())
    } else {
        Err(ApiError::Forbidden("Unauthorized refresh request"))
    }
}

#[derive(Clone, Default)]
struct CsrfParams {
    token: Option<String>,
    proof: Option<String>,
}

fn resolve_csrf_params(headers: &HeaderMap, query: &HashMap<String, String>) -> CsrfParams {
    let header_token = headers
        .get("x-gateway-csrf-token")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let header_proof = headers
        .get("x-gateway-csrf-proof")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let query_token = query
        .get("csrfToken")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let query_proof = query
        .get("csrfProof")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    CsrfParams {
        token: header_token.or(query_token),
        proof: header_proof.or(query_proof),
    }
}

async fn load_station(state: &AppState, station_id: &str) -> Result<Station, ApiError> {
    let mut load = state
        .load_stations(false)
        .await
        .map_err(ApiError::internal)?;
    let fingerprint = load
        .payload
        .ensure_fingerprint()
        .map_err(ApiError::internal)?
        .to_string();
    let processed = state
        .ensure_processed(&fingerprint, &load.payload.stations)
        .await;
    get_station_by_id(&load.payload, &processed, station_id)
        .ok_or(ApiError::NotFound("Station not found"))
}

fn forward_stream_response(response: reqwest::Response) -> Response {
    let status = response.status();
    let mut builder = Response::builder().status(status);
    for (key, value) in response.headers().iter() {
        if key.as_str().eq_ignore_ascii_case("transfer-encoding") {
            continue;
        }
        builder = builder.header(key, value.clone());
    }
    let body = Body::from_stream(response.bytes_stream().map_err(io::Error::other));
    builder
        .header("Cache-Control", "no-store")
        .body(body)
        .unwrap_or_else(|err| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from(err.to_string()))
                .unwrap()
        })
}

fn pick_forward_headers(headers: &HeaderMap, names: &[&str]) -> ReqwestHeaderMap {
    let mut map = ReqwestHeaderMap::new();
    for &name in names {
        if let Some(value) = headers.get(name) {
            if let Ok(header_name) = HeaderName::from_lowercase(name.as_bytes()) {
                map.insert(header_name, value.clone());
            }
        }
    }
    map
}

fn should_treat_as_playlist(url: &str, content_type: &str) -> bool {
    let lowered = content_type.to_lowercase();
    if lowered.contains("mpegurl") || lowered.contains("scpls") {
        return true;
    }
    if let Ok(parsed) = Url::parse(url) {
        return parsed.path().ends_with(".m3u8")
            || parsed.path().ends_with(".m3u")
            || parsed.path().ends_with(".pls");
    }
    false
}

fn rewrite_playlist(
    base_url: &str,
    playlist: &str,
    csrf: &CsrfParams,
    segment_path: &str,
) -> String {
    let base = Url::parse(base_url);
    playlist
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                line.to_string()
            } else if let Ok(base_url) = &base {
                if let Ok(resolved) = base_url.join(trimmed) {
                    let mut upgrade = resolved.clone();
                    if upgrade.scheme() == "http" {
                        let _ = upgrade.set_scheme("https");
                    }
                    if upgrade.scheme() != "https" {
                        return "# dropped http stream".to_string();
                    }
                    let mut proxied = segment_path.to_string();
                    if !proxied.ends_with("?") && !proxied.ends_with("&") {
                        proxied.push_str(if proxied.contains('?') { "&" } else { "?" });
                    }
                    proxied.push_str("source=");
                    proxied.push_str(&urlencoding::encode(upgrade.as_str()));
                    if let Some(token) = &csrf.token {
                        proxied.push_str("&csrfToken=");
                        proxied.push_str(&urlencoding::encode(token));
                    }
                    if let Some(proof) = &csrf.proof {
                        proxied.push_str("&csrfProof=");
                        proxied.push_str(&urlencoding::encode(proof));
                    }
                    proxied
                } else {
                    line.to_string()
                }
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse_bool(value: Option<String>) -> bool {
    matches!(
        value
            .as_deref()
            .map(|s| s.trim().to_ascii_lowercase()),
        Some(ref v) if v == "true" || v == "1" || v == "yes"
    )
}

async fn get_stations(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<StationsQueryParams>,
) -> ApiResponse {
    let rate = enforce_rate_limit(&state, &headers).await?;
    let normalized_query = match query.normalized(
        state.config.api.default_page_size,
        state.config.api.max_page_size,
    ) {
        Ok(value) => value,
        Err(details) => {
            return Err(ApiError::BadRequestWithDetails {
                message: INVALID_QUERY_ERROR,
                details,
            });
        }
    };

    if normalized_query.force_refresh {
        ensure_refresh_authorized(&headers, &state.config.refresh_token)?;
    }

    let mut load = state
        .load_stations(normalized_query.force_refresh)
        .await
        .map_err(ApiError::internal)?;

    let fingerprint = load
        .payload
        .ensure_fingerprint()
        .map_err(ApiError::internal)?
        .to_string();
    let processed = state
        .ensure_processed(&fingerprint, &load.payload.stations)
        .await;
    let response = project_stations(
        &load.payload,
        &processed,
        &normalized_query,
        state.config.api.max_page_size,
        &load.cache_source,
    );
    let mut reply = Json(response).into_response();
    reply.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=30, stale-while-revalidate=120"),
    );
    apply_rate_limit_headers(reply.headers_mut(), &rate);
    Ok(reply)
}

async fn get_favorites(State(state): State<AppState>, headers: HeaderMap) -> ApiResponse {
    let rate = enforce_rate_limit(&state, &headers).await?;
    let session = extract_session_token(&headers)?;
    let favorites_session = extract_favorites_session(&headers);
    let key = build_favorites_key(&session, favorites_session.as_deref());

    let mut load = state
        .load_stations(false)
        .await
        .map_err(ApiError::internal)?;
    let fingerprint = load
        .payload
        .ensure_fingerprint()
        .map_err(ApiError::internal)?
        .to_string();
    let processed = state
        .ensure_processed(&fingerprint, &load.payload.stations)
        .await;
    let payload = load.payload;

    let favorites = state
        .favorites
        .read(&key)
        .await
        .map_err(ApiError::internal)?;
    let (response, persist, updated_entries) =
        build_favorites_response(&payload, &processed, favorites);

    if persist {
        state
            .favorites
            .write(&key, &updated_entries)
            .await
            .map_err(ApiError::internal)?;
    } else {
        state
            .favorites
            .refresh_ttl(&key)
            .await
            .map_err(ApiError::internal)?;
    }

    let mut resp = Json(response).into_response();
    apply_rate_limit_headers(resp.headers_mut(), &rate);
    Ok(resp)
}

#[derive(Deserialize, Default)]
struct UpsertFavoriteBody {
    slot: Option<usize>,
}

#[derive(Deserialize)]
struct StreamSegmentQuery {
    source: String,
    #[serde(rename = "csrfToken")]
    csrf_token: Option<String>,
    #[serde(rename = "csrfProof")]
    csrf_proof: Option<String>,
}

async fn upsert_favorite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(station_id): Path<String>,
    body: Option<Json<UpsertFavoriteBody>>,
) -> ApiResponse {
    let rate = enforce_rate_limit(&state, &headers).await?;
    let body = body.map(|Json(payload)| payload).unwrap_or_default();
    let session = extract_session_token(&headers)?;
    let favorites_session = extract_favorites_session(&headers);
    let key = build_favorites_key(&session, favorites_session.as_deref());

    let sanitized_station_id = sanitize_station_id(&station_id)
        .ok_or(ApiError::BadRequest("Invalid station identifier"))?;

    if let Some(slot) = body.slot {
        if slot >= MAX_FAVORITES {
            return Err(ApiError::BadRequest("Invalid slot index"));
        }
    }

    let mut load = state
        .load_stations(false)
        .await
        .map_err(ApiError::internal)?;
    let fingerprint = load
        .payload
        .ensure_fingerprint()
        .map_err(ApiError::internal)?
        .to_string();
    let processed = state
        .ensure_processed(&fingerprint, &load.payload.stations)
        .await;
    let payload = load.payload;

    let station = get_station_by_id(&payload, &processed, &sanitized_station_id)
        .ok_or(ApiError::NotFound("Station not found"))?;

    let mut favorites = state
        .favorites
        .read(&key)
        .await
        .map_err(ApiError::internal)?;

    if let Some(index) = favorites
        .iter()
        .position(|entry| entry.id == sanitized_station_id)
    {
        favorites.remove(index);
    }

    let projected = project_station(&station);
    let new_entry = FavoriteEntry {
        id: sanitized_station_id.clone(),
        saved_at: current_timestamp(),
        station: Some(projected),
    };

    if let Some(slot) = body.slot {
        if slot < favorites.len() {
            favorites.insert(slot, new_entry);
        } else {
            if favorites.len() >= MAX_FAVORITES {
                return Err(ApiError::Conflict("All favorite slots are already filled"));
            }
            favorites.push(new_entry);
        }
    } else {
        if favorites.len() >= MAX_FAVORITES {
            return Err(ApiError::Conflict("All favorite slots are already filled"));
        }
        favorites.push(new_entry);
    }

    let favorites = dedupe_entries(favorites);
    let (response, _, updated_entries) = build_favorites_response(&payload, &processed, favorites);

    state
        .favorites
        .write(&key, &updated_entries)
        .await
        .map_err(ApiError::internal)?;

    let mut resp = Json(response).into_response();
    apply_rate_limit_headers(resp.headers_mut(), &rate);
    Ok(resp)
}

async fn delete_favorite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(station_id): Path<String>,
) -> ApiResponse {
    let rate = enforce_rate_limit(&state, &headers).await?;
    let session = extract_session_token(&headers)?;
    let favorites_session = extract_favorites_session(&headers);
    let key = build_favorites_key(&session, favorites_session.as_deref());

    let sanitized_station_id = sanitize_station_id(&station_id)
        .ok_or(ApiError::BadRequest("Invalid station identifier"))?;

    let mut load = state
        .load_stations(false)
        .await
        .map_err(ApiError::internal)?;
    let fingerprint = load
        .payload
        .ensure_fingerprint()
        .map_err(ApiError::internal)?
        .to_string();
    let processed = state
        .ensure_processed(&fingerprint, &load.payload.stations)
        .await;
    let payload = load.payload;

    let favorites = state
        .favorites
        .read(&key)
        .await
        .map_err(ApiError::internal)?;
    let removed = favorites
        .iter()
        .any(|entry| entry.id == sanitized_station_id);
    let next: Vec<FavoriteEntry> = favorites
        .into_iter()
        .filter(|entry| entry.id != sanitized_station_id)
        .collect();

    let (response, persist, updated_entries) = build_favorites_response(&payload, &processed, next);

    if persist || removed {
        state
            .favorites
            .write(&key, &updated_entries)
            .await
            .map_err(ApiError::internal)?;
    } else {
        state
            .favorites
            .refresh_ttl(&key)
            .await
            .map_err(ApiError::internal)?;
    }

    let mut resp = Json(response).into_response();
    apply_rate_limit_headers(resp.headers_mut(), &rate);
    Ok(resp)
}

async fn stream_station(
    State(state): State<AppState>,
    Path(station_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let station_id = station_id.trim();
    if station_id.is_empty() {
        return Err(ApiError::BadRequest("Station identifier is required."));
    }
    let rate = enforce_rate_limit(&state, &headers).await?;

    let station = load_station(&state, station_id).await?;
    if state.stream_pipeline.is_enabled() {
        match state.stream_pipeline.attempt(&station.stream_url).await {
            Ok(PipelineDecision::Skip) => {}
            Ok(PipelineDecision::Stream { body, content_type }) => {
                let mut builder = Response::builder()
                    .status(StatusCode::OK)
                    .header("Cache-Control", "no-store");
                if let Some(ct) = content_type {
                    builder = builder.header("Content-Type", ct);
                }
                let response = builder
                    .body(body)
                    .map_err(|err| ApiError::internal(anyhow::anyhow!(err)))?;
                return Ok(with_rate_limit(response, &rate));
            }
            Err(error) => {
                logger().info(
                    "stream.pipeline.fallback",
                    json!({
                        "stationId": station_id,
                        "error": format!("{:?}", error),
                    }),
                );
            }
        }
    }
    let request = state
        .http_client
        .get(&station.stream_url)
        .headers(pick_forward_headers(&headers, &["user-agent", "accept"]));

    let response = timeout(
        Duration::from_millis(state.config.stream_proxy.timeout_ms),
        request.send(),
    )
    .await
    .map_err(|_| ApiError::ServiceUnavailable("Stream request timed out"))?
    .map_err(|_| ApiError::ServiceUnavailable("Failed to reach stream URL."))?;

    if !response.status().is_success() {
        let status = response.status();
        let message = format!("Upstream returned {}", status.as_u16());
        return Ok(with_rate_limit(
            upstream_error_response(status, message),
            &rate,
        ));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");

    let csrf_params = resolve_csrf_params(&headers, &params);

    if !should_treat_as_playlist(&station.stream_url, content_type) {
        return Ok(with_rate_limit(forward_stream_response(response), &rate));
    }

    let playlist = response
        .text()
        .await
        .map_err(|_| ApiError::ServiceUnavailable("Failed to read playlist from upstream."))?;
    let rewritten = rewrite_playlist(
        &station.stream_url,
        &playlist,
        &csrf_params,
        "stream/segment",
    );

    let builder = Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/vnd.apple.mpegurl")
        .header("Cache-Control", "no-store");
    let body = Body::from(rewritten);
    let response = builder
        .body(body)
        .map_err(|err| ApiError::internal(anyhow::anyhow!(err)))?;
    Ok(with_rate_limit(response, &rate))
}

async fn stream_segment(
    State(state): State<AppState>,
    Path(station_id): Path<String>,
    Query(query): Query<StreamSegmentQuery>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let station_id = station_id.trim();
    if station_id.is_empty() {
        return Err(ApiError::BadRequest("Station identifier is required."));
    }
    if query.source.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "A source query parameter is required.",
        ));
    }
    let rate = enforce_rate_limit(&state, &headers).await?;

    let decoded = urlencoding::decode(&query.source)
        .map_err(|_| ApiError::BadRequest("Invalid segment URL provided."))?;
    let target = Url::parse(decoded.as_ref())
        .map_err(|_| ApiError::BadRequest("Invalid segment URL provided."))?;

    let station = load_station(&state, station_id).await?;
    let stream_origin = Url::parse(&station.stream_url).ok();
    if stream_origin
        .as_ref()
        .map(|origin: &Url| origin.origin().ascii_serialization())
        != Some(target.origin().ascii_serialization())
    {
        return Err(ApiError::Forbidden("Segment URL is not permitted."));
    }
    if target.scheme() != "https" {
        return Err(ApiError::Forbidden("Stream segments must use HTTPS."));
    }

    let response = timeout(
        Duration::from_millis(state.config.stream_proxy.timeout_ms),
        state
            .http_client
            .get(target.clone())
            .headers(pick_forward_headers(
                &headers,
                &["range", "accept", "user-agent"],
            ))
            .send(),
    )
    .await
    .map_err(|_| ApiError::ServiceUnavailable("Stream segment request timed out"))?
    .map_err(|_| ApiError::ServiceUnavailable("Failed to retrieve stream segment."))?;

    if !response.status().is_success() {
        let status = response.status();
        let message = format!("Upstream returned {}", status.as_u16());
        return Ok(with_rate_limit(
            upstream_error_response(status, message),
            &rate,
        ));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");

    let mut query_map: HashMap<String, String> = HashMap::new();
    if let Some(token) = &query.csrf_token {
        query_map.insert("csrfToken".into(), token.clone());
    }
    if let Some(proof) = &query.csrf_proof {
        query_map.insert("csrfProof".into(), proof.clone());
    }
    let csrf_params = resolve_csrf_params(&headers, &query_map);

    if !should_treat_as_playlist(target.as_str(), content_type) {
        return Ok(with_rate_limit(forward_stream_response(response), &rate));
    }

    let playlist = response
        .text()
        .await
        .map_err(|_| ApiError::ServiceUnavailable("Failed to read playlist from upstream."))?;
    // When rewriting nested playlists, keep the path relative to the segment handler
    // so we don't accumulate extra "/stream" segments as the player walks deeper.
    let rewritten = rewrite_playlist(target.as_str(), &playlist, &csrf_params, "segment");

    Ok(with_rate_limit(
        Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", "application/vnd.apple.mpegurl")
            .header("Cache-Control", "no-store")
            .body(Body::from(rewritten))
            .map_err(|err| ApiError::internal(anyhow::anyhow!(err)))?,
        &rate,
    ))
}

#[derive(Serialize)]
struct ClickResponse {
    status: &'static str,
}

async fn record_click(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(station_id): Path<String>,
) -> ApiResponse {
    let station_id = station_id.trim();
    if station_id.is_empty() {
        return Err(ApiError::BadRequest("Station identifier is required"));
    }
    let rate = enforce_rate_limit(&state, &headers).await?;
    state
        .record_station_click(station_id)
        .await
        .map_err(ApiError::internal)?;
    let mut resp = (StatusCode::ACCEPTED, Json(ClickResponse { status: "ok" })).into_response();
    apply_rate_limit_headers(resp.headers_mut(), &rate);
    Ok(resp)
}

#[derive(Serialize)]
struct RefreshResponse {
    meta: RefreshMeta,
}

#[derive(Serialize)]
struct RefreshMeta {
    total: usize,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    #[serde(rename = "cacheSource")]
    cache_source: String,
    origin: Option<String>,
}

async fn refresh_stations(State(state): State<AppState>, headers: HeaderMap) -> ApiResponse {
    let rate = enforce_rate_limit(&state, &headers).await?;
    ensure_refresh_authorized(&headers, &state.config.refresh_token)?;
    let payload = state.update_stations().await.map_err(ApiError::internal)?;
    let mut resp = Json(RefreshResponse {
        meta: RefreshMeta {
            total: payload.total,
            updated_at: payload.updated_at.to_rfc3339(),
            cache_source: "radio-browser".into(),
            origin: payload.source.clone(),
        },
    })
    .into_response();
    apply_rate_limit_headers(resp.headers_mut(), &rate);
    Ok(resp)
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm =
            signal(SignalKind::terminate()).expect("failed to install SIGTERM handler");
        sigterm.recv().await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
const MAX_LIMIT_DIGITS: usize = 5;
const MAX_PAGINATION_DIGITS: usize = 6;
const MAX_FILTER_LENGTH: usize = 128;
const MAX_SEARCH_LENGTH: usize = 160;
const INVALID_QUERY_ERROR: &str = "Invalid query parameters supplied.";

#[derive(Debug, Default, Deserialize)]
struct StationsQueryParams {
    #[serde(default)]
    limit: Option<String>,
    #[serde(default)]
    offset: Option<String>,
    #[serde(default)]
    page: Option<String>,
    #[serde(default)]
    country: Option<String>,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    tag: Option<String>,
    #[serde(default)]
    genre: Option<String>,
    #[serde(default)]
    search: Option<String>,
    #[serde(rename = "forceRefresh")]
    force_refresh: Option<String>,
    #[serde(default)]
    refresh: Option<String>,
}

impl StationsQueryParams {
    fn normalized(
        self,
        default_limit: usize,
        max_limit: usize,
    ) -> Result<NormalizedStationsQuery, Vec<String>> {
        let StationsQueryParams {
            limit,
            offset,
            page,
            country,
            language,
            tag,
            genre,
            search,
            force_refresh,
            refresh,
        } = self;

        let mut errors = Vec::new();
        let mut limit_value = default_limit.max(1).min(max_limit.max(1));
        let mut requested_limit = None;

        if let Some(limit_str) = normalize_raw_value(limit) {
            if limit_str.eq_ignore_ascii_case("all") {
                requested_limit = Some(RequestedLimit::All);
                limit_value = max_limit.max(1);
            } else if limit_str.len() > MAX_LIMIT_DIGITS
                || !limit_str.chars().all(|c| c.is_ascii_digit())
            {
                errors.push("limit must be a whole number".into());
            } else if let Ok(parsed) = limit_str.parse::<usize>() {
                if parsed == 0 {
                    errors.push("limit must be a whole number".into());
                } else {
                    requested_limit = Some(RequestedLimit::Number(parsed));
                    limit_value = parsed.min(max_limit.max(1));
                }
            }
        }

        let offset_candidate = parse_integer(offset, MAX_PAGINATION_DIGITS, "offset", &mut errors);
        let page_candidate = parse_integer(page, MAX_PAGINATION_DIGITS, "page", &mut errors);

        let derived_offset = offset_candidate.or_else(|| {
            page_candidate
                .filter(|value| *value > 0)
                .map(|value| (value - 1) * limit_value)
        });
        let offset = derived_offset.unwrap_or(0);
        let page = if limit_value > 0 {
            (offset / limit_value) + 1
        } else {
            1
        };

        let country = normalize_filter_value(country, "country", MAX_FILTER_LENGTH, &mut errors);
        let language = normalize_filter_value(language, "language", MAX_FILTER_LENGTH, &mut errors);
        let tag = normalize_filter_value(tag, "tag", MAX_FILTER_LENGTH, &mut errors);
        let genre = normalize_filter_value(genre, "genre", MAX_FILTER_LENGTH, &mut errors);
        let search = normalize_search_value(search, &mut errors);

        if !errors.is_empty() {
            return Err(errors);
        }

        let force_refresh = parse_bool(force_refresh.or(refresh));

        Ok(NormalizedStationsQuery {
            limit: limit_value,
            offset,
            page,
            requested_limit,
            country,
            language,
            tag,
            genre,
            search,
            force_refresh,
        })
    }
}

#[derive(Debug)]
struct NormalizedStationsQuery {
    limit: usize,
    offset: usize,
    page: usize,
    requested_limit: Option<RequestedLimit>,
    country: Option<String>,
    language: Option<String>,
    tag: Option<String>,
    genre: Option<String>,
    search: Option<String>,
    force_refresh: bool,
}

#[derive(Debug, Clone)]
enum RequestedLimit {
    Number(usize),
    All,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
enum RequestedLimitMetaValue {
    Number(usize),
    All(&'static str),
}

impl From<&RequestedLimit> for RequestedLimitMetaValue {
    fn from(value: &RequestedLimit) -> Self {
        match value {
            RequestedLimit::Number(v) => RequestedLimitMetaValue::Number(*v),
            RequestedLimit::All => RequestedLimitMetaValue::All("all"),
        }
    }
}

fn normalize_raw_value(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn parse_integer(
    value: Option<String>,
    max_digits: usize,
    label: &'static str,
    errors: &mut Vec<String>,
) -> Option<usize> {
    if let Some(raw) = normalize_raw_value(value) {
        if raw.len() > max_digits || !raw.chars().all(|c| c.is_ascii_digit()) {
            errors.push(format!("{label} must be a whole number"));
            return None;
        }
        if let Ok(parsed) = raw.parse::<usize>() {
            return Some(parsed);
        }
        errors.push(format!("{label} must be a whole number"));
    }
    None
}

fn normalize_filter_value(
    value: Option<String>,
    field: &'static str,
    max_len: usize,
    errors: &mut Vec<String>,
) -> Option<String> {
    if let Some(raw) = normalize_raw_value(value) {
        if raw.chars().count() > max_len {
            errors.push(format!("{field} must be at most {max_len} characters"));
            None
        } else {
            Some(raw.to_lowercase())
        }
    } else {
        None
    }
}

fn normalize_search_value(value: Option<String>, errors: &mut Vec<String>) -> Option<String> {
    if let Some(raw) = normalize_raw_value(value) {
        if raw.chars().count() > MAX_SEARCH_LENGTH {
            errors.push(format!(
                "search must be at most {MAX_SEARCH_LENGTH} characters"
            ));
            None
        } else {
            Some(raw.to_lowercase())
        }
    } else {
        None
    }
}
