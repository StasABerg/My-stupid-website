mod commands;
mod config;
mod logger;
mod sandbox;

use axum::body::Body;
use axum::extract::{ConnectInfo, DefaultBodyLimit, State};
use axum::http::{HeaderName, HeaderValue, Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use commands::{CommandHandlers, CommandOutcome};
use config::Config;
use logger::Logger;
use sandbox::ensure_sandbox_filesystem;
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;
use sysinfo::System;
use tokio::net::TcpListener;
use tower_governor::GovernorLayer;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::key_extractor::SmartIpKeyExtractor;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    config: Arc<Config>,
    logger: Logger,
    handlers: Arc<CommandHandlers>,
    started_at: Instant,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::load()?;
    let hostname = hostname::get()
        .ok()
        .and_then(|value| value.into_string().ok())
        .unwrap_or_else(|| "unknown".to_string());
    let logger = Logger::new(hostname);

    if std::env::args().any(|arg| arg == "--config-check") {
        logger.info(
            "config.check_passed",
            json!({
                "port": config.port,
                "sandboxRoot": config.sandbox_root.display().to_string(),
                "allowedOrigins": config.allowed_origins,
                "allowAllOrigins": config.allow_all_origins,
            }),
        );
        return Ok(());
    }

    if tokio::fs::metadata(&config.sandbox_root).await.is_err() {
        logger.error(
            "sandbox.root_missing",
            json!({ "sandboxRoot": config.sandbox_root.display().to_string() }),
        );
        std::process::exit(1);
    }

    if let Err(error) = ensure_sandbox_filesystem(&config).await {
        logger.error(
            "sandbox.init_failed",
            json!({ "error": error.to_string() }),
        );
        std::process::exit(1);
    }

    let state = Arc::new(AppState {
        handlers: Arc::new(CommandHandlers::new(config.clone())),
        config: Arc::new(config),
        logger,
        started_at: Instant::now(),
    });

    let governor_config = GovernorConfigBuilder::default()
        .per_second(2)
        .burst_size(30)
        .key_extractor(SmartIpKeyExtractor)
        .finish()
        .expect("rate limiter config");

    let cors = build_cors(&state.config);

    let app = Router::new()
        .route("/healthz", get(handle_healthz))
        .route("/info", get(handle_info))
        .route("/execute", post(handle_execute))
        .route("/internal/status", get(handle_status))
        .route("/docs", get(handle_docs))
        .fallback(handle_not_found)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            request_context_middleware,
        ))
        .layer(GovernorLayer::new(governor_config))
        .layer(cors)
        .layer(DefaultBodyLimit::max(state.config.max_payload_bytes))
        .with_state(state.clone());

    let addr = SocketAddr::from(([0, 0, 0, 0], state.config.port));
    let listener = TcpListener::bind(addr).await?;
    state.logger.info(
        "server.started",
        json!({ "port": state.config.port, "sandboxRoot": state.config.sandbox_root.display().to_string() }),
    );

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}

async fn request_context_middleware(
    State(state): State<Arc<AppState>>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let request_id = request
        .headers()
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let origin = request
        .headers()
        .get("origin")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());

    let client_ip = resolve_client_ip(&request, request.extensions().get::<ConnectInfo<SocketAddr>>());
    let method = request.method().to_string();
    let raw_url = request.uri().to_string();

    let started_at = Instant::now();
    state.logger.info(
        "request.received",
        json!({
            "requestId": request_id,
            "method": method,
            "rawUrl": raw_url,
            "origin": origin,
            "clientIp": client_ip,
        }),
    );


    let mut response = next.run(request).await;
    response.headers_mut().insert(
        HeaderName::from_static("x-request-id"),
        HeaderValue::from_str(&request_id).unwrap_or_else(|_| HeaderValue::from_static("")),
    );

    let duration_ms = started_at.elapsed().as_secs_f64() * 1000.0;
    state.logger.info(
        "request.completed",
        json!({
            "requestId": request_id,
            "method": method,
            "rawUrl": raw_url,
            "statusCode": response.status().as_u16(),
            "durationMs": duration_ms,
            "origin": origin,
            "clientIp": client_ip,
        }),
    );

    response
}

fn resolve_client_ip(request: &Request<Body>, connect: Option<&ConnectInfo<SocketAddr>>) -> Option<String> {
    let forwarded = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if forwarded.is_some() {
        return forwarded;
    }
    let real_ip = request
        .headers()
        .get("x-real-ip")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if real_ip.is_some() {
        return real_ip;
    }
    connect.map(|info| info.0.ip().to_string())
}

fn build_cors(config: &Config) -> tower_http::cors::CorsLayer {
    use tower_http::cors::{AllowOrigin, Any, CorsLayer};
    if config.allow_all_origins {
        return CorsLayer::new().allow_origin(Any).allow_credentials(true);
    }
    let allowed: Vec<HeaderValue> = config
        .allowed_origins
        .iter()
        .filter_map(|origin| origin.parse::<HeaderValue>().ok())
        .collect();
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(allowed))
        .allow_credentials(true)
}

async fn handle_healthz() -> impl IntoResponse {
    (StatusCode::OK, Json(json!({ "status": "ok" })))
}

async fn handle_info(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let motd = read_motd_lines(&state.config).await;
    let payload = state.handlers.handle_info(motd).await;
    (StatusCode::OK, Json(payload))
}

async fn handle_execute(
    State(state): State<Arc<AppState>>,
    bytes: axum::body::Bytes,
) -> Response {
    if bytes.is_empty() {
        return json_response(CommandOutcome::malformed_body());
    }
    let value: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => return json_response(CommandOutcome::invalid_json()),
    };
    if !value.is_object() {
        return json_response(CommandOutcome::malformed_body());
    }
    let input = value.get("input");
    let Some(input) = input.and_then(|value| value.as_str()) else {
        return json_response(CommandOutcome::validation_error(
            "Field \"input\" must be a string".to_string(),
        ));
    };
    let cwd = value.get("cwd").and_then(|value| value.as_str());

    let outcome = state.handlers.handle_execute(input, cwd).await;
    json_response(outcome)
}

async fn handle_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut system = System::new();
    system.refresh_memory();
    let uptime = state.started_at.elapsed().as_secs();
    let total_memory = system.total_memory();
    let used_memory = system.used_memory();

    let payload = json!({
        "status": "ok",
        "uptimeSeconds": uptime,
        "memoryTotalBytes": total_memory * 1024,
        "memoryUsedBytes": used_memory * 1024,
        "sandboxRoot": state.config.sandbox_root.display().to_string(),
    });

    (StatusCode::OK, Json(payload))
}

async fn handle_docs() -> impl IntoResponse {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({ "message": "Docs not yet available" })),
    )
}

async fn handle_not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "message": "Not Found" })),
    )
}

fn json_response(outcome: CommandOutcome) -> Response {
    let mut response = Json(outcome.payload).into_response();
    *response.status_mut() = StatusCode::from_u16(outcome.status).unwrap_or(StatusCode::OK);
    response
}

async fn read_motd_lines(config: &Config) -> Vec<String> {
    if config.motd_virtual_path.is_empty() {
        return vec![];
    }
    match tokio::fs::read_to_string(&config.motd_virtual_path).await {
        Ok(content) => content
            .lines()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
            .map(|line| line.to_string())
            .collect(),
        Err(_) => vec![],
    }
}
