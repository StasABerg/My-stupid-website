use chrono::Utc;
use reqwest::{Client, Url};
use serde::Deserialize;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use crate::{
    config::RadioBrowserConfig,
    stations::{
        is_blocked_domain, sanitize_station_url, sanitize_stream_url, Station, StationCoordinates,
        StationsPayload, STATIONS_SCHEMA_VERSION,
    },
};

const RADIO_BROWSER_FALLBACK_HOSTS: &[&str] = &[
    "https://de1.api.radio-browser.info",
    "https://de2.api.radio-browser.info",
    "https://de3.api.radio-browser.info",
    "https://fr1.api.radio-browser.info",
    "https://nl1.api.radio-browser.info",
    "https://ru1.api.radio-browser.info",
];

#[derive(Clone)]
pub struct RadioBrowserClient {
    config: RadioBrowserConfig,
    client: Client,
    allow_insecure_transports: bool,
    host_pool: Vec<String>,
    host_cursor: Arc<AtomicUsize>,
}

impl RadioBrowserClient {
    pub fn new(
        config: RadioBrowserConfig,
        allow_insecure_transports: bool,
    ) -> anyhow::Result<Self> {
        let client = Client::builder()
            .user_agent(config.user_agent.clone())
            .danger_accept_invalid_certs(allow_insecure_transports)
            .build()?;
        let mut host_pool: Vec<String> = Vec::new();
        if !config.default_base_url.trim().is_empty() {
            host_pool.push(config.default_base_url.trim().to_string());
        }
        for candidate in RADIO_BROWSER_FALLBACK_HOSTS {
            let normalized = candidate.trim();
            if normalized.is_empty() {
                continue;
            }
            if !host_pool
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(normalized))
            {
                host_pool.push(normalized.to_string());
            }
        }
        if host_pool.is_empty() {
            return Err(anyhow::anyhow!(
                "RADIO_BROWSER_BASE_URL must be configured with a valid HTTPS endpoint"
            ));
        }
        Ok(Self {
            config,
            client,
            allow_insecure_transports,
            host_pool,
            host_cursor: Arc::new(AtomicUsize::new(0)),
        })
    }

    fn ordered_hosts(&self) -> Vec<String> {
        let len = self.host_pool.len();
        let start = self.host_cursor.fetch_add(1, Ordering::Relaxed) % len;
        let mut ordered = Vec::with_capacity(len);
        for offset in 0..len {
            ordered.push(self.host_pool[(start + offset) % len].clone());
        }
        ordered
    }

    pub async fn fetch_payload(&self) -> anyhow::Result<StationsPayload> {
        let mut last_error = None;
        for base in self.ordered_hosts() {
            match self.fetch_payload_from_host(&base).await {
                Ok(payload) => return Ok(payload),
                Err(error) => {
                    last_error = Some(error);
                }
            }
        }
        Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Radio Browser request failed")))
    }

    async fn fetch_payload_from_host(&self, base_url: &str) -> anyhow::Result<StationsPayload> {
        let mut stations_url = Url::parse(base_url)?;
        stations_url.set_path(self.config.stations_path.trim_start_matches('/'));
        {
            let mut query = stations_url.query_pairs_mut();
            query.append_pair("hidebroken", "true");
            query.append_pair("order", "clickcount");
            query.append_pair("reverse", "true");
            query.append_pair("lastcheckok", "1");
            query.append_pair("ssl_error", "0");
            if self.config.limit > 0 {
                query.append_pair("limit", &self.config.limit.to_string());
            }
        }

        let response = self.client.get(stations_url.clone()).send().await?;
        if !response.status().is_success() {
            return Err(anyhow::anyhow!(
                "radio browser returned {}",
                response.status()
            ));
        }

        let raw: Vec<RadioBrowserStation> = response.json().await?;
        let mut stations = Vec::new();
        for entry in raw {
            if let Some(station) =
                normalize_station(entry, &self.config, self.allow_insecure_transports)
            {
                stations.push(station);
                if self.config.limit > 0 && stations.len() as i64 >= self.config.limit {
                    break;
                }
            }
        }

        if stations.is_empty() {
            return Err(anyhow::anyhow!("Radio Browser returned no stations"));
        }

        let mut payload = StationsPayload {
            schema_version: Some(STATIONS_SCHEMA_VERSION),
            updated_at: Utc::now(),
            source: Some(stations_url.to_string()),
            requests: vec![stations_url.to_string()],
            total: stations.len(),
            stations,
            fingerprint: None,
        };
        payload.ensure_fingerprint()?;
        Ok(payload)
    }

    pub async fn record_click(&self, station_id: &str) -> anyhow::Result<()> {
        let mut last_error = None;
        for base in self.ordered_hosts() {
            match self.record_click_with_host(&base, station_id).await {
                Ok(_) => return Ok(()),
                Err(error) => last_error = Some(error),
            }
        }
        Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Radio Browser click failed")))
    }

    async fn record_click_with_host(&self, base_url: &str, station_id: &str) -> anyhow::Result<()> {
        let mut click_url = Url::parse(base_url)?;
        let base_path = self
            .config
            .station_click_path
            .trim_end_matches('/')
            .trim_start_matches('/');
        click_url.set_path(&format!("{base_path}/{}", station_id));

        let response = self.client.get(click_url.clone()).send().await?;
        if !response.status().is_success() {
            return Err(anyhow::anyhow!(
                "radio browser click returned {}",
                response.status()
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct RadioBrowserStation {
    stationuuid: String,
    name: String,
    url: Option<String>,
    url_resolved: Option<String>,
    homepage: Option<String>,
    favicon: Option<String>,
    country: Option<String>,
    countrycode: Option<String>,
    state: Option<String>,
    language: Option<String>,
    tags: Option<String>,
    geo_lat: Option<f64>,
    geo_long: Option<f64>,
    bitrate: Option<i32>,
    codec: Option<String>,
    hls: Option<i32>,
    lastcheckok: Option<i32>,
    lastchecktime: Option<String>,
    lastchecktime_iso8601: Option<String>,
    lastchangetime_iso8601: Option<String>,
    ssl_error: Option<i32>,
    clickcount: Option<i32>,
    clicktrend: Option<i32>,
    votes: Option<i32>,
}

fn normalize_station(
    raw: RadioBrowserStation,
    config: &RadioBrowserConfig,
    allow_insecure_transports: bool,
) -> Option<Station> {
    if raw.lastcheckok.unwrap_or_default() != 1 {
        return None;
    }
    if raw.ssl_error.unwrap_or_default() != 0 {
        return None;
    }
    let stream_candidate = raw
        .url_resolved
        .as_deref()
        .or(raw.url.as_deref())
        .unwrap_or_default();
    let stream_url = sanitize_stream_url(stream_candidate)?;
    if is_blocked_domain(&stream_url) {
        return None;
    }

    let homepage = sanitize_station_url(
        raw.homepage.as_deref(),
        config.enforce_https_streams,
        allow_insecure_transports,
    );
    let favicon = sanitize_station_url(
        raw.favicon.as_deref(),
        config.enforce_https_streams,
        allow_insecure_transports,
    );

    let coordinates = match (raw.geo_lat, raw.geo_long) {
        (Some(lat), Some(lon)) => Some(StationCoordinates { lat, lon }),
        _ => None,
    };

    Some(Station {
        id: raw.stationuuid,
        name: raw.name,
        stream_url,
        homepage,
        favicon,
        country: raw.country,
        country_code: raw.countrycode.map(|code| code.to_ascii_uppercase()),
        state: raw.state,
        languages: split_list(raw.language),
        tags: split_list(raw.tags),
        coordinates,
        bitrate: raw.bitrate,
        codec: raw.codec,
        hls: raw.hls.unwrap_or_default() == 1,
        is_online: true,
        last_checked_at: raw
            .lastchecktime_iso8601
            .or(raw.lastchecktime)
            .map(|s| s.trim().to_string()),
        last_changed_at: raw.lastchangetime_iso8601,
        click_count: raw.clickcount.unwrap_or_default(),
        click_trend: raw.clicktrend.unwrap_or_default(),
        votes: raw.votes.unwrap_or_default(),
    })
}

fn split_list(value: Option<String>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split(',')
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(|item| item.to_string())
        .collect()
}
