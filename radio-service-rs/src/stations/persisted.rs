use super::{Station, StationsPayload, STATIONS_SCHEMA_VERSION};
use crate::stations::sanitize::{sanitize_station_url, sanitize_stream_url, sanitize_web_url};

fn sanitize_list(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn sanitize_station_record(
    mut station: Station,
    enforce_https_streams: bool,
    allow_insecure_transports: bool,
) -> Option<(Station, bool)> {
    if !station.is_online {
        return None;
    }

    let mut changed = false;

    let sanitized_stream = sanitize_stream_url(&station.stream_url)?;
    if sanitized_stream != station.stream_url {
        station.stream_url = sanitized_stream;
        changed = true;
    }

    let sanitized_homepage = sanitize_station_url(
        station.homepage.as_deref(),
        enforce_https_streams,
        allow_insecure_transports,
    );
    if sanitized_homepage != station.homepage {
        station.homepage = sanitized_homepage;
        changed = true;
    }

    let sanitized_favicon = sanitize_station_url(
        station.favicon.as_deref(),
        enforce_https_streams,
        allow_insecure_transports,
    );
    if sanitized_favicon != station.favicon {
        station.favicon = sanitized_favicon;
        changed = true;
    }

    let sanitized_languages = sanitize_list(station.languages.clone());
    if sanitized_languages != station.languages {
        station.languages = sanitized_languages;
        changed = true;
    }

    let sanitized_tags = sanitize_list(station.tags.clone());
    if sanitized_tags != station.tags {
        station.tags = sanitized_tags;
        changed = true;
    }

    Some((station, changed))
}

pub fn sanitize_persisted_payload(
    payload: StationsPayload,
    enforce_https_streams: bool,
    allow_insecure_transports: bool,
) -> Option<(StationsPayload, bool)> {
    let mut changed = payload.schema_version != Some(STATIONS_SCHEMA_VERSION);
    let mut sanitized_stations = Vec::with_capacity(payload.stations.len());
    for station in payload.stations.into_iter() {
        match sanitize_station_record(station, enforce_https_streams, allow_insecure_transports) {
            Some((sanitized, station_changed)) => {
                if station_changed {
                    changed = true;
                }
                sanitized_stations.push(sanitized);
            }
            None => {
                changed = true;
            }
        }
    }

    if sanitized_stations.is_empty() {
        return None;
    }

    let mut payload = StationsPayload {
        stations: sanitized_stations,
        schema_version: Some(STATIONS_SCHEMA_VERSION),
        ..payload
    };
    payload.total = payload.stations.len();

    let sanitized_source = payload
        .source
        .as_deref()
        .and_then(|url| sanitize_web_url(url, true, allow_insecure_transports));
    if sanitized_source != payload.source {
        payload.source = sanitized_source;
        changed = true;
    }

    let sanitized_requests: Vec<String> = payload
        .requests
        .iter()
        .filter_map(|url| sanitize_web_url(url, true, allow_insecure_transports))
        .collect();
    if !sanitized_requests.is_empty() && sanitized_requests != payload.requests {
        payload.requests = sanitized_requests;
        changed = true;
    }

    Some((payload, changed))
}
