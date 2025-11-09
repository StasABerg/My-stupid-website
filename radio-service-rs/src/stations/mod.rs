#![allow(dead_code)]
mod fingerprint;
mod models;
mod persisted;
mod processed;
mod sanitize;
mod storage;

pub use fingerprint::build_stations_fingerprint;
pub use models::{Station, StationCoordinates, StationsPayload, STATIONS_SCHEMA_VERSION};
pub use persisted::sanitize_persisted_payload;
pub use processed::{intersect_lists, ProcessedStations};
pub use sanitize::{is_blocked_domain, sanitize_station_url, sanitize_stream_url};
pub use storage::StationStorage;

pub fn build_station_signature(station: &Station) -> String {
    format!(
        "{}|{}",
        station.stream_url,
        station.last_changed_at.as_deref().unwrap_or_default()
    )
}
