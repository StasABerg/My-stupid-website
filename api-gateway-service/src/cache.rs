use crate::config::{CacheConfig, MemoryCacheConfig, RedisCacheConfig};
use crate::logger::Logger;
use crate::redis_client::build_redis_client;
use anyhow::{Result, anyhow};
use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use url::Url;

#[derive(Clone)]
pub struct CacheHandle {
    ttl: Duration,
    memory: Option<Arc<MemoryCache>>,
    redis: Option<Arc<RedisCache>>,
    logger: Logger,
}

impl CacheHandle {
    pub async fn new(config: CacheConfig, logger: Logger) -> Result<Self> {
        let memory = if config.memory.enabled {
            Some(Arc::new(MemoryCache::new(
                config.memory.clone(),
                config.ttl,
            )))
        } else {
            None
        };
        let redis = if let Some(redis_config) = config.redis.clone() {
            Some(Arc::new(RedisCache::new(redis_config, &logger).await?))
        } else {
            None
        };
        Ok(Self {
            ttl: config.ttl,
            memory,
            redis,
            logger,
        })
    }

    pub async fn get(&self, key: &str) -> Option<String> {
        if let Some(redis) = &self.redis {
            match redis.get(key).await {
                Ok(value) => {
                    if value.is_some() {
                        return value;
                    }
                }
                Err(error) => {
                    self.logger.warn(
                        "cache.redis_get_error",
                        serde_json::json!({ "error": error.to_string(), "key": key }),
                    );
                }
            }
        }
        if let Some(memory) = &self.memory {
            return memory.get(key).await;
        }
        None
    }

    pub async fn set(&self, key: &str, value: &str, ttl: Option<Duration>) {
        if let Some(memory) = &self.memory {
            memory
                .set(key, value.to_string(), ttl.unwrap_or(self.ttl))
                .await;
        }
        if let Some(redis) = &self.redis
            && let Err(error) = redis.set(key, value, ttl.unwrap_or(self.ttl)).await
        {
            self.logger.warn(
                "cache.redis_set_error",
                serde_json::json!({ "error": error.to_string(), "key": key }),
            );
        }
    }
}

struct MemoryCache {
    max_entries: usize,
    store: Mutex<HashMap<String, MemoryEntry>>,
}

struct MemoryEntry {
    value: String,
    expires_at: Instant,
}

impl MemoryCache {
    fn new(config: MemoryCacheConfig, _ttl: Duration) -> Self {
        Self {
            max_entries: config.max_entries.max(10),
            store: Mutex::new(HashMap::new()),
        }
    }

    fn prune(&self, store: &mut HashMap<String, MemoryEntry>) {
        let now = Instant::now();
        store.retain(|_, entry| entry.expires_at > now);
        while store.len() >= self.max_entries {
            if let Some((evict_key, _)) = store.iter().min_by_key(|(_, entry)| entry.expires_at) {
                let key = evict_key.clone();
                store.remove(&key);
            } else {
                break;
            }
        }
    }

    async fn get(&self, key: &str) -> Option<String> {
        let mut store = self.store.lock().await;
        self.prune(&mut store);
        store.get(key).map(|entry| entry.value.clone())
    }

    async fn set(&self, key: &str, value: String, ttl: Duration) {
        let mut store = self.store.lock().await;
        self.prune(&mut store);
        store.insert(
            key.to_string(),
            MemoryEntry {
                value,
                expires_at: Instant::now() + ttl,
            },
        );
    }
}

struct RedisCache {
    key_prefix: String,
    manager: ConnectionManager,
}

impl RedisCache {
    async fn new(config: RedisCacheConfig, logger: &Logger) -> Result<Self> {
        let client = build_redis_client(&config.url, config.tls_reject_unauthorized)?;
        let manager = ConnectionManager::new(client)
            .await
            .map_err(|error| anyhow!("redis connect error: {error}"))?;
        logger.info(
            "cache.redis_connected",
            serde_json::json!({ "url": mask_redis_url(&config.url) }),
        );
        Ok(Self {
            key_prefix: config.key_prefix,
            manager,
        })
    }

    async fn get(&self, key: &str) -> redis::RedisResult<Option<String>> {
        let mut conn = self.manager.clone();
        conn.get(self.build_key(key)).await
    }

    async fn set(&self, key: &str, value: &str, ttl: Duration) -> redis::RedisResult<()> {
        let mut conn = self.manager.clone();
        let seconds = ttl.as_secs().max(1);
        conn.set_ex::<_, _, ()>(self.build_key(key), value, seconds)
            .await
    }

    fn build_key(&self, key: &str) -> String {
        format!("{}{}", self.key_prefix, key)
    }
}

fn mask_redis_url(url: &str) -> String {
    if let Ok(parsed) = Url::parse(url) {
        let mut clone = parsed;
        if clone.password().is_some() {
            let _ = clone.set_password(Some("***"));
        }
        clone.to_string()
    } else {
        "redis".into()
    }
}
