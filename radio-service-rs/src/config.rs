use std::env;

use serde::Serialize;
use thiserror::Error;
use url::Url;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("{0}")]
    Message(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct Config {
    pub port: u16,
    pub redis_url: String,
    pub postgres: PostgresConfig,
    pub api: ApiConfig,
    pub refresh_token: String,
    pub allow_insecure_transports: bool,
    pub radio_browser: RadioBrowserConfig,
    pub stream_proxy: StreamProxyConfig,
    pub stream_pipeline: StreamPipelineConfig,
    pub stream_validation: StreamValidationConfig,
    pub cache_key: String,
    pub cache_ttl_seconds: u64,
    pub memory_cache_ttl_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PostgresConfig {
    pub connection_string: String,
    pub max_connections: u32,
    pub statement_timeout_ms: u64,
    pub ssl_mode: SslMode,
    pub ssl_reject_unauthorized: bool,
    pub application_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub enum SslMode {
    Disable,
    Prefer,
    Require,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiConfig {
    pub default_page_size: usize,
    pub max_page_size: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct RadioBrowserConfig {
    pub default_base_url: String,
    pub stations_path: String,
    pub station_click_path: String,
    pub limit: i64,
    pub page_size: i64,
    pub max_pages: i64,
    pub user_agent: String,
    pub country_concurrency: usize,
    pub enforce_https_streams: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct StreamProxyConfig {
    pub timeout_ms: u64,
    pub max_retries: usize,
    pub buffer_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct StreamPipelineConfig {
    pub enabled: bool,
    pub engine: StreamPipelineEngine,
    pub max_concurrency: usize,
    pub buffer_seconds: u64,
    pub timeout_ms: u64,
    pub user_agent: String,
    pub reconnect_max: u32,
    pub failure_cache_ttl_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
pub enum StreamPipelineEngine {
    GStreamer,
}

#[derive(Debug, Clone, Serialize)]
pub struct StreamValidationConfig {
    pub enabled: bool,
    pub timeout_ms: u64,
    pub concurrency: usize,
    pub cache_key: String,
    pub cache_ttl_seconds: u64,
    pub failure_cache_ttl_seconds: u64,
}

impl Config {
    pub fn load() -> Result<Self, ConfigError> {
        let port = env_u16("PORT", 4010)?;
        let redis_url = env_required("REDIS_URL")?;
        let postgres = PostgresConfig::from_env()?;
        let api = ApiConfig::from_env()?;
        let refresh_token = env_required("STATIONS_REFRESH_TOKEN")?;
        let allow_insecure_transports = env::var("ALLOW_INSECURE_TRANSPORT")
            .map(|value| value == "true")
            .unwrap_or(false);
        let radio_browser = RadioBrowserConfig::from_env(allow_insecure_transports)?;
        let stream_proxy = StreamProxyConfig::from_env()?;
        let stream_pipeline = StreamPipelineConfig::from_env()?;
        let stream_validation = StreamValidationConfig::from_env()?;
        let cache_key =
            env::var("STATIONS_CACHE_KEY").unwrap_or_else(|_| "radio:stations:all".into());
        let cache_ttl_seconds = env_u64("STATIONS_CACHE_TTL", 3600)?;
        let memory_cache_ttl_seconds = env_u64("STATIONS_MEMORY_CACHE_TTL", 5)?;

        let config = Self {
            port,
            redis_url,
            postgres,
            api,
            refresh_token,
            allow_insecure_transports,
            radio_browser,
            stream_proxy,
            stream_pipeline,
            stream_validation,
            cache_key,
            cache_ttl_seconds,
            memory_cache_ttl_seconds,
        };

        config.validate()?;
        Ok(config)
    }
}

impl PostgresConfig {
    fn from_env() -> Result<Self, ConfigError> {
        let raw_url = env_required("PG_URL")?;
        let user = env::var("PG_USER").ok().filter(|s| !s.is_empty());
        let password = env::var("PG_PASS")
            .or_else(|_| env::var("PG_PASSWORD"))
            .ok()
            .filter(|s| !s.is_empty());

        let connection_string =
            build_connection_string(&raw_url, user.as_deref(), password.as_deref())?;
        let max_connections = env_u32("PG_MAX_CONNECTIONS", 10)?;
        let statement_timeout_ms = env_u64("PG_STATEMENT_TIMEOUT_MS", 30_000)?;
        let ssl_mode = parse_ssl_mode(env::var("PG_SSL_MODE").ok().as_deref());
        let ssl_reject_unauthorized = env::var("PG_SSL_REJECT_UNAUTHORIZED")
            .map(|v| v != "false")
            .unwrap_or(true);
        let application_name = env::var("PG_APP_NAME").unwrap_or_else(|_| "radio-service".into());

        if max_connections == 0 {
            return Err(ConfigError::Message(
                "PG_MAX_CONNECTIONS must be greater than zero.".into(),
            ));
        }
        if statement_timeout_ms == 0 {
            return Err(ConfigError::Message(
                "PG_STATEMENT_TIMEOUT_MS must be greater than zero.".into(),
            ));
        }

        Ok(Self {
            connection_string,
            max_connections,
            statement_timeout_ms,
            ssl_mode,
            ssl_reject_unauthorized,
            application_name,
        })
    }
}

fn env_required(key: &str) -> Result<String, ConfigError> {
    env::var(key).map_err(|_| ConfigError::Message(format!("{key} must be set")))
}

fn env_u16(key: &str, default: u16) -> Result<u16, ConfigError> {
    match env::var(key) {
        Ok(value) => value
            .parse()
            .map_err(|_| ConfigError::Message(format!("{key} must be a valid u16"))),
        Err(_) => Ok(default),
    }
}

fn env_u32(key: &str, default: u32) -> Result<u32, ConfigError> {
    match env::var(key) {
        Ok(value) => value
            .parse()
            .map_err(|_| ConfigError::Message(format!("{key} must be a valid u32"))),
        Err(_) => Ok(default),
    }
}

fn env_u64(key: &str, default: u64) -> Result<u64, ConfigError> {
    match env::var(key) {
        Ok(value) => value
            .parse()
            .map_err(|_| ConfigError::Message(format!("{key} must be a valid u64"))),
        Err(_) => Ok(default),
    }
}

fn build_connection_string(
    raw_url: &str,
    user: Option<&str>,
    password: Option<&str>,
) -> Result<String, ConfigError> {
    if raw_url.contains("://") {
        let url = Url::parse(raw_url)
            .map_err(|err| ConfigError::Message(format!("Invalid PG_URL: {err}")))?;
        if url.scheme() != "postgres" && url.scheme() != "postgresql" {
            return Err(ConfigError::Message(
                "PG_URL must start with postgres:// or postgresql://".into(),
            ));
        }
        if url.path().is_empty() || url.path() == "/" {
            return Err(ConfigError::Message(
                "PG_URL must include database name in the path".into(),
            ));
        }
        return Ok(raw_url.to_string());
    }

    let (host_part, database) = parse_host_target(raw_url).ok_or_else(|| {
        ConfigError::Message("PG_URL must be full postgres URL or host:port/database".into())
    })?;

    let mut url = "postgresql://".to_string();
    if let Some(user) = user {
        url.push_str(&percent_encode(user));
        if let Some(password) = password {
            url.push(':');
            url.push_str(&percent_encode(password));
        }
        url.push('@');
    }
    url.push_str(&host_part);
    url.push('/');
    url.push_str(&database);
    Ok(url)
}

fn parse_host_target(raw: &str) -> Option<(String, String)> {
    let trimmed = raw.trim();
    let slash = trimmed.find('/')?;
    let host = trimmed[..slash].trim();
    let database = trimmed[slash + 1..].trim();
    if host.is_empty() || database.is_empty() {
        return None;
    }
    Some((host.to_string(), database.to_string()))
}

fn percent_encode(value: &str) -> String {
    urlencoding::encode(value).into_owned()
}

fn parse_ssl_mode(value: Option<&str>) -> SslMode {
    match value.map(|v| v.to_lowercase()) {
        Some(mode) if mode == "disable" => SslMode::Disable,
        Some(mode) if mode == "require" || mode == "verify-full" => SslMode::Require,
        _ => SslMode::Prefer,
    }
}

impl ApiConfig {
    fn from_env() -> Result<Self, ConfigError> {
        let default_page_size = env_usize("API_DEFAULT_PAGE_SIZE", 50)?;
        let max_page_size = env_usize("API_MAX_PAGE_SIZE", 100)?;
        let default_page_size = default_page_size.min(max_page_size).max(1);

        Ok(Self {
            default_page_size,
            max_page_size: max_page_size.max(1),
        })
    }
}

fn env_usize(key: &str, default: usize) -> Result<usize, ConfigError> {
    match env::var(key) {
        Ok(value) => value
            .parse()
            .map_err(|_| ConfigError::Message(format!("{key} must be a valid usize"))),
        Err(_) => Ok(default),
    }
}

fn env_i64(key: &str, default: i64) -> Result<i64, ConfigError> {
    match env::var(key) {
        Ok(value) => value
            .parse()
            .map_err(|_| ConfigError::Message(format!("{key} must be a valid integer"))),
        Err(_) => Ok(default),
    }
}

fn env_bool(key: &str) -> Option<bool> {
    match env::var(key) {
        Ok(value) => match value.to_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        },
        Err(_) => None,
    }
}

impl RadioBrowserConfig {
    fn from_env(allow_insecure_transports: bool) -> Result<Self, ConfigError> {
        const DEFAULT_BASE_URL: &str = "https://de2.api.radio-browser.info";
        const DEFAULT_STATIONS_PATH: &str = "/json/stations";
        const DEFAULT_STATION_CLICK_PATH: &str = "/json/url";

        let enforce_https_streams =
            env_bool("RADIO_BROWSER_FORCE_HTTPS_STREAMS").unwrap_or(!allow_insecure_transports);
        let country_concurrency = env_usize("RADIO_BROWSER_COUNTRY_CONCURRENCY", 4)?.max(1);

        let config = Self {
            default_base_url: env::var("RADIO_BROWSER_BASE_URL")
                .unwrap_or_else(|_| DEFAULT_BASE_URL.to_string()),
            stations_path: env::var("RADIO_BROWSER_STATIONS_PATH")
                .unwrap_or_else(|_| DEFAULT_STATIONS_PATH.to_string()),
            station_click_path: env::var("RADIO_BROWSER_STATION_CLICK_PATH")
                .unwrap_or_else(|_| DEFAULT_STATION_CLICK_PATH.to_string()),
            limit: env_i64("RADIO_BROWSER_LIMIT", 500)?,
            page_size: env_i64("RADIO_BROWSER_PAGE_SIZE", 100)?,
            max_pages: env_i64("RADIO_BROWSER_MAX_PAGES", 20)?,
            user_agent: env::var("RADIO_BROWSER_USER_AGENT")
                .unwrap_or_else(|_| "My-stupid-website/1.0 (stasaberg)".to_string()),
            country_concurrency,
            enforce_https_streams,
        };

        config.validate(allow_insecure_transports)?;
        Ok(config)
    }

    fn validate(&self, allow_insecure_transports: bool) -> Result<(), ConfigError> {
        if self.page_size <= 0 {
            return Err(ConfigError::Message(
                "RADIO_BROWSER_PAGE_SIZE must be greater than zero.".into(),
            ));
        }
        if self.max_pages <= 0 {
            return Err(ConfigError::Message(
                "RADIO_BROWSER_MAX_PAGES must be greater than zero.".into(),
            ));
        }
        if self.limit <= 0 {
            return Err(ConfigError::Message(
                "RADIO_BROWSER_LIMIT must be greater than zero.".into(),
            ));
        }
        if self.country_concurrency == 0 {
            return Err(ConfigError::Message(
                "RADIO_BROWSER_COUNTRY_CONCURRENCY must be greater than zero.".into(),
            ));
        }
        if self.user_agent.trim().is_empty() {
            return Err(ConfigError::Message(
                "A Radio Browser user agent must be provided.".into(),
            ));
        }

        let base_url = Url::parse(&self.default_base_url).map_err(|err| {
            ConfigError::Message(format!("Invalid Radio Browser base URL: {err}"))
        })?;
        for path in [&self.stations_path, &self.station_click_path] {
            let url = base_url.join(path).map_err(|err| {
                ConfigError::Message(format!("Invalid Radio Browser path: {err}"))
            })?;
            if url.scheme() != "https" && !allow_insecure_transports {
                return Err(ConfigError::Message(
                    "Radio Browser endpoints must use HTTPS unless ALLOW_INSECURE_TRANSPORT=true"
                        .into(),
                ));
            }
        }

        Ok(())
    }
}

impl StreamProxyConfig {
    fn from_env() -> Result<Self, ConfigError> {
        let timeout_ms = env_u64("STREAM_PROXY_TIMEOUT_MS", 5000)?;
        let max_retries = env_usize("STREAM_PROXY_MAX_RETRIES", 2)?.max(1);
        let buffer_seconds = env_u64("STREAM_PROXY_BUFFER_SECONDS", 3)?;
        Ok(Self {
            timeout_ms,
            max_retries,
            buffer_seconds,
        })
    }
}

impl StreamPipelineConfig {
    fn from_env() -> Result<Self, ConfigError> {
        let enabled = env_bool("STREAM_PIPELINE_ENABLED").unwrap_or(false);
        let engine = match env::var("STREAM_PIPELINE_ENGINE")
            .unwrap_or_else(|_| "gstreamer".into())
            .to_lowercase()
            .as_str()
        {
            "gstreamer" => StreamPipelineEngine::GStreamer,
            other => {
                return Err(ConfigError::Message(format!(
                    "Unsupported STREAM_PIPELINE_ENGINE: {other}"
                )))
            }
        };
        let max_concurrency = env_usize("STREAM_PIPELINE_MAX_CONCURRENCY", 4)?;
        let buffer_seconds = env_u64("STREAM_PIPELINE_BUFFER_SECONDS", 5)?;
        let timeout_ms = env_u64("STREAM_PIPELINE_TIMEOUT_MS", 10_000)?;
        let user_agent = env::var("STREAM_PIPELINE_USER_AGENT")
            .unwrap_or_else(|_| "radio-service/stream-pipeline".into());
        let reconnect_max = env_u32("STREAM_PIPELINE_RECONNECT_MAX", 3)?;
        let failure_cache_ttl_seconds = env_u64("STREAM_PIPELINE_FAILURE_CACHE_TTL", 300)?;
        Ok(Self {
            enabled,
            engine,
            max_concurrency,
            buffer_seconds,
            timeout_ms,
            user_agent,
            reconnect_max,
            failure_cache_ttl_seconds,
        })
    }
}

impl StreamValidationConfig {
    fn from_env() -> Result<Self, ConfigError> {
        let enabled = env_bool("STREAM_VALIDATION_ENABLED").unwrap_or(true);
        let timeout_ms = env_u64("STREAM_VALIDATION_TIMEOUT_MS", 5000)?;
        let concurrency = env_usize("STREAM_VALIDATION_CONCURRENCY", 8)?.max(1);
        let cache_key = env::var("STREAM_VALIDATION_CACHE_KEY")
            .unwrap_or_else(|_| "radio:streams:validated".into());
        if cache_key.trim().is_empty() {
            return Err(ConfigError::Message(
                "STREAM_VALIDATION_CACHE_KEY must be provided.".into(),
            ));
        }
        let cache_ttl_seconds = env_u64("STREAM_VALIDATION_CACHE_TTL", 86400)?;
        let failure_cache_ttl_seconds = env_u64("STREAM_VALIDATION_FAILURE_CACHE_TTL", 3600)?;
        Ok(Self {
            enabled,
            timeout_ms,
            concurrency,
            cache_key,
            cache_ttl_seconds,
            failure_cache_ttl_seconds,
        })
    }
}

impl Config {
    fn validate(&self) -> Result<(), ConfigError> {
        if self.cache_ttl_seconds == 0 {
            return Err(ConfigError::Message(
                "STATIONS_CACHE_TTL must be greater than zero".into(),
            ));
        }
        if self.memory_cache_ttl_seconds == 0 {
            return Err(ConfigError::Message(
                "STATIONS_MEMORY_CACHE_TTL must be greater than zero".into(),
            ));
        }
        if self.cache_key.trim().is_empty() {
            return Err(ConfigError::Message(
                "STATIONS_CACHE_KEY must be provided".into(),
            ));
        }
        if self.stream_validation.concurrency == 0 {
            return Err(ConfigError::Message(
                "STREAM_VALIDATION_CONCURRENCY must be greater than zero".into(),
            ));
        }
        if self.stream_validation.timeout_ms == 0 {
            return Err(ConfigError::Message(
                "STREAM_VALIDATION_TIMEOUT_MS must be greater than zero".into(),
            ));
        }
        if self.stream_proxy.timeout_ms == 0 {
            return Err(ConfigError::Message(
                "STREAM_PROXY_TIMEOUT_MS must be greater than zero".into(),
            ));
        }
        if self.stream_proxy.buffer_seconds == 0 {
            return Err(ConfigError::Message(
                "STREAM_PROXY_BUFFER_SECONDS must be greater than zero".into(),
            ));
        }
        if self.stream_pipeline.enabled {
            if self.stream_pipeline.max_concurrency == 0 {
                return Err(ConfigError::Message(
                    "STREAM_PIPELINE_MAX_CONCURRENCY must be greater than zero".into(),
                ));
            }
            if self.stream_pipeline.buffer_seconds == 0 {
                return Err(ConfigError::Message(
                    "STREAM_PIPELINE_BUFFER_SECONDS must be greater than zero".into(),
                ));
            }
            if self.stream_pipeline.timeout_ms == 0 {
                return Err(ConfigError::Message(
                    "STREAM_PIPELINE_TIMEOUT_MS must be greater than zero".into(),
                ));
            }
            if self.stream_pipeline.user_agent.trim().is_empty() {
                return Err(ConfigError::Message(
                    "STREAM_PIPELINE_USER_AGENT must be provided when enabled".into(),
                ));
            }
        }
        self.radio_browser
            .validate(self.allow_insecure_transports)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn config_loads_with_minimum_env() {
        let _guard = ENV_LOCK.lock().unwrap();
        env::set_var("REDIS_URL", "redis://localhost:6379");
        env::set_var("PG_URL", "postgres://user@localhost/db");
        env::set_var("STATIONS_REFRESH_TOKEN", "dummy");
        env::set_var("STATIONS_CACHE_TTL", "60");
        env::remove_var("ALLOW_INSECURE_TRANSPORT");

        let config = Config::load().expect("config should load with dummy env");
        assert!(config.cache_ttl_seconds > 0);
        assert!(config.memory_cache_ttl_seconds > 0);
        assert!(config.stream_validation.concurrency > 0);
    }
}
