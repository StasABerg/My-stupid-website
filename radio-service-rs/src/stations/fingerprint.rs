use anyhow::Result;
use sha2::{Digest, Sha256};

use super::Station;

pub fn build_stations_fingerprint(stations: &[Station]) -> Result<String> {
    let mut hasher = Sha256::new();
    for station in stations {
        let serialized = serde_json::to_vec(station)?;
        hasher.update(serialized);
        hasher.update(b"\n");
    }
    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use crate::stations::{Station, StationCoordinates, StationsPayload, STATIONS_SCHEMA_VERSION};

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
}
