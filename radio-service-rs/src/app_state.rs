use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::Context;
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use std::sync::atomic::{AtomicU64, Ordering};
use sysinfo::System;
use tokio::sync::{Mutex, RwLock};

use crate::logging::logger;
use crate::{
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
    pub stations: StationStorage,
    pub favorites: FavoritesStore,
    pub radio_browser: RadioBrowserClient,
    pub http_client: Client,
    processed_cache: Arc<RwLock<Option<ProcessedCache>>>,
    pub stream_validator: StreamValidator,
    memory_cache: Arc<RwLock<Option<MemoryEntry>>>,
    cache_state_updated_at: Arc<RwLock<Option<DateTime<Utc>>>>,
    refresh_mutex: Arc<Mutex<()>>,
    rate_limiter: Arc<RateLimiter>,
    status_monitor: Arc<EventLoopMonitor>,
    system: Arc<Mutex<System>>,
    started_at: Instant,
}

#[derive(Clone)]
struct ProcessedCache {
    cache_key: String,
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
pub struct CachedStationsPayload {
    #[serde(rename = "schemaVersion")]
    pub schema_version: Option<SchemaVersionValue>,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    pub source: Option<String>,
    #[serde(default)]
    pub requests: Vec<String>,
    pub total: usize,
    pub fingerprint: Option<String>,
    pub stations: Vec<crate::stations::Station>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SchemaVersionValue {
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
        sqlx::query("SELECT 1")
            .execute(&postgres)
            .await
            .context("failed to validate postgres connectivity")?;

        let stations = StationStorage::new(postgres.clone());
        let favorites = FavoritesStore::new(postgres.clone());
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
        let cache_state_updated_at = Arc::new(RwLock::new(None));

        let refresh_mutex = Arc::new(Mutex::new(()));
        let rate_limiter = Arc::new(RateLimiter::new(100, Duration::from_secs(60)));
        let status_monitor = Arc::new(EventLoopMonitor::new());
        EventLoopMonitor::spawn(status_monitor.clone());
        let system = Arc::new(Mutex::new(System::new_all()));
        let started_at = Instant::now();

        Ok(Self {
            config,
            postgres,
            stations,
            favorites,
            radio_browser,
            http_client,
            processed_cache,
            stream_validator,
            memory_cache,
            cache_state_updated_at,
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
        cache_key: &str,
        stations: &[crate::stations::Station],
    ) -> ProcessedStations {
        {
            let cache = self.processed_cache.read().await;
            if let Some(existing) = cache.as_ref() {
                if existing.cache_key == cache_key
                    && existing.data.station_count == stations.len()
                    && stations
                        .first()
                        .is_some_and(|station| existing.data.station_index(&station.id) == Some(0))
                {
                    return existing.data.clone();
                }
            }
        }
        let processed = ProcessedStations::build(stations);
        let mut cache = self.processed_cache.write().await;
        *cache = Some(ProcessedCache {
            cache_key: cache_key.to_string(),
            data: processed.clone(),
        });
        processed
    }

    pub async fn load_stations(&self, force_refresh: bool) -> anyhow::Result<LoadStationsResult> {
        self.ensure_cache_state_sync().await?;

        if !force_refresh {
            if let Some(entry) = self.get_memory_cache_entry().await {
                return Ok(entry);
            }

            if let Some(payload) = self.stations.load_latest_payload().await? {
                if let Some(sanitized) = self.sanitize_payload(payload) {
                    let mut payload = sanitized.payload;
                    payload
                        .ensure_fingerprint()
                        .context("failed to compute database fingerprint")?;
                    if sanitized.upgraded {
                        logger().info(
                            "stations.payload_upgraded",
                            json!({
                                "source": "database"
                            }),
                        );
                    }
                    self.cache_in_memory(payload.clone(), "database").await;
                    let processed_key = payload.processed_cache_key().unwrap_or_else(|_| {
                        payload
                            .fingerprint
                            .clone()
                            .unwrap_or_else(|| "database".into())
                    });
                    self.ensure_processed(&processed_key, &payload.stations)
                        .await;
                    self.schedule_background_refresh();
                    return Ok(LoadStationsResult {
                        payload,
                        cache_source: "database".into(),
                    });
                }

                logger().info(
                    "stations.payload_invalid",
                    json!({
                        "source": "database"
                    }),
                );
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
        let process_guard = self.refresh_mutex.lock().await;
        let lock = self.try_acquire_refresh_lock().await?;
        drop(process_guard);

        if let Some(refresh_lock) = lock {
            return self.perform_refresh_with_lock(refresh_lock).await;
        }

        logger().info(
            "stations.refresh.waiting",
            json!({
                "lockKey": self.config.refresh_lock_key,
                "retryAttempts": self.config.refresh_lock_retry_attempts
            }),
        );

        self.wait_for_external_refresh().await
    }

    async fn perform_refresh_with_lock(
        &self,
        _lock: PgRefreshLockGuard,
    ) -> anyhow::Result<StationsPayload> {
        let mut result = refresh::run_refresh(self).await?;
        result
            .payload
            .ensure_fingerprint()
            .context("failed to compute refreshed fingerprint")?;

        self.update_cache_state_marker().await?;

        self.cache_in_memory(result.payload.clone(), "radio-browser")
            .await;
        self.ensure_processed(
            &result.payload.processed_cache_key().unwrap_or_else(|_| {
                result
                    .payload
                    .fingerprint
                    .clone()
                    .unwrap_or_else(|| "radio-browser".into())
            }),
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

    async fn read_station_state_updated_at(&self) -> anyhow::Result<Option<DateTime<Utc>>> {
        Ok(sqlx::query_scalar(
            r#"
            SELECT updated_at
            FROM station_state
            WHERE id = TRUE
            LIMIT 1
            "#,
        )
        .fetch_optional(&self.postgres)
        .await?)
    }

    async fn ensure_cache_state_sync(&self) -> anyhow::Result<()> {
        let current = self.read_station_state_updated_at().await?;
        let mut stored = self.cache_state_updated_at.write().await;
        let changed = current != *stored;
        if changed {
            if stored.is_some() || current.is_some() {
                logger().info(
                    "stations.state.changed",
                    json!({
                        "previous": stored.as_ref().map(|value| value.to_rfc3339()),
                        "next": current.as_ref().map(|value| value.to_rfc3339())
                    }),
                );
            }
            *stored = current;
        }
        drop(stored);

        if changed {
            *self.memory_cache.write().await = None;
            *self.processed_cache.write().await = None;
        }

        Ok(())
    }

    async fn update_cache_state_marker(&self) -> anyhow::Result<()> {
        let current = self.read_station_state_updated_at().await?;
        *self.cache_state_updated_at.write().await = current;
        Ok(())
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

    async fn try_acquire_refresh_lock(&self) -> anyhow::Result<Option<PgRefreshLockGuard>> {
        let key = self.config.refresh_lock_key.trim();
        if key.is_empty() {
            return Ok(Some(PgRefreshLockGuard::noop()));
        }

        let mut conn = self.postgres.acquire().await?;
        let locked: bool =
            sqlx::query_scalar("SELECT pg_try_advisory_lock(hashtextextended($1, 0))")
                .bind(key)
                .fetch_one(&mut *conn)
                .await?;

        if locked {
            Ok(Some(PgRefreshLockGuard::new(conn, key.to_string())))
        } else {
            Ok(None)
        }
    }

    async fn wait_for_external_refresh(&self) -> anyhow::Result<StationsPayload> {
        let initial = self.read_station_state_updated_at().await?;

        for attempt in 0..self.config.refresh_lock_retry_attempts {
            tokio::time::sleep(Duration::from_secs(1)).await;

            let current = self.read_station_state_updated_at().await?;
            if current.is_some() && current != initial {
                self.ensure_cache_state_sync().await?;

                if let Some(payload) = self.stations.load_latest_payload().await? {
                    if let Some(sanitized) = self.sanitize_payload(payload) {
                        let mut payload = sanitized.payload;
                        payload
                            .ensure_fingerprint()
                            .context("failed to compute database fingerprint")?;

                        self.cache_in_memory(payload.clone(), "database").await;
                        self.ensure_processed(
                            &payload.processed_cache_key().unwrap_or_else(|_| {
                                payload
                                    .fingerprint
                                    .clone()
                                    .unwrap_or_else(|| "database".into())
                            }),
                            &payload.stations,
                        )
                        .await;

                        logger().info(
                            "stations.refresh.wait_success",
                            json!({
                                "attempt": attempt + 1,
                                "updatedAt": current.as_ref().map(|value| value.to_rfc3339())
                            }),
                        );

                        return Ok(payload);
                    }
                }
            }
        }

        Err(anyhow::anyhow!(
            "timed out waiting for another refresh task to complete"
        ))
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

struct PgRefreshLockGuard {
    conn: Option<sqlx::pool::PoolConnection<sqlx::Postgres>>,
    key: String,
    released: bool,
}

impl PgRefreshLockGuard {
    fn new(conn: sqlx::pool::PoolConnection<sqlx::Postgres>, key: String) -> Self {
        Self {
            conn: Some(conn),
            key,
            released: false,
        }
    }

    fn noop() -> Self {
        Self {
            conn: None,
            key: String::new(),
            released: true,
        }
    }
}

impl Drop for PgRefreshLockGuard {
    fn drop(&mut self) {
        if self.released || self.key.is_empty() {
            return;
        }

        let Some(mut conn) = self.conn.take() else {
            return;
        };

        let key = self.key.clone();
        self.released = true;

        tokio::spawn(async move {
            let _ =
                sqlx::query_scalar::<_, bool>("SELECT pg_advisory_unlock(hashtextextended($1, 0))")
                    .bind(key)
                    .fetch_one(&mut *conn)
                    .await;
        });
    }
}
