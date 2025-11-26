use reqwest::{header, Client};
use serde::Serialize;
use serde_json::json;
use std::time::Duration;
use tokio::time::timeout;
use url::Url;

use crate::logging::logger;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum StreamFormat {
    Unknown,
    Mp3,
    Aac,
    Hls,
    Playlist,
    Ogg,
    Flac,
    Opus,
    Wma,
}

#[derive(Debug, Clone, Serialize)]
pub struct FormatDetection {
    pub format: StreamFormat,
    pub indicators: Vec<String>,
}

impl FormatDetection {
    fn new(format: StreamFormat, indicators: Vec<String>) -> Self {
        Self { format, indicators }
    }

    pub fn from_cache(format: StreamFormat) -> Self {
        Self {
            format,
            indicators: vec![format!("cache:{:?}", format)],
        }
    }
}

impl StreamFormat {
    pub fn is_playlist_like(&self) -> bool {
        matches!(self, StreamFormat::Hls | StreamFormat::Playlist)
    }

    fn from_content_type(content_type: &str) -> Option<Self> {
        let lowered = content_type.to_lowercase();
        if lowered.contains("mpegurl") || lowered.contains("m3u") {
            Some(StreamFormat::Hls)
        } else if lowered.contains("aac") || lowered.contains("mp4a") {
            Some(StreamFormat::Aac)
        } else if lowered.contains("mpeg") || lowered.contains("mp3") {
            Some(StreamFormat::Mp3)
        } else if lowered.contains("ogg") {
            Some(StreamFormat::Ogg)
        } else if lowered.contains("flac") {
            Some(StreamFormat::Flac)
        } else if lowered.contains("opus") {
            Some(StreamFormat::Opus)
        } else if lowered.contains("asf") || lowered.contains("wma") {
            Some(StreamFormat::Wma)
        } else {
            None
        }
    }

    fn from_extension(path: &str) -> Option<Self> {
        let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
        match ext.as_str() {
            "m3u8" | "m3u" => Some(StreamFormat::Hls),
            "pls" => Some(StreamFormat::Playlist),
            "aac" | "aacp" => Some(StreamFormat::Aac),
            "mp3" => Some(StreamFormat::Mp3),
            "ogg" | "oga" => Some(StreamFormat::Ogg),
            "flac" => Some(StreamFormat::Flac),
            "opus" => Some(StreamFormat::Opus),
            "wma" | "asf" => Some(StreamFormat::Wma),
            _ => None,
        }
    }
}

pub async fn detect_stream_format(
    client: &Client,
    url: &str,
    timeout_duration: Duration,
) -> FormatDetection {
    let mut indicators = Vec::new();

    let format_from_url = Url::parse(url)
        .ok()
        .and_then(|parsed| StreamFormat::from_extension(parsed.path()));
    if let Some(fmt) = format_from_url {
        indicators.push(format!("extension:{:?}", fmt));
        return FormatDetection::new(fmt, indicators);
    }

    let head_future = client.head(url).send();
    let mut detected = StreamFormat::Unknown;
    match timeout(timeout_duration, head_future).await {
        Ok(Ok(response)) => {
            if let Some(value) = response.headers().get(header::CONTENT_TYPE) {
                if let Ok(content_type) = value.to_str() {
                    indicators.push(format!("content-type:{content_type}"));
                    if let Some(fmt) = StreamFormat::from_content_type(content_type) {
                        detected = fmt;
                    }
                }
            }
            if response.headers().contains_key("icy-metaint") && detected == StreamFormat::Unknown {
                detected = StreamFormat::Mp3;
                indicators.push("icy-metaint".into());
            }
        }
        Ok(Err(err)) => {
            logger().debug(
                "stream.format.head_failed",
                json!({
                    "url": url,
                    "error": format!("{:?}", err),
                }),
            );
        }
        Err(_) => {
            logger().debug(
                "stream.format.head_timeout",
                json!({
                    "url": url,
                    "timeoutSeconds": timeout_duration.as_secs(),
                }),
            );
        }
    }

    if detected == StreamFormat::Unknown {
        if let Some(fmt) = Url::parse(url)
            .ok()
            .and_then(|parsed| StreamFormat::from_extension(parsed.path()))
        {
            indicators.push(format!("extension-fallback:{:?}", fmt));
            detected = fmt;
        }
    }

    FormatDetection::new(detected, indicators)
}
