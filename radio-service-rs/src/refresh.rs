use tracing::info;

use crate::{app_state::AppState, stations::StationsPayload};

pub struct RefreshResult {
    pub payload: StationsPayload,
    #[allow(dead_code)]
    pub fingerprint: String,
    #[allow(dead_code)]
    pub updated_at: String,
}

pub async fn run_refresh(state: &AppState) -> anyhow::Result<RefreshResult> {
    let mut payload = state.radio_browser.fetch_payload().await?;
    let validation = state
        .stream_validator
        .validate(payload.stations.clone(), &state.redis)
        .await?;
    if validation.dropped > 0 {
        info!(
            dropped = validation.dropped,
            reasons = ?validation.reasons,
            "stream.validation"
        );
    }
    payload.stations = validation.stations;
    let fingerprint = payload.ensure_fingerprint()?.to_string();
    let updated_at = payload.updated_at.to_rfc3339();

    state
        .stations
        .persist_payload(&payload)
        .await
        .map_err(|err| anyhow::anyhow!(err))?;

    Ok(RefreshResult {
        payload,
        fingerprint,
        updated_at,
    })
}
