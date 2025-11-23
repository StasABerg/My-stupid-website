use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::Context;
use chrono::{DateTime, Utc};
use deadpool_redis::{redis::AsyncCommands, Pool as RedisPool};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use std::sync::atomic::{AtomicU64, Ordering};
use sysinfo::System;
use tokio::sync::{Mutex, RwLock};

use crate::logging::logger;
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
    status_monitor: Arc<EventLoopMonitor>,
    system: Arc<Mutex<System>>,
    started_at: Instant,
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
    buckets: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl RateLimiter {
    fn new(max_requests: usize, window: Duration) -> Self {
        Self {
            max_requests: max_requests.max(1),
            window,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    async fn check(&self, key: &str) -> RateLimitDecision {
        let mut guard = self.buckets.lock().await;
        let now = Instant::now();

        // Drop stale timestamps and empty buckets so the map does not grow without bound.
        let mut empty_keys = Vec::new();
        for (bucket_key, entries) in guard.iter_mut() {
            while let Some(front) = entries.front() {
                if now.duration_since(*front) > self.window {
                    entries.pop_front();
                } else {
                    break;
                }
            }
            if entries.is_empty() {
                empty_keys.push(bucket_key.clone());
            }
        }
        for bucket_key in empty_keys {
            guard.remove(&bucket_key);
        }

        let entries = guard.entry(key.to_string()).or_insert_with(VecDeque::new);
        while let Some(front) = entries.front() {
            if now.duration_since(*front) > self.window {
                entries.pop_front();
            } else {
                break;
            }
        }

        let limit = self.max_requests;
        let reset_instant = entries
            .front()
            .copied()
            .map(|instant| instant + self.window)
            .unwrap_or(now + self.window);
        let reset_epoch = instant_to_epoch(reset_instant);

        if entries.len() >= limit {
            return RateLimitDecision {
                allowed: false,
                metadata: RateLimitMetadata {
                    limit,
                    remaining: 0,
                    reset_epoch,
                },
            };
        }

        entries.push_back(now);
        let remaining = limit.saturating_sub(entries.len());

        RateLimitDecision {
            allowed: true,
            metadata: RateLimitMetadata {
                limit,
                remaining,
                reset_epoch,
            },
        }
    }
}

#[derive(Clone, Debug)]
pub struct RateLimitMetadata {
    pub limit: usize,
    pub remaining: usize,
    pub reset_epoch: u64,
}

pub struct RateLimitDecision {
    pub allowed: bool,
    pub metadata: RateLimitMetadata,
}

struct EventLoopMonitor {
    lag_ns: AtomicU64,
}

impl EventLoopMonitor {
    fn new() -> Self {
        Self {
            lag_ns: AtomicU64::new(0),
        }
    }

    fn spawn(self: Arc<Self>) {
        tokio::spawn(async move {
            let interval = Duration::from_millis(250);
            loop {
                let start = Instant::now();
                tokio::time::sleep(interval).await;
                let elapsed = start.elapsed();
                let lag = elapsed
                    .checked_sub(interval)
                    .unwrap_or_else(|| Duration::from_secs(0));
                self.lag_ns.store(lag.as_nanos() as u64, Ordering::Relaxed);
            }
        });
    }

    fn current_delay_ms(&self) -> f64 {
        self.lag_ns.load(Ordering::Relaxed) as f64 / 1_000_000.0
    }
}

pub struct StatusSnapshot {
    pub event_loop_delay_ms: f64,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub uptime_seconds: u64,
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
        sqlx::query("SELECT 1")
            .execute(&postgres)
            .await
            .context("failed to validate postgres connectivity")?;
        {
            let mut conn = redis
                .get()
                .await
                .context("failed to get redis connection")?;
            let _: () = conn
                .ping()
                .await
                .context("failed to ping redis during startup")?;
        }

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
        let rate_limiter = Arc::new(RateLimiter::new(100, Duration::from_secs(60)));
        let status_monitor = Arc::new(EventLoopMonitor::new());
        EventLoopMonitor::spawn(status_monitor.clone());
        let system = Arc::new(Mutex::new(System::new_all()));
        let started_at = Instant::now();

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
            status_monitor,
            system,
            started_at,
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
                    payload
                        .ensure_fingerprint()
                        .context("failed to compute cache fingerprint")?;
                    if sanitized.upgraded {
                        logger().info(
                            "cache.upgraded",
                            json!({
                                "source": "redis"
                            }),
                        );
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
                    logger().info(
                        "cache.invalid",
                        json!({
                            "source": "redis"
                        }),
                    );
                }
            }

            if let Some(payload) = self.stations.load_latest_payload().await? {
                if let Some(sanitized) = self.sanitize_payload(payload) {
                    let mut payload = sanitized.payload;
                    payload
                        .ensure_fingerprint()
                        .context("failed to compute database fingerprint")?;
                    if sanitized.upgraded {
                        logger().info(
                            "cache.upgraded",
                            json!({
                                "source": "database"
                            }),
                        );
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
                    logger().info(
                        "stations.payload_invalid",
                        json!({
                            "source": "database"
                        }),
                    );
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
        self.radio_browser.record_click(station_id).await
    }

    async fn refresh_and_cache(&self) -> anyhow::Result<StationsPayload> {
        let _guard = self.refresh_mutex.lock().await;
        let mut result = refresh::run_refresh(self).await?;
        result
            .payload
            .ensure_fingerprint()
            .context("failed to compute refreshed fingerprint")?;
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
                        logger().warn(
                            "cache.payload_invalid",
                            json!({
                                "error": format!("{:?}", error)
                            }),
                        );
                    }
                },
                Err(error) => {
                    logger().warn(
                        "cache.parse_error",
                        json!({
                            "error": format!("{:?}", error)
                        }),
                    );
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

        let ttl = self.config.cache_ttl_seconds;
        let station_count = payload.stations.len();
        if self.config.cache_ttl_seconds > 0 {
            conn.set_ex::<_, _, ()>(&self.config.cache_key, body, self.config.cache_ttl_seconds)
                .await?;
        } else {
            conn.set::<_, _, ()>(&self.config.cache_key, body).await?;
        }
        logger().info(
            "stations.cache.write",
            json!({
                "redisKey": self.config.cache_key,
                "ttlSeconds": ttl,
                "count": station_count,
            }),
        );

        Ok(())
    }

    fn schedule_background_refresh(&self) {
        let state = self.clone();
        tokio::spawn(async move {
            if let Err(error) = state.refresh_and_cache().await {
                logger().warn(
                    "stations.background_refresh_error",
                    json!({
                        "error": format!("{:?}", error)
                    }),
                );
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
                    if let Ok(parsed_fingerprint) = parsed.ensure_fingerprint() {
                        if parsed_fingerprint == fingerprint {
                            return true;
                        }
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

    pub async fn check_rate_limit(&self, key: &str) -> RateLimitDecision {
        self.rate_limiter.check(key).await
    }

    pub async fn status_snapshot(&self) -> StatusSnapshot {
        let mut system = self.system.lock().await;
        system.refresh_memory();
        let memory_used_bytes = system.used_memory() * 1024;
        let memory_total_bytes = system.total_memory() * 1024;
        StatusSnapshot {
            event_loop_delay_ms: self.status_monitor.current_delay_ms(),
            memory_used_bytes,
            memory_total_bytes,
            uptime_seconds: self.started_at.elapsed().as_secs(),
        }
    }
}

fn instant_to_epoch(target: Instant) -> u64 {
    let now = Instant::now();
    let now_system = SystemTime::now();
    let duration = if target >= now {
        target - now
    } else {
        Duration::from_secs(0)
    };
    now_system
        .checked_add(duration)
        .unwrap_or(now_system)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
