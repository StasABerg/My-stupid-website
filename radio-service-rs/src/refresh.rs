use crate::logging::logger;
use crate::{app_state::AppState, stations::StationsPayload};
use serde_json::json;

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
        .validate(payload.stations.clone(), &state.postgres)
        .await?;
    if validation.dropped > 0 {
        logger().info(
            "stream.validation",
            json!({
                "dropped": validation.dropped,
                "reasons": validation.reasons,
            }),
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
