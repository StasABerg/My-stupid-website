use anyhow::{Result, anyhow};
use std::env;
use std::time::Duration;

const DEFAULT_PORT: u16 = 4020;
const DEFAULT_MAX_HTML_BYTES: usize = 1024 * 1024;
const DEFAULT_MAX_MD_BYTES: usize = 512 * 1024;
const DEFAULT_TIMEOUT_SECONDS: u64 = 10;
const DEFAULT_MAX_CONCURRENCY: usize = 16;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub token: String,
    pub timeout: Duration,
    pub max_html_bytes: usize,
    pub max_md_bytes: usize,
    pub max_concurrency: usize,
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

        Ok(Self {
            port,
            token,
            timeout,
            max_html_bytes,
            max_md_bytes,
            max_concurrency,
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
