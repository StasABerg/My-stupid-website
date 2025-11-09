use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::Context;
use chrono::{DateTime, Utc};
use deadpool_redis::{redis::AsyncCommands, Pool as RedisPool};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tokio::sync::{Mutex, RwLock};
use tracing::{info, warn};

use crate::{
    cache::create_redis_pool,
    config::Config,
    database::create_postgres_pool,
    favorites::FavoritesStore,
    radio_browser::RadioBrowserClient,
    refresh,
    stations::{sanitize_persisted_payload, ProcessedStations, StationStorage, StationsPayload},
    stream_validation::StreamValidator,
};

#[allow(dead_code)]
#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub postgres: PgPool,
    pub redis: RedisPool,
    pub stations: StationStorage,
    pub favorites: FavoritesStore,
    pub radio_browser: RadioBrowserClient,
    pub http_client: Client,
    processed_cache: Arc<RwLock<Option<ProcessedCache>>>,
    pub stream_validator: StreamValidator,
    memory_cache: Arc<RwLock<Option<MemoryEntry>>>,
    refresh_mutex: Arc<Mutex<()>>,
    rate_limiter: Arc<RateLimiter>,
}

#[derive(Clone)]
struct ProcessedCache {
    fingerprint: String,
    data: ProcessedStations,
}

#[derive(Clone)]
struct MemoryEntry {
    payload: StationsPayload,
    cache_source: String,
    expires_at: Instant,
}

struct SanitizedPayload {
    payload: StationsPayload,
    upgraded: bool,
}

struct RateLimiter {
    max_requests: usize,
    window: Duration,
    buckets: Mutex<HashMap<String, Vec<Instant>>>,
}

impl RateLimiter {
    fn new(max_requests: usize, window: Duration) -> Self {
        Self {
            max_requests: max_requests.max(1),
            window,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    async fn check(&self, key: &str) -> bool {
        let mut guard = self.buckets.lock().await;
        let now = Instant::now();
        let entries = guard.entry(key.to_string()).or_default();
        entries.retain(|instant| now.duration_since(*instant) <= self.window);
        if entries.len() >= self.max_requests {
            return false;
        }
        entries.push(now);
        true
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct CachedStationsPayload {
    #[serde(rename = "schemaVersion")]
    schema_version: Option<SchemaVersionValue>,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    source: Option<String>,
    #[serde(default)]
    requests: Vec<String>,
    total: usize,
    fingerprint: Option<String>,
    stations: Vec<crate::stations::Station>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum SchemaVersionValue {
    Number(i32),
    String(String),
}

#[derive(Clone)]
pub struct LoadStationsResult {
    pub payload: StationsPayload,
    pub cache_source: String,
}

impl AppState {
    pub async fn initialize(config: Config) -> anyhow::Result<Self> {
        let postgres = create_postgres_pool(&config.postgres)
            .await
            .context("failed to connect to postgres")?;
        let redis = create_redis_pool(&config.redis_url).context("failed to create redis pool")?;

        let stations = StationStorage::new(postgres.clone());
        let favorites = FavoritesStore::new(redis.clone());
        let http_client = Client::builder()
            .build()
            .context("failed to build http client")?;
        let radio_browser = RadioBrowserClient::new(
            config.radio_browser.clone(),
            config.allow_insecure_transports,
        )?;
        let stream_validator =
            StreamValidator::new(config.stream_validation.clone(), http_client.clone());
        let processed_cache = Arc::new(RwLock::new(None));
        let memory_cache = Arc::new(RwLock::new(None));
        let refresh_mutex = Arc::new(Mutex::new(()));
        let rate_limiter = Arc::new(RateLimiter::new(100, Duration::from_secs(15 * 60)));

        Ok(Self {
            config,
            postgres,
            redis,
            stations,
            favorites,
            radio_browser,
            http_client,
            processed_cache,
            stream_validator,
            memory_cache,
            refresh_mutex,
            rate_limiter,
        })
    }
}

impl From<&StationsPayload> for CachedStationsPayload {
    fn from(payload: &StationsPayload) -> Self {
        Self {
            schema_version: payload.schema_version.map(SchemaVersionValue::Number),
            updated_at: payload.updated_at.to_rfc3339(),
            source: payload.source.clone(),
            requests: payload.requests.clone(),
            total: payload.total,
            fingerprint: payload.fingerprint.clone(),
            stations: payload.stations.clone(),
        }
    }
}

impl TryFrom<CachedStationsPayload> for StationsPayload {
    type Error = anyhow::Error;

    fn try_from(value: CachedStationsPayload) -> Result<Self, Self::Error> {
        let updated_at = DateTime::parse_from_rfc3339(&value.updated_at)
            .map_err(|error| anyhow::anyhow!(error))?
            .with_timezone(&Utc);
        Ok(StationsPayload {
            schema_version: value.schema_version.and_then(|schema| match schema {
                SchemaVersionValue::Number(v) => Some(v),
                SchemaVersionValue::String(raw) => raw.trim().parse().ok(),
            }),
            updated_at,
            source: value.source,
            requests: value.requests,
            total: value.total,
            stations: value.stations,
            fingerprint: value.fingerprint,
        })
    }
}

impl AppState {
    pub async fn ensure_processed(
        &self,
        fingerprint: &str,
        stations: &[crate::stations::Station],
    ) -> ProcessedStations {
        {
            let cache = self.processed_cache.read().await;
            if let Some(existing) = cache.as_ref() {
                if existing.fingerprint == fingerprint {
                    return existing.data.clone();
                }
            }
        }
        let processed = ProcessedStations::build(stations);
        let mut cache = self.processed_cache.write().await;
        *cache = Some(ProcessedCache {
            fingerprint: fingerprint.to_string(),
            data: processed.clone(),
        });
        processed
    }

    pub async fn load_stations(&self, force_refresh: bool) -> anyhow::Result<LoadStationsResult> {
        if !force_refresh {
            if let Some(entry) = self.get_memory_cache_entry().await {
                return Ok(entry);
            }

            if let Some(payload) = self.read_stations_from_cache().await? {
                if let Some(sanitized) = self.sanitize_payload(payload) {
                    let mut payload = sanitized.payload;
                    payload.ensure_fingerprint();
                    if sanitized.upgraded {
                        info!(source = "redis", "cache.upgraded");
                        self.write_stations_to_cache(&payload).await?;
                    }
                    self.cache_in_memory(payload.clone(), "cache").await;
                    self.ensure_processed(
                        payload.fingerprint.as_deref().unwrap_or("cache"),
                        &payload.stations,
                    )
                    .await;
                    return Ok(LoadStationsResult {
                        payload,
                        cache_source: "cache".into(),
                    });
                } else {
                    info!(source = "redis", "cache.invalid");
                }
            }

            if let Some(payload) = self.stations.load_latest_payload().await? {
                if let Some(sanitized) = self.sanitize_payload(payload) {
                    let mut payload = sanitized.payload;
                    payload.ensure_fingerprint();
                    if sanitized.upgraded {
                        info!(source = "database", "cache.upgraded");
                    }
                    self.write_stations_to_cache(&payload).await?;
                    self.cache_in_memory(payload.clone(), "database").await;
                    self.ensure_processed(
                        payload.fingerprint.as_deref().unwrap_or("database"),
                        &payload.stations,
                    )
                    .await;
                    self.schedule_background_refresh();
                    return Ok(LoadStationsResult {
                        payload,
                        cache_source: "database".into(),
                    });
                } else {
                    info!(source = "database", "stations.payload_invalid");
                }
            }
        }

        let payload = self.refresh_and_cache().await?;
        Ok(LoadStationsResult {
            payload,
            cache_source: "radio-browser".into(),
        })
    }

    pub async fn update_stations(&self) -> anyhow::Result<StationsPayload> {
        self.refresh_and_cache().await
    }

    pub async fn record_station_click(&self, station_id: &str) -> anyhow::Result<()> {
        self.radio_browser
            .record_click(station_id)
            .await
            .map_err(anyhow::Error::from)
    }

    async fn refresh_and_cache(&self) -> anyhow::Result<StationsPayload> {
        let _guard = self.refresh_mutex.lock().await;
        let result = refresh::run_refresh(self).await?;
        self.write_stations_to_cache(&result.payload).await?;
        self.cache_in_memory(result.payload.clone(), "radio-browser")
            .await;
        self.ensure_processed(
            result
                .payload
                .fingerprint
                .as_deref()
                .unwrap_or("radio-browser"),
            &result.payload.stations,
        )
        .await;
        Ok(result.payload)
    }

    async fn cache_in_memory(&self, payload: StationsPayload, cache_source: &str) {
        if self.config.memory_cache_ttl_seconds == 0 {
            return;
        }
        let mut guard = self.memory_cache.write().await;
        let expires_at = Instant::now() + Duration::from_secs(self.config.memory_cache_ttl_seconds);
        *guard = Some(MemoryEntry {
            payload,
            cache_source: cache_source.to_string(),
            expires_at,
        });
    }

    async fn get_memory_cache_entry(&self) -> Option<LoadStationsResult> {
        if self.config.memory_cache_ttl_seconds == 0 {
            return None;
        }
        let guard = self.memory_cache.read().await;
        guard.as_ref().and_then(|entry| {
            if Instant::now() <= entry.expires_at {
                Some(LoadStationsResult {
                    payload: entry.payload.clone(),
                    cache_source: entry.cache_source.clone(),
                })
            } else {
                None
            }
        })
    }

    async fn read_stations_from_cache(&self) -> anyhow::Result<Option<StationsPayload>> {
        let mut conn = self.redis.get().await?;
        let raw: Option<String> = conn.get(&self.config.cache_key).await?;
        if let Some(raw) = raw {
            match serde_json::from_str::<CachedStationsPayload>(&raw) {
                Ok(cached) => match StationsPayload::try_from(cached) {
                    Ok(payload) => return Ok(Some(payload)),
                    Err(error) => {
                        warn!(error = ?error, "cache.payload_invalid");
                    }
                },
                Err(error) => {
                    warn!(error = ?error, "cache.parse_error");
                }
            }
        }
        Ok(None)
    }

    async fn write_stations_to_cache(&self, payload: &StationsPayload) -> anyhow::Result<()> {
        if self.config.cache_key.is_empty() {
            return Ok(());
        }
        let mut conn = self.redis.get().await?;
        let cached = CachedStationsPayload::from(payload);
        let body = serde_json::to_string(&cached)?;

        if let Some(existing) = conn
            .get::<_, Option<String>>(&self.config.cache_key)
            .await?
        {
            if self.cache_entry_matches(&existing, payload, &body) {
                if self.config.cache_ttl_seconds > 0 {
                    let _: () = conn
                        .expire(&self.config.cache_key, self.config.cache_ttl_seconds as i64)
                        .await?;
                }
                return Ok(());
            }
        }

        if self.config.cache_ttl_seconds > 0 {
            conn.set_ex::<_, _, ()>(&self.config.cache_key, body, self.config.cache_ttl_seconds)
                .await?;
        } else {
            conn.set::<_, _, ()>(&self.config.cache_key, body).await?;
        }

        Ok(())
    }

    fn schedule_background_refresh(&self) {
        let state = self.clone();
        tokio::spawn(async move {
            if let Err(error) = state.refresh_and_cache().await {
                warn!(error = ?error, "stations.background_refresh_error");
            }
        });
    }

    fn sanitize_payload(&self, payload: StationsPayload) -> Option<SanitizedPayload> {
        sanitize_persisted_payload(
            payload,
            self.config.radio_browser.enforce_https_streams,
            self.config.allow_insecure_transports,
        )
        .map(|(payload, upgraded)| SanitizedPayload { payload, upgraded })
    }

    fn cache_entry_matches(
        &self,
        existing: &str,
        payload: &StationsPayload,
        serialized: &str,
    ) -> bool {
        if let Some(fingerprint) = payload.fingerprint.as_deref() {
            if let Ok(existing_payload) = serde_json::from_str::<CachedStationsPayload>(existing) {
                if let Ok(mut parsed) = StationsPayload::try_from(existing_payload) {
                    if parsed.ensure_fingerprint() == fingerprint {
                        return true;
                    }
                }
            }
        }
        existing == serialized
    }

    pub async fn ping_redis(&self) -> anyhow::Result<()> {
        let mut conn = self.redis.get().await?;
        let _: () = conn.ping().await?;
        Ok(())
    }

    pub async fn ping_postgres(&self) -> anyhow::Result<()> {
        sqlx::query("SELECT 1").execute(&self.postgres).await?;
        Ok(())
    }

    pub async fn allow_request(&self, key: &str) -> bool {
        self.rate_limiter.check(key).await
    }
}
