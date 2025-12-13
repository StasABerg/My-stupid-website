use anyhow::Result;
use deadpool_redis::{redis::AsyncCommands, Pool as RedisPool};
use serde_json::json;

use crate::logging::logger;
use crate::stations::StationsPayload;

use super::codec_msgpack::{CacheCodec, MsgPackLz4Codec};

/// High-performance cache client using MessagePack + LZ4 compression
pub struct CacheClient {
    redis: RedisPool,
    cache_key: String,
    ttl_seconds: u64,
    codec: MsgPackLz4Codec,
}

impl CacheClient {
    pub fn new(redis: RedisPool, cache_key: String, ttl_seconds: u64) -> Self {
        Self {
            redis,
            cache_key,
            ttl_seconds,
            codec: MsgPackLz4Codec,
        }
    }

    /// Read from cache using MessagePack + LZ4
    pub async fn read(&self) -> Result<Option<StationsPayload>> {
        let mut conn = self.redis.get().await?;
        let data: Option<Vec<u8>> = conn.get(&self.cache_key).await?;

        if let Some(bytes) = data {
            match self.codec.decode(&bytes) {
                Ok(payload) => {
                    logger().info(
                        "cache.read.success",
                        json!({
                            "format": "msgpack+lz4",
                            "key": &self.cache_key,
                            "bytes": bytes.len(),
                        }),
                    );
                    return Ok(Some(payload));
                }
                Err(err) => {
                    logger().warn(
                        "cache.read.decode_error",
                        json!({
                            "format": "msgpack+lz4",
                            "key": &self.cache_key,
                            "error": format!("{:?}", err),
                        }),
                    );
                }
            }
        }

        Ok(None)
    }

    /// Write to cache using MessagePack + LZ4
    pub async fn write(&self, payload: &StationsPayload) -> Result<()> {
        let mut conn = self.redis.get().await?;
        let data = self.codec.encode(payload)?;

        if self.ttl_seconds > 0 {
            conn.set_ex::<_, _, ()>(&self.cache_key, &data, self.ttl_seconds)
                .await?;
        } else {
            conn.set::<_, _, ()>(&self.cache_key, &data).await?;
        }

        logger().info(
            "cache.write.success",
            json!({
                "format": "msgpack+lz4",
                "key": &self.cache_key,
                "bytes": data.len(),
                "ttlSeconds": self.ttl_seconds,
            }),
        );

        Ok(())
    }
}
