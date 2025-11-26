mod app_state;
mod cache;
mod config;
mod database;
mod favorites;
mod http;
mod logging;
mod migrations;
mod radio_browser;
mod refresh;
mod stations;
mod stream_format;
mod stream_pipeline;
mod stream_validation;

use anyhow::Context;
use app_state::AppState;
use config::Config;
use migrations::run_migrations;
use serde_json::json;
use std::env;

use crate::logging::init_logger;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let logger = init_logger("radio-service-rs");

    let config = Config::load().context("failed to load configuration")?;

    if matches!(env::args().nth(1).as_deref(), Some("check-config")) {
        logger.info(
            "config.check_passed",
            serde_json::to_value(&config).unwrap_or_else(|_| json!({ "status": "ok" })),
        );
        return Ok(());
    }

    let state = AppState::initialize(config.clone())
        .await
        .context("failed to initialize application state")?;

    run_migrations(&state.postgres)
        .await
        .context("failed to run migrations")?;

    if matches!(env::args().nth(1).as_deref(), Some("refresh")) {
        let payload = state.update_stations().await?;
        logger.info(
            "refresh.completed",
            json!({
                "total": payload.total,
                "updatedAt": payload.updated_at.to_rfc3339(),
            }),
        );
        return Ok(());
    }

    logger.info(
        "server.initialized",
        json!({
            "port": config.port,
            "redisConfigured": true,
            "postgresConfigured": true,
        }),
    );

    http::serve(state).await.context("http server failed")
}
