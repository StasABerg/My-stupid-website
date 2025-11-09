use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, SystemTime},
};

use deadpool_redis::{redis::AsyncCommands, Pool};
use futures_util::{stream, StreamExt};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use tokio::time::timeout;

use crate::{
    config::StreamValidationConfig,
    stations::{build_station_signature, is_blocked_domain, Station},
};

const VALIDATION_HEADERS: &[(&str, &str)] = &[
    ("range", "bytes=0-4095"),
    ("user-agent", "radio-service-rs validation"),
    ("accept", "*/*"),
    ("accept-encoding", "gzip, deflate, br"),
    ("connection", "keep-alive"),
];

#[derive(Debug, Clone)]
pub struct StreamValidator {
    config: StreamValidationConfig,
    client: Client,
}

#[derive(Debug)]
pub struct ValidationSummary {
    pub stations: Vec<Station>,
    pub dropped: usize,
    pub reasons: HashMap<String, i32>,
}

impl StreamValidator {
    pub fn new(config: StreamValidationConfig, client: Client) -> Self {
        Self { config, client }
    }

    pub async fn validate(
        &self,
        stations: Vec<Station>,
        redis: &Pool,
    ) -> anyhow::Result<ValidationSummary> {
        if !self.config.enabled {
            return Ok(ValidationSummary {
                stations,
                dropped: 0,
                reasons: HashMap::new(),
            });
        }

        let cache = Arc::new(self.load_cache(redis).await?);
        let now = current_timestamp();

        let outcomes = stream::iter(stations.into_iter().enumerate())
            .map(|(idx, station)| {
                let cache_entry = cache.get(&station.stream_url).cloned();
                async move { self.process_station(idx, station, cache_entry, now).await }
            })
            .buffer_unordered(self.config.concurrency)
            .collect::<Vec<_>>()
            .await;

        let mut accepted = Vec::new();
        let mut dropped = 0;
        let mut reasons: HashMap<String, i32> = HashMap::new();
        let mut cache_updates: HashMap<String, CacheEntry> = HashMap::new();

        for outcome in outcomes {
            match outcome {
                ValidationOutcome::Accepted {
                    idx,
                    station,
                    cache_update,
                } => {
                    if let Some((key, entry)) = cache_update {
                        cache_updates.insert(key, entry);
                    }
                    accepted.push((idx, station));
                }
                ValidationOutcome::Dropped {
                    reason,
                    cache_update,
                } => {
                    if let Some((key, entry)) = cache_update {
                        cache_updates.insert(key, entry);
                    }
                    record_drop(&mut reasons, Some(&reason));
                    dropped += 1;
                }
            }
        }

        accepted.sort_by_key(|(idx, _)| *idx);
        let stations = accepted.into_iter().map(|(_, station)| station).collect();
        self.write_cache(redis, cache_updates).await?;

        Ok(ValidationSummary {
            stations,
            dropped,
            reasons,
        })
    }

    async fn process_station(
        &self,
        idx: usize,
        mut station: Station,
        cache_entry: Option<CacheEntry>,
        now: i64,
    ) -> ValidationOutcome {
        let signature = build_station_signature(&station);
        if let Some(entry) = cache_entry {
            if entry.is_valid(now, &signature, &self.config) {
                if entry.ok {
                    station = entry.apply(station);
                    return ValidationOutcome::accepted(idx, station, None);
                }
                return ValidationOutcome::dropped(
                    entry.reason.unwrap_or_else(|| "invalid".into()),
                    None,
                );
            }
        }

        match self.validate_station(&station).await {
            Ok(result) => {
                let cache_entry = CacheEntry::success(&result, &signature, &self.config);
                if let Some(final_url) = result.final_url {
                    station.stream_url = final_url.clone();
                }
                if result.force_hls {
                    station.hls = true;
                }
                let stream_url = station.stream_url.clone();
                ValidationOutcome::accepted(idx, station, Some((stream_url, cache_entry)))
            }
            Err(reason) => {
                let cache_entry = CacheEntry::failure(&reason, &signature, &self.config);
                let stream_url = station.stream_url.clone();
                ValidationOutcome::dropped(reason, Some((stream_url, cache_entry)))
            }
        }
    }

    async fn validate_station(&self, station: &Station) -> Result<ValidatedStream, String> {
        if is_blocked_domain(&station.stream_url) {
            return Err("blocked-domain".to_string());
        }
        let request = self
            .client
            .get(&station.stream_url)
            .headers(build_validation_headers());

        let response = timeout(
            Duration::from_millis(self.config.timeout_ms),
            request.send(),
        )
        .await
        .map_err(|_| "timeout".to_string())?
        .map_err(|_| "network".to_string())?;

        if !(response.status().is_success() || response.status() == StatusCode::PARTIAL_CONTENT) {
            return Err(format!("status-{}", response.status().as_u16()));
        }

        let final_url = response.url().to_string();
        if !final_url.to_ascii_lowercase().starts_with("https://") {
            return Err("insecure-redirect".to_string());
        }
        if is_blocked_domain(&final_url) {
            return Err("blocked-domain".to_string());
        }

        let corp_header = response
            .headers()
            .get("cross-origin-resource-policy")
            .and_then(|value| value.to_str().ok())
            .map(|value| value.trim().to_string());
        if let Some(corp) = corp_header {
            if !corp.eq_ignore_ascii_case("cross-origin") {
                return Err(format!("corp-{}", corp.to_ascii_lowercase()));
            }
        }

        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        if !is_known_stream_type(&content_type) {
            return Err("unexpected-content-type".to_string());
        }

        let mut has_data = false;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "network".to_string())?;
            if !chunk.is_empty() {
                has_data = true;
                break;
            }
        }
        if !has_data {
            return Err("empty-response".to_string());
        }

        let force_hls = content_type.to_ascii_lowercase().contains("mpegurl");
        Ok(ValidatedStream {
            final_url: Some(final_url),
            force_hls,
        })
    }

    async fn load_cache(&self, redis: &Pool) -> anyhow::Result<HashMap<String, CacheEntry>> {
        let mut conn = redis.get().await?;
        let raw: HashMap<String, String> = conn
            .hgetall(&self.config.cache_key)
            .await
            .unwrap_or_default();
        let mut map = HashMap::new();
        for (key, value) in raw {
            if let Ok(entry) = serde_json::from_str::<CacheEntry>(&value) {
                map.insert(key, entry);
            }
        }
        Ok(map)
    }

    async fn write_cache(
        &self,
        redis: &Pool,
        updates: HashMap<String, CacheEntry>,
    ) -> anyhow::Result<()> {
        if updates.is_empty() {
            return Ok(());
        }
        let mut conn = redis.get().await?;
        let mut pipe = deadpool_redis::redis::pipe();
        for (stream_url, entry) in updates {
            pipe.hset(
                &self.config.cache_key,
                stream_url,
                serde_json::to_string(&entry)?,
            );
        }
        pipe.expire(&self.config.cache_key, self.config.cache_ttl_seconds as i64);
        pipe.query_async::<()>(&mut conn).await?;
        Ok(())
    }
}

fn build_validation_headers() -> reqwest::header::HeaderMap {
    let mut map = reqwest::header::HeaderMap::new();
    for (key, value) in VALIDATION_HEADERS {
        if let (Ok(name), Ok(val)) = (
            reqwest::header::HeaderName::from_lowercase(key.as_bytes()),
            reqwest::header::HeaderValue::from_str(value),
        ) {
            map.insert(name, val);
        }
    }
    map
}

fn is_known_stream_type(content_type: &str) -> bool {
    let lower = content_type.to_ascii_lowercase();
    lower.starts_with("audio/")
        || lower.starts_with("video/")
        || lower.contains("mpegurl")
        || lower == "application/octet-stream"
        || lower == "application/x-mpegurl"
}

fn record_drop(reasons: &mut HashMap<String, i32>, reason: Option<&str>) {
    let key = reason.unwrap_or("invalid").to_string();
    *reasons.entry(key).or_default() += 1;
}

#[derive(Clone, Serialize, Deserialize)]
struct CacheEntry {
    ok: bool,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    final_url: Option<String>,
    #[serde(default)]
    force_hls: bool,
    #[serde(default)]
    validated_at: i64,
    #[serde(default)]
    signature: Option<String>,
    #[serde(default)]
    ttl_seconds: Option<u64>,
}

impl CacheEntry {
    fn success(result: &ValidatedStream, signature: &str, config: &StreamValidationConfig) -> Self {
        Self {
            ok: true,
            reason: None,
            final_url: result.final_url.clone(),
            force_hls: result.force_hls,
            validated_at: current_timestamp(),
            signature: Some(signature.to_string()),
            ttl_seconds: Some(config.cache_ttl_seconds),
        }
    }

    fn failure(reason: &str, signature: &str, config: &StreamValidationConfig) -> Self {
        Self {
            ok: false,
            reason: Some(reason.to_string()),
            final_url: None,
            force_hls: false,
            validated_at: current_timestamp(),
            signature: Some(signature.to_string()),
            ttl_seconds: Some(config.failure_cache_ttl_seconds),
        }
    }

    fn is_valid(&self, now: i64, signature: &str, config: &StreamValidationConfig) -> bool {
        let ttl = self.ttl_seconds.unwrap_or(config.cache_ttl_seconds);
        if now - self.validated_at > ttl as i64 * 1000 {
            return false;
        }
        if let Some(entry_signature) = &self.signature {
            entry_signature == signature
        } else {
            false
        }
    }

    fn apply(&self, mut station: Station) -> Station {
        if let Some(final_url) = &self.final_url {
            station.stream_url = final_url.clone();
        }
        if self.force_hls {
            station.hls = true;
        }
        station
    }
}

#[derive(Debug)]
struct ValidatedStream {
    final_url: Option<String>,
    force_hls: bool,
}

enum ValidationOutcome {
    Accepted {
        idx: usize,
        station: Station,
        cache_update: Option<(String, CacheEntry)>,
    },
    Dropped {
        reason: String,
        cache_update: Option<(String, CacheEntry)>,
    },
}

impl ValidationOutcome {
    fn accepted(idx: usize, station: Station, cache_update: Option<(String, CacheEntry)>) -> Self {
        Self::Accepted {
            idx,
            station,
            cache_update,
        }
    }

    fn dropped(reason: String, cache_update: Option<(String, CacheEntry)>) -> Self {
        Self::Dropped {
            reason,
            cache_update,
        }
    }
}

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
