use anyhow::{anyhow, Result};
use lz4_flex::{compress_prepend_size, decompress_size_prepended};

use crate::stations::StationsPayload;

/// Trait for encoding/decoding stations payloads
pub trait CacheCodec {
    fn encode(&self, payload: &StationsPayload) -> Result<Vec<u8>>;
    fn decode(&self, data: &[u8]) -> Result<StationsPayload>;
}

/// MessagePack codec with LZ4 compression for maximum performance
pub struct MsgPackLz4Codec;

impl CacheCodec for MsgPackLz4Codec {
    fn encode(&self, payload: &StationsPayload) -> Result<Vec<u8>> {
        // 1. Serialize to MessagePack (binary format)
        let msgpack_bytes = rmp_serde::to_vec(payload)
            .map_err(|e| anyhow!("MessagePack serialization failed: {}", e))?;

        // 2. Compress with LZ4 (prepends decompressed size for safety)
        let compressed = compress_prepend_size(&msgpack_bytes);

        Ok(compressed)
    }

    fn decode(&self, data: &[u8]) -> Result<StationsPayload> {
        // 1. Decompress LZ4 (validates size header)
        let decompressed = decompress_size_prepended(data)
            .map_err(|e| anyhow!("LZ4 decompression failed: {}", e))?;

        // 2. Deserialize MessagePack
        let payload: StationsPayload = rmp_serde::from_slice(&decompressed)
            .map_err(|e| anyhow!("MessagePack deserialization failed: {}", e))?;

        Ok(payload)
    }
}
