use crate::config::{CacheConfig, MemoryCacheConfig};
use crate::logger::Logger;
use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct CacheHandle {
    ttl: Duration,
    memory: Option<Arc<MemoryCache>>,
    logger: Logger,
}

impl CacheHandle {
    pub async fn new(config: CacheConfig, logger: Logger) -> Result<Self> {
        let memory = if config.memory.enabled {
            Some(Arc::new(MemoryCache::new(config.memory.clone())))
        } else {
            None
        };
        Ok(Self {
            ttl: config.ttl,
            memory,
            logger,
        })
    }

    pub async fn get(&self, key: &str) -> Option<String> {
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
        } else {
            self.logger.debug(
                "cache.disabled",
                serde_json::json!({ "message": "Cache disabled; ignoring set", "key": key }),
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
    fn new(config: MemoryCacheConfig) -> Self {
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
