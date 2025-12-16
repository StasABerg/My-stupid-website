use anyhow::Result;
use fmd::app::build_router;
use fmd::config::Config;
use fmd::logger::Logger;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::signal;

#[tokio::main]
async fn main() -> Result<()> {
    let config = Arc::new(Config::load()?);
    let logger = Logger::new("fmd");
    let router = build_router(config.clone(), logger.clone());

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    logger.info(
        "server.starting",
        serde_json::json!({ "port": config.port }),
    );

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    logger.info("server.stopped", serde_json::json!({}));
    Ok(())
}

async fn shutdown_signal() {
    let _ = signal::ctrl_c().await;
}
