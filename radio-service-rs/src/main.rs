mod app_state;
mod cache;
mod config;
mod database;
mod favorites;
mod http;
mod migrations;
mod radio_browser;
mod refresh;
mod stations;
mod stream_validation;

use anyhow::Context;
use app_state::AppState;
use config::Config;
use migrations::run_migrations;
use once_cell::sync::OnceCell;
use std::env;
use tracing::info;

fn init_tracing() {
    static INIT: OnceCell<()> = OnceCell::new();
    INIT.get_or_init(|| {
        let env_filter =
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());
        tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .with_target(false)
            .with_level(true)
            .json()
            .init();
    });
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let config = Config::load().context("failed to load configuration")?;
    let state = AppState::initialize(config.clone())
        .await
        .context("failed to initialize application state")?;

    run_migrations(&state.postgres)
        .await
        .context("failed to run migrations")?;

    if matches!(env::args().nth(1).as_deref(), Some("refresh")) {
        let payload = state.update_stations().await?;
        info!(
            total = payload.total,
            updated_at = payload.updated_at.to_rfc3339(),
            "refresh.completed"
        );
        return Ok(());
    }

    info!(
        port = config.port,
        redis_configured = true,
        postgres_configured = true,
        "radio-service-rs initialized"
    );

    http::serve(state).await.context("http server failed")
}
