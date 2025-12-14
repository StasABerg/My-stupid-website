use crate::cache::CacheHandle;
use crate::config::Config;
use crate::cors::Cors;
use crate::docs;
use crate::logger::Logger;
use crate::metrics::GatewayMetrics;
use crate::proxy::{GatewayProxy, Proxy, ProxyOptions};
use crate::request_context::RequestContextManager;
use crate::routing::Routing;
use crate::session::SessionManager;
use anyhow::Result;
use axum::Json;
use axum::Router;
use axum::body::Body;
use axum::error_handling::HandleErrorLayer;
use axum::extract::{ConnectInfo, OriginalUri, State};
use axum::http::{HeaderMap, HeaderName, Method, Request, Response, StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::{delete, get, head, options, patch, post, put};
use http::HeaderValue;
use http_body_util::BodyExt;
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use time::{OffsetDateTime, format_description::well_known::Rfc2822};
use tower::timeout::TimeoutLayer;
use tower::{BoxError, ServiceBuilder};

const OVERLOAD_THRESHOLD_MS: u64 = 1_000;
const PRE_FLIGHT_MAX_AGE: &str = "600";
const OVERLOAD_MESSAGE: &str = "Gateway overloaded";

pub async fn build_router(config: Arc<Config>, logger: Logger) -> Result<Router> {
    let cache = CacheHandle::new(config.cache.clone(), logger.clone()).await?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let proxy = Arc::new(Proxy::new(
        client,
        cache,
        logger.clone(),
        config.trust_proxy,
    )) as Arc<dyn GatewayProxy>;
    build_router_with_proxy(config, logger, proxy).await
}

pub async fn build_router_with_proxy(
    config: Arc<Config>,
    logger: Logger,
    proxy: Arc<dyn GatewayProxy>,
) -> Result<Router> {
    let session_manager = Arc::new(SessionManager::new(config.clone(), logger.clone()).await?);
    let routing = Routing::new(config.clone(), logger.clone());
    routing.validate_base_urls()?;
    let cors = Cors::new(config.allow_origins.clone());
    let metrics = GatewayMetrics::new(OVERLOAD_THRESHOLD_MS);
    let request_context = RequestContextManager::new(logger.clone(), metrics.clone());

    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let redis_cache_client = if let Some(redis_config) = &config.cache.redis {
        Some(redis::Client::open(redis_config.url.as_str())?)
    } else {
        None
    };

    let state = Arc::new(AppState {
        config,
        session_manager,
        cors,
        routing,
        proxy,
        request_context,
        metrics,
        logger,
        http_client,
        redis_cache_client,
    });

    let request_timeout = state.config.request_timeout;
    let timeout_logger = state.logger.clone();
    let timeout_layer = ServiceBuilder::new()
        .layer(HandleErrorLayer::new(move |error: BoxError| {
            let timeout_logger = timeout_logger.clone();
            async move {
                if error.is::<tower::timeout::error::Elapsed>() {
                    timeout_logger.warn(
                        "router.request_timeout",
                        json!({ "error": error.to_string() }),
                    );
                    (
                        StatusCode::GATEWAY_TIMEOUT,
                        Json(json!({ "error": "Request timed out" })),
                    )
                        .into_response()
                } else {
                    timeout_logger.error(
                        "router.unhandled_error",
                        json!({ "error": error.to_string() }),
                    );
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Unhandled gateway error" })),
                    )
                        .into_response()
                }
            }
        }))
        .layer(TimeoutLayer::new(request_timeout));

    Ok(Router::new()
        .route("/contact", post(crate::contact::handle_contact))
        .route("/session", post(handle_session_post))
        .route("/session", options(handle_session_options))
        .route("/session", get(handle_session_method_not_allowed))
        .route("/session", put(handle_session_method_not_allowed))
        .route("/session", patch(handle_session_method_not_allowed))
        .route("/session", delete(handle_session_method_not_allowed))
        .route("/session", head(handle_session_method_not_allowed))
        .route("/healthz", get(handle_healthz))
        .route("/internal/status", get(handle_internal_status))
        .route("/docs", get(handle_docs_html))
        .route("/docs/openapi.json", get(handle_docs_spec))
        .route("/docs/json", get(handle_docs_spec))
        .fallback(handle_proxy)
        .with_state(state.clone())
        .layer(timeout_layer))
}

pub struct AppState {
    pub config: Arc<Config>,
    pub session_manager: Arc<SessionManager>,
    pub cors: Cors,
    pub routing: Routing,
    pub proxy: Arc<dyn GatewayProxy>,
    pub request_context: RequestContextManager,
    pub metrics: GatewayMetrics,
    pub logger: Logger,
    pub http_client: reqwest::Client,
    pub redis_cache_client: Option<redis::Client>,
}

async fn handle_session_options(
    State(state): State<Arc<AppState>>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    OriginalUri(uri): OriginalUri,
) -> Response<Body> {
    let context = state
        .request_context
        .start(Method::OPTIONS, &uri, &headers, Some(&remote));
    let origin = headers
        .get("origin")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let cors_headers = state.cors.build_headers(origin.as_deref());

    let mut response_headers = HeaderMap::new();
    for (key, value) in cors_headers.iter() {
        response_headers.insert(key.clone(), value.clone());
    }
    response_headers.insert(
        HeaderName::from_static("access-control-max-age"),
        HeaderValue::from_static(PRE_FLIGHT_MAX_AGE),
    );
    let mut builder = Response::builder().status(StatusCode::NO_CONTENT);
    *builder.headers_mut().unwrap() = response_headers;
    context.complete(204, json!({"route": "session", "method": "OPTIONS"}));
    builder.body(Body::empty()).unwrap()
}

async fn handle_session_post(
    State(state): State<Arc<AppState>>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
) -> Response<Body> {
    let context = state
        .request_context
        .start(Method::POST, &uri, &headers, Some(&remote));
    let origin = headers
        .get("origin")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let cors_headers = state.cors.build_headers(origin.as_deref());
    if !state.cors.is_origin_allowed(origin.as_deref()) {
        context.complete(403, json!({"route": "session", "reason": "origin-denied"}));
        return json_response(
            StatusCode::FORBIDDEN,
            json!({"error": "Origin not allowed"}),
            cors_headers,
        );
    }

    if state.metrics.is_overloaded() {
        context.complete(503, json!({"route": "session", "reason": "overloaded"}));
        return json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error": OVERLOAD_MESSAGE}),
            cors_headers,
        );
    }

    match state.session_manager.issue_session().await {
        Ok(session) => {
            let cookie_value = build_session_cookie(
                state.session_manager.cookie_name(),
                &session.session_id,
                state.config.session.max_age,
            );
            let mut response_headers = cors_headers.clone();
            response_headers.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            );
            response_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            response_headers.insert(
                header::SET_COOKIE,
                HeaderValue::from_str(&cookie_value).unwrap(),
            );
            let body = json!({
                "csrfToken": session.csrf_token,
                "csrfProof": session.csrf_proof,
                "expiresAt": session.expires_at,
            });
            context.complete(200, json!({"route": "session"}));
            json_response(StatusCode::OK, body, response_headers)
        }
        Err(error) => {
            state
                .logger
                .error("session.issue_failed", json!({"error": error.to_string()}));
            context.complete(500, json!({"route": "session", "reason": "issue-failed"}));
            json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"error": "Failed to initialize session"}),
                cors_headers,
            )
        }
    }
}

async fn handle_session_method_not_allowed(
    State(state): State<Arc<AppState>>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    OriginalUri(uri): OriginalUri,
    method: Method,
    headers: HeaderMap,
) -> Response<Body> {
    let context = state
        .request_context
        .start(method.clone(), &uri, &headers, Some(&remote));
    let origin = headers
        .get("origin")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let cors_headers = state.cors.build_headers(origin.as_deref());
    context.complete(
        405,
        json!({"route": "session", "reason": "method-not-allowed", "method": method.as_str()}),
    );
    json_response(
        StatusCode::METHOD_NOT_ALLOWED,
        json!({"error": "Method Not Allowed"}),
        cors_headers,
    )
}

async fn handle_healthz() -> impl IntoResponse {
    axum::Json(json!({"status": "ok"}))
}

async fn handle_internal_status(State(state): State<Arc<AppState>>) -> Response<Body> {
    let snapshot = state.metrics.snapshot();
    json_response(
        StatusCode::OK,
        serde_json::to_value(snapshot).unwrap_or_else(|_| json!({ "status": "ok" })),
        HeaderMap::new(),
    )
}

async fn handle_docs_html() -> Response<Body> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(docs::docs_html()))
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from("failed to render docs"))
                .expect("failed to build docs response")
        })
}

async fn handle_docs_spec() -> Response<Body> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(docs::openapi_spec()))
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from("{}"))
                .expect("failed to build spec response")
        })
}

async fn handle_proxy(
    State(state): State<Arc<AppState>>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    OriginalUri(uri): OriginalUri,
    request: Request<Body>,
) -> Response<Body> {
    let headers_clone = request.headers().clone();
    let context = state.request_context.start(
        request.method().clone(),
        &uri,
        &headers_clone,
        Some(&remote),
    );

    let origin = request
        .headers()
        .get("origin")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let cors_headers = state.cors.build_headers(origin.as_deref());

    if request.method() == Method::OPTIONS {
        context.complete(204, json!({"route": "preflight"}));
        return build_preflight_response(cors_headers);
    }

    let parsed = match state.routing.parse_uri(&uri) {
        Ok(parsed) => parsed,
        Err(error) => {
            context.complete(
                error.status,
                json!({"route": "gateway", "reason": error.reason}),
            );
            return json_response(
                StatusCode::from_u16(error.status).unwrap_or(StatusCode::BAD_REQUEST),
                json!({"error": error.message}),
                cors_headers,
            );
        }
    };

    let target = match state.routing.determine_target(&parsed.path) {
        Some(target) => target,
        None => {
            context.complete(404, json!({"route": "gateway", "reason": "not-found"}));
            return json_response(
                StatusCode::NOT_FOUND,
                json!({"error": "Not Found"}),
                cors_headers,
            );
        }
    };
    if !state.cors.is_origin_allowed(origin.as_deref()) {
        context.complete(
            403,
            json!({"route": target.service, "reason": "origin-denied"}),
        );
        return json_response(
            StatusCode::FORBIDDEN,
            json!({"error": "Origin not allowed"}),
            cors_headers,
        );
    }

    if state.metrics.is_overloaded() {
        context.complete(
            503,
            json!({"route": target.service, "reason": "overloaded"}),
        );
        return json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error": OVERLOAD_MESSAGE}),
            cors_headers,
        );
    }

    let docs_access = (target.service == "radio" || target.service == "terminal")
        && target.path.starts_with("/docs");

    let session = match state
        .session_manager
        .validate_session(request.headers(), request.method(), Some(&uri))
        .await
    {
        Ok(snapshot) => Some(snapshot),
        Err(error) => {
            if docs_access {
                None
            } else {
                context.complete(
                    error.status,
                    json!({"route": target.service, "reason": error.message}),
                );
                return json_response(
                    StatusCode::from_u16(error.status).unwrap_or(StatusCode::UNAUTHORIZED),
                    json!({"error": error.message}),
                    cors_headers,
                );
            }
        }
    };

    if let Some(snapshot) = session.as_ref() {
        state.logger.debug(
            "session.validated",
            json!({
                "sessionId": snapshot.session_id,
                "expiresAt": snapshot.expires_at
            }),
        );
    }

    let cacheable = state.routing.should_cache(request.method(), &target);
    let cache_key = if cacheable {
        Some(
            state
                .routing
                .build_cache_key(&target, parsed.query.as_deref()),
        )
    } else {
        None
    };

    let (parts, body) = request.into_parts();
    let body_bytes = if requires_body(&parts.method) {
        match body.collect().await {
            Ok(collected) => Some(collected.to_bytes()),
            Err(error) => {
                state.logger.error(
                    "proxy.body_read_failed",
                    json!({"error": error.to_string()}),
                );
                context.complete(400, json!({"route": target.service, "reason": "body-read"}));
                return json_response(
                    StatusCode::BAD_REQUEST,
                    json!({"error": "Invalid request body"}),
                    cors_headers,
                );
            }
        }
    } else {
        None
    };

    let request_id = context.request_id.clone();
    let response = state
        .proxy
        .forward(
            parts,
            body_bytes,
            ProxyOptions {
                target: &target,
                query: parsed.query.as_deref(),
                session: session.as_ref(),
                cors_headers: cors_headers.clone(),
                cache_key,
                cacheable,
                remote_addr: Some(remote),
                request_id: &request_id,
            },
        )
        .await;

    let status = response.status().as_u16();
    let cache_status = response
        .headers()
        .get("x-cache")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    context.complete(
        status,
        json!({
            "route": target.service,
            "cache": cache_status,
        }),
    );
    response
}

fn requires_body(method: &Method) -> bool {
    !(method == Method::GET || method == Method::HEAD)
}

fn build_preflight_response(mut headers: HeaderMap) -> Response<Body> {
    headers.insert(
        HeaderName::from_static("access-control-max-age"),
        HeaderValue::from_static(PRE_FLIGHT_MAX_AGE),
    );
    let mut builder = Response::builder().status(StatusCode::NO_CONTENT);
    *builder.headers_mut().unwrap() = headers;
    builder.body(Body::empty()).unwrap_or_else(|_| {
        Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from("{}"))
            .expect("failed to build preflight response")
    })
}

fn json_response(
    status: StatusCode,
    body: serde_json::Value,
    mut headers: HeaderMap,
) -> Response<Body> {
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    let mut builder = Response::builder().status(status);
    *builder.headers_mut().unwrap() = headers;
    builder
        .body(Body::from(body.to_string()))
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from("{}"))
                .expect("failed to build JSON response")
        })
}

fn build_session_cookie(name: &str, value: &str, ttl: Duration) -> String {
    let expires = OffsetDateTime::now_utc() + time::Duration::seconds(ttl.as_secs() as i64);
    let expires_str = expires
        .format(&Rfc2822)
        .unwrap_or_else(|_| OffsetDateTime::now_utc().format(&Rfc2822).unwrap());
    format!(
        "{}={}; Max-Age={}; Expires={}; Path=/; HttpOnly; Secure; SameSite=Strict",
        name,
        value,
        ttl.as_secs(),
        expires_str
    )
}
