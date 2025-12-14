use axum::{Json, extract::State, response::IntoResponse};
use serde::Serialize;
use std::sync::Arc;

use crate::app::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    turnstile_site_key: Option<String>,
}

pub async fn get_frontend_config(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let turnstile_site_key = state
        .config
        .contact
        .as_ref()
        .filter(|c| c.turnstile.enabled)
        .map(|c| c.turnstile.site_key.clone())
        .filter(|k| !k.is_empty());

    Json(FrontendConfig { turnstile_site_key })
}
