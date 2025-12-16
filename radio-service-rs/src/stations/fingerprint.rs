use anyhow::Result;
use sha2::{Digest, Sha256};

use super::Station;

pub fn build_stations_fingerprint(stations: &[Station]) -> Result<String> {
    let mut hasher = Sha256::new();

    // Sort stations by ID to make fingerprint order-independent.
    // This ensures the same fingerprint is produced regardless of whether
    // stations are loaded from Radio Browser (click-count order) or
    // database (alphabetical name order).
    let mut sorted_stations: Vec<&Station> = stations.iter().collect();
    sorted_stations.sort_by(|a, b| a.id.cmp(&b.id));

    for station in sorted_stations {
        let serialized = serde_json::to_vec(station)?;
        hasher.update(serialized);
        hasher.update(b"\n");
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Build a fingerprint that is sensitive to the ordering of `stations`.
///
/// This is intentionally different from [`build_stations_fingerprint`]. We use it to
/// key caches whose internal indexes depend on the order of the station list.
pub fn build_stations_order_fingerprint(stations: &[Station]) -> Result<String> {
    let mut hasher = Sha256::new();
    for station in stations {
        hasher.update(station.id.as_bytes());
        hasher.update(b"\n");
    }
    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use crate::stations::{
        build_stations_order_fingerprint, Station, StationCoordinates, StationsPayload,
        STATIONS_SCHEMA_VERSION,
    };

    #[test]
    fn fingerprint_is_deterministic() {
        let station = Station {
            id: "abc".into(),
            name: "Test".into(),
            stream_url: "https://example.com".into(),
            homepage: None,
            favicon: None,
            country: Some("Wonderland".into()),
            country_code: Some("WL".into()),
            state: None,
            languages: vec!["en".into()],
            tags: vec!["pop".into()],
            coordinates: Some(StationCoordinates { lat: 1.0, lon: 2.0 }),
            bitrate: Some(128),
            codec: Some("mp3".into()),
            hls: false,
            is_online: true,
            last_checked_at: None,
            last_changed_at: None,
            click_count: 10,
            click_trend: 2,
            votes: 3,
        };

        let mut payload = StationsPayload {
            schema_version: Some(STATIONS_SCHEMA_VERSION),
            updated_at: Utc.timestamp_millis_opt(0).unwrap(),
            source: None,
            requests: vec![],
            total: 1,
            stations: vec![station],
            fingerprint: None,
        };

        let fp1 = payload.ensure_fingerprint().unwrap().to_string();
        let fp2 = payload.ensure_fingerprint().unwrap().to_string();
        assert_eq!(fp1, fp2);
    }

    #[test]
    fn fingerprint_is_order_independent() {
        // Station fingerprints are used for cache versioning / change detection and must be stable
        // even if the same station set is loaded in a different order (e.g. Radio Browser order
        // vs database order).
        let station_a = Station {
            id: "aaa-station".into(),
            name: "Station A".into(),
            stream_url: "https://a.example.com".into(),
            homepage: None,
            favicon: None,
            country: Some("Country A".into()),
            country_code: Some("CA".into()),
            state: None,
            languages: vec!["en".into()],
            tags: vec!["pop".into()],
            coordinates: Some(StationCoordinates { lat: 1.0, lon: 2.0 }),
            bitrate: Some(128),
            codec: Some("mp3".into()),
            hls: false,
            is_online: true,
            last_checked_at: None,
            last_changed_at: None,
            click_count: 100,
            click_trend: 5,
            votes: 10,
        };

        let station_b = Station {
            id: "bbb-station".into(),
            name: "Station B".into(),
            stream_url: "https://b.example.com".into(),
            homepage: None,
            favicon: None,
            country: Some("Country B".into()),
            country_code: Some("CB".into()),
            state: None,
            languages: vec!["en".into()],
            tags: vec!["rock".into()],
            coordinates: Some(StationCoordinates { lat: 3.0, lon: 4.0 }),
            bitrate: Some(192),
            codec: Some("aac".into()),
            hls: false,
            is_online: true,
            last_checked_at: None,
            last_changed_at: None,
            click_count: 50,
            click_trend: 2,
            votes: 5,
        };

        let station_c = Station {
            id: "ccc-station".into(),
            name: "Station C".into(),
            stream_url: "https://c.example.com".into(),
            homepage: None,
            favicon: None,
            country: Some("Country C".into()),
            country_code: Some("CC".into()),
            state: None,
            languages: vec!["es".into()],
            tags: vec!["jazz".into()],
            coordinates: Some(StationCoordinates { lat: 5.0, lon: 6.0 }),
            bitrate: Some(256),
            codec: Some("mp3".into()),
            hls: false,
            is_online: true,
            last_checked_at: None,
            last_changed_at: None,
            click_count: 75,
            click_trend: 3,
            votes: 8,
        };

        // Simulate Radio Browser order (by click count descending)
        let mut payload_click_order = StationsPayload {
            schema_version: Some(STATIONS_SCHEMA_VERSION),
            updated_at: Utc.timestamp_millis_opt(0).unwrap(),
            source: None,
            requests: vec![],
            total: 3,
            stations: vec![station_a.clone(), station_c.clone(), station_b.clone()],
            fingerprint: None,
        };

        // Simulate database order (alphabetical by name)
        let mut payload_alpha_order = StationsPayload {
            schema_version: Some(STATIONS_SCHEMA_VERSION),
            updated_at: Utc.timestamp_millis_opt(0).unwrap(),
            source: None,
            requests: vec![],
            total: 3,
            stations: vec![station_a.clone(), station_b.clone(), station_c.clone()],
            fingerprint: None,
        };

        let fp_click = payload_click_order
            .ensure_fingerprint()
            .unwrap()
            .to_string();
        let fp_alpha = payload_alpha_order
            .ensure_fingerprint()
            .unwrap()
            .to_string();

        // Both should produce the same fingerprint despite different order
        assert_eq!(
            fp_click, fp_alpha,
            "Fingerprints should be identical regardless of station order"
        );
    }

    #[test]
    fn order_fingerprint_changes_when_order_changes() {
        let station_a = Station {
            id: "aaa-station".into(),
            name: "Station A".into(),
            stream_url: "https://a.example.com".into(),
            homepage: None,
            favicon: None,
            country: Some("Country A".into()),
            country_code: Some("CA".into()),
            state: None,
            languages: vec!["en".into()],
            tags: vec!["pop".into()],
            coordinates: Some(StationCoordinates { lat: 1.0, lon: 2.0 }),
            bitrate: Some(128),
            codec: Some("mp3".into()),
            hls: false,
            is_online: true,
            last_checked_at: None,
            last_changed_at: None,
            click_count: 100,
            click_trend: 5,
            votes: 10,
        };

        let station_b = Station {
            id: "bbb-station".into(),
            name: "Station B".into(),
            stream_url: "https://b.example.com".into(),
            homepage: None,
            favicon: None,
            country: Some("Country B".into()),
            country_code: Some("CB".into()),
            state: None,
            languages: vec!["en".into()],
            tags: vec!["rock".into()],
            coordinates: Some(StationCoordinates { lat: 3.0, lon: 4.0 }),
            bitrate: Some(192),
            codec: Some("aac".into()),
            hls: false,
            is_online: true,
            last_checked_at: None,
            last_changed_at: None,
            click_count: 50,
            click_trend: 2,
            votes: 5,
        };

        let ordered = vec![station_a.clone(), station_b.clone()];
        let reversed = vec![station_b, station_a];

        let fp_ordered = build_stations_order_fingerprint(&ordered).unwrap();
        let fp_reversed = build_stations_order_fingerprint(&reversed).unwrap();
        assert_ne!(fp_ordered, fp_reversed);

        let mut payload_ordered = StationsPayload {
            schema_version: Some(STATIONS_SCHEMA_VERSION),
            updated_at: Utc.timestamp_millis_opt(0).unwrap(),
            source: None,
            requests: vec![],
            total: 2,
            stations: ordered,
            fingerprint: None,
        };

        let mut payload_reversed = StationsPayload {
            schema_version: Some(STATIONS_SCHEMA_VERSION),
            updated_at: Utc.timestamp_millis_opt(0).unwrap(),
            source: None,
            requests: vec![],
            total: 2,
            stations: reversed,
            fingerprint: None,
        };

        let set_fp_ordered = payload_ordered.ensure_fingerprint().unwrap().to_string();
        let set_fp_reversed = payload_reversed.ensure_fingerprint().unwrap().to_string();
        assert_eq!(
            set_fp_ordered, set_fp_reversed,
            "Set fingerprint stays stable across ordering changes"
        );

        let cache_key_ordered = payload_ordered.processed_cache_key().unwrap();
        let cache_key_reversed = payload_reversed.processed_cache_key().unwrap();
        assert_ne!(
            cache_key_ordered, cache_key_reversed,
            "Processed cache keys must change when station ordering changes"
        );
    }
}
