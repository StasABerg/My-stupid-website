use anyhow::Result;
use api_gateway_service::build_router;
use api_gateway_service::config::Config;
use api_gateway_service::logger::Logger;
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::signal;

#[tokio::main]
async fn main() -> Result<()> {
    let logger = Logger::new("api-gateway-service");
    let config = Arc::new(Config::load(&logger)?);

    if matches!(std::env::args().nth(1).as_deref(), Some("check-config")) {
        logger.info(
            "config.check_passed",
            json!({
                "port": config.port,
                "radioServiceUrl": config.radio_service_url,
                "terminalServiceUrl": config.terminal_service_url,
                "allowedHosts": config.allowed_service_hostnames,
                "cacheTtlSeconds": config.cache.ttl.as_secs(),
            }),
        );
        return Ok(());
    }

    let router = build_router(config.clone(), logger.clone()).await?;

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", config.port)).await?;
    logger.info(
        "server.started",
        json!({
            "port": config.port,
            "radioServiceUrl": config.radio_service_url,
            "terminalServiceUrl": config.terminal_service_url,
        }),
    );

    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal(logger.clone()))
    .await?;

    Ok(())
}

async fn shutdown_signal(logger: Logger) {
    let ctrl_c = async {
        signal::ctrl_c().await.ok();
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{SignalKind, signal};
        let mut sigterm =
            signal(SignalKind::terminate()).expect("failed to install SIGTERM handler");
        sigterm.recv().await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            logger.info("shutdown.ctrl_c", json!({"message": "Received Ctrl+C"}));
        }
        _ = terminate => {
            logger.info("shutdown.terminate", json!({"message": "Received SIGTERM"}));
        }
    }
}
