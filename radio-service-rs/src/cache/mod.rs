mod cache_client;
mod codec_msgpack;

pub use cache_client::CacheClient;

use deadpool_redis::{Config as RedisConfig, CreatePoolError, Pool, Runtime};

pub fn create_redis_pool(redis_url: &str) -> Result<Pool, CreatePoolError> {
    let cfg = RedisConfig::from_url(redis_url.to_string());
    cfg.create_pool(Some(Runtime::Tokio1))
}
