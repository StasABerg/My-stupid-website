use anyhow::{Result, anyhow};
use std::env;
use std::time::Duration;

const DEFAULT_PORT: u16 = 4020;
const DEFAULT_MAX_HTML_BYTES: usize = 1024 * 1024;
const DEFAULT_MAX_MD_BYTES: usize = 512 * 1024;
const DEFAULT_TIMEOUT_SECONDS: u64 = 10;
const DEFAULT_MAX_CONCURRENCY: usize = 16;
const DEFAULT_RENDER_ENABLED: bool = true;
const DEFAULT_RENDER_MAX_CONCURRENCY: usize = 1;
const DEFAULT_RENDER_MAX_SUBREQUESTS: usize = 96;
const DEFAULT_RENDER_PORT: u16 = 9222;
const DEFAULT_RENDER_STARTUP_TIMEOUT_SECONDS: u64 = 3;
const DEFAULT_RENDER_SPA_TEXT_THRESHOLD: usize = 200;
const DEFAULT_RENDER_POST_LOAD_WAIT_MS: u64 = 500;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub token: String,
    pub timeout: Duration,
    pub max_html_bytes: usize,
    pub max_md_bytes: usize,
    pub max_concurrency: usize,
    pub render_enabled: bool,
    pub render_max_concurrency: usize,
    pub render_max_subrequests: usize,
    pub render_port: u16,
    pub render_timeout: Duration,
    pub render_startup_timeout: Duration,
    pub render_spa_text_threshold: usize,
    pub render_post_load_wait_ms: u64,
    pub render_ws_url: String,
    pub render_binary: String,
}

impl Config {
    pub fn load() -> Result<Self> {
        let port = parse_port(env::var("PORT").ok(), DEFAULT_PORT);
        let token = env::var("FMD_TOKEN")
            .map(|value| value.trim().to_string())
            .map_err(|_| anyhow!("FMD_TOKEN is required"))?;
        if token.is_empty() {
            return Err(anyhow!("FMD_TOKEN is required"));
        }

        let timeout_seconds = parse_positive_usize(
            env::var("FMD_TIMEOUT_SECONDS").ok(),
            DEFAULT_TIMEOUT_SECONDS as usize,
        )
        .clamp(1, 60) as u64;
        let timeout = Duration::from_secs(timeout_seconds);

        let max_html_bytes =
            parse_positive_usize(env::var("FMD_MAX_HTML_BYTES").ok(), DEFAULT_MAX_HTML_BYTES)
                .clamp(16 * 1024, 10 * 1024 * 1024);
        let max_md_bytes =
            parse_positive_usize(env::var("FMD_MAX_MD_BYTES").ok(), DEFAULT_MAX_MD_BYTES)
                .clamp(16 * 1024, 10 * 1024 * 1024);
        let max_concurrency = parse_positive_usize(
            env::var("FMD_MAX_CONCURRENCY").ok(),
            DEFAULT_MAX_CONCURRENCY,
        )
        .clamp(1, 256);

        let render_enabled =
            parse_bool(env::var("FMD_RENDER_ENABLED").ok(), DEFAULT_RENDER_ENABLED);
        let render_max_concurrency = parse_positive_usize(
            env::var("FMD_RENDER_MAX_CONCURRENCY").ok(),
            DEFAULT_RENDER_MAX_CONCURRENCY,
        )
        .clamp(1, 16);
        let render_max_subrequests = parse_positive_usize(
            env::var("FMD_RENDER_MAX_SUBREQUESTS").ok(),
            DEFAULT_RENDER_MAX_SUBREQUESTS,
        )
        .clamp(8, 512);
        let render_port = parse_port(env::var("FMD_RENDER_PORT").ok(), DEFAULT_RENDER_PORT);

        let render_timeout_seconds = parse_positive_usize(
            env::var("FMD_RENDER_TIMEOUT_SECONDS").ok(),
            timeout_seconds as usize,
        )
        .clamp(1, 60) as u64;
        let render_timeout = Duration::from_secs(render_timeout_seconds);

        let render_startup_timeout_seconds = parse_positive_usize(
            env::var("FMD_RENDER_STARTUP_TIMEOUT_SECONDS").ok(),
            DEFAULT_RENDER_STARTUP_TIMEOUT_SECONDS as usize,
        )
        .clamp(1, 10) as u64;
        let render_startup_timeout = Duration::from_secs(render_startup_timeout_seconds);

        let render_spa_text_threshold = parse_positive_usize(
            env::var("FMD_RENDER_SPA_TEXT_THRESHOLD").ok(),
            DEFAULT_RENDER_SPA_TEXT_THRESHOLD,
        )
        .clamp(50, 5000);

        let render_post_load_wait_ms = parse_positive_usize(
            env::var("FMD_RENDER_POST_LOAD_WAIT_MS").ok(),
            DEFAULT_RENDER_POST_LOAD_WAIT_MS as usize,
        )
        .clamp(0, 5000) as u64;

        let render_ws_url = env::var("FMD_RENDER_WS_URL")
            .ok()
            .filter(|v| !v.trim().is_empty());
        let render_ws_url =
            render_ws_url.unwrap_or_else(|| format!("http://127.0.0.1:{render_port}"));

        let render_binary = env::var("FMD_RENDER_BIN")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "lightpanda".to_string());

        Ok(Self {
            port,
            token,
            timeout,
            max_html_bytes,
            max_md_bytes,
            max_concurrency,
            render_enabled,
            render_max_concurrency,
            render_max_subrequests,
            render_port,
            render_timeout,
            render_startup_timeout,
            render_spa_text_threshold,
            render_post_load_wait_ms,
            render_ws_url,
            render_binary,
        })
    }
}

fn parse_positive_usize(value: Option<String>, default_value: usize) -> usize {
    value
        .as_deref()
        .and_then(|raw| raw.trim().parse::<usize>().ok())
        .filter(|parsed| *parsed > 0)
        .unwrap_or(default_value)
}

fn parse_port(value: Option<String>, default_value: u16) -> u16 {
    value
        .as_deref()
        .and_then(|raw| raw.trim().parse::<u16>().ok())
        .filter(|parsed| *parsed > 0)
        .unwrap_or(default_value)
}

fn parse_bool(value: Option<String>, default_value: bool) -> bool {
    match value.as_deref().map(|raw| raw.trim().to_ascii_lowercase()) {
        Some(ref raw) if raw == "1" || raw == "true" || raw == "yes" => true,
        Some(ref raw) if raw == "0" || raw == "false" || raw == "no" => false,
        _ => default_value,
    }
}
