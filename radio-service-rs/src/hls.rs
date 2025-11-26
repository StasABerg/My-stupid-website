use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use bytes::Bytes;
use deadpool_redis::{
    redis::{self, AsyncCommands},
    Pool as RedisPool,
};
use serde::{Deserialize, Serialize};

use crate::config::StreamPipelineHlsConfig;
use crate::logging::logger;

#[allow(dead_code)]
#[derive(Clone)]
pub struct HlsSegmentStore {
    redis: RedisPool,
    config: StreamPipelineHlsConfig,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlaylistSnapshot {
    pub body: String,
    #[serde(rename = "mediaSequence")]
    pub media_sequence: u64,
    #[serde(rename = "targetDuration")]
    pub target_duration: u64,
    #[serde(rename = "updatedAtMs")]
    pub updated_at_ms: u64,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct SegmentPayload {
    pub sequence: u64,
    pub content_type: String,
    pub bytes: Bytes,
}

#[allow(dead_code)]
#[derive(Serialize, Deserialize)]
struct SegmentRecord {
    #[serde(rename = "contentType")]
    content_type: String,
    #[serde(rename = "body")]
    body_b64: String,
}

#[allow(dead_code)]
impl HlsSegmentStore {
    pub fn new(redis: RedisPool, config: StreamPipelineHlsConfig) -> Self {
        Self { redis, config }
    }

    pub async fn store_playlist(
        &self,
        station_id: &str,
        playlist: &PlaylistSnapshot,
    ) -> Result<()> {
        let key = self.playlist_key(station_id);
        let serialized =
            serde_json::to_string(playlist).context("failed to serialize playlist snapshot")?;
        let ttl = self.config.redis_playlist_ttl_seconds;

        let mut conn = self.redis.get().await.context("redis unavailable")?;
        let _: () = conn
            .set_ex(key, serialized, ttl)
            .await
            .context("failed to store playlist snapshot")?;
        Ok(())
    }

    pub async fn load_playlist(&self, station_id: &str) -> Result<Option<PlaylistSnapshot>> {
        let key = self.playlist_key(station_id);
        let mut conn = self.redis.get().await.context("redis unavailable")?;
        let raw: Option<String> = conn.get(&key).await.context("failed to load playlist")?;
        if let Some(raw) = raw {
            let snapshot: PlaylistSnapshot =
                serde_json::from_str(&raw).context("failed to deserialize playlist snapshot")?;
            return Ok(Some(snapshot));
        }
        Ok(None)
    }

    pub async fn store_segment(&self, station_id: &str, payload: &SegmentPayload) -> Result<()> {
        let key = self.segment_key(station_id, payload.sequence);
        let envelope = SegmentRecord {
            content_type: payload.content_type.clone(),
            body_b64: STANDARD.encode(payload.bytes.as_ref()),
        };
        let serialized =
            serde_json::to_string(&envelope).context("failed to serialize segment record")?;
        let ttl = self.config.redis_segment_ttl_seconds;

        let index_key = self.segment_index_key(station_id);
        let mut conn = self.redis.get().await.context("redis unavailable")?;
        let mut pipe = redis::pipe();
        pipe.cmd("SET").arg(&key).arg(serialized).arg("EX").arg(ttl);
        pipe.cmd("ZADD")
            .arg(&index_key)
            .arg(payload.sequence)
            .arg(payload.sequence);
        pipe.cmd("EXPIRE").arg(&index_key).arg(ttl);
        pipe.query_async::<()>(&mut conn)
            .await
            .context("failed to write segment to redis")?;
        Ok(())
    }

    pub async fn load_segment(
        &self,
        station_id: &str,
        sequence: u64,
    ) -> Result<Option<SegmentPayload>> {
        let key = self.segment_key(station_id, sequence);
        let mut conn = self.redis.get().await.context("redis unavailable")?;
        let raw: Option<String> = conn.get(&key).await.context("failed to load segment")?;
        if let Some(raw) = raw {
            let record: SegmentRecord =
                serde_json::from_str(&raw).context("failed to deserialize segment")?;
            let decoded = STANDARD
                .decode(record.body_b64.as_bytes())
                .context("failed to decode segment body")?;
            return Ok(Some(SegmentPayload {
                sequence,
                content_type: record.content_type,
                bytes: Bytes::from(decoded),
            }));
        }
        Ok(None)
    }

    pub async fn purge_station(&self, station_id: &str) -> Result<()> {
        let mut conn = self.redis.get().await.context("redis unavailable")?;
        let index_key = self.segment_index_key(station_id);
        let sequences: Vec<u64> = conn.zrange(&index_key, 0, -1).await.unwrap_or_default();
        let mut pipe = redis::pipe();
        pipe.del(self.playlist_key(station_id));
        pipe.del(&index_key);
        for sequence in sequences {
            pipe.del(self.segment_key(station_id, sequence));
        }
        if let Err(err) = pipe.query_async::<()>(&mut conn).await {
            logger().warn(
                "stream.pipeline.hls.purge_failed",
                serde_json::json!({
                    "stationId": station_id,
                    "error": format!("{:?}", err),
                }),
            );
        }
        Ok(())
    }

    pub fn create_playlist_snapshot(&self, body: String, media_sequence: u64) -> PlaylistSnapshot {
        PlaylistSnapshot {
            body,
            media_sequence,
            target_duration: self.config.segment_seconds,
            updated_at_ms: current_epoch_ms(),
        }
    }

    fn playlist_key(&self, station_id: &str) -> String {
        format!("{}:{}:playlist", self.config.redis_prefix, station_id)
    }

    fn segment_key(&self, station_id: &str, sequence: u64) -> String {
        format!(
            "{}:{}:segment:{sequence}",
            self.config.redis_prefix, station_id
        )
    }

    fn segment_index_key(&self, station_id: &str) -> String {
        format!("{}:{}:segments", self.config.redis_prefix, station_id)
    }
}

#[allow(dead_code)]
fn current_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
