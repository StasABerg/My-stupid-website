use crate::logger::Logger;
use anyhow::{Result, anyhow};
use std::{collections::HashSet, env, time::Duration};

const DEFAULT_PORT: u16 = 8080;
const DEFAULT_RADIO_BASE_URL: &str =
    "http://my-stupid-website-radio.my-stupid-website.svc.cluster.local:4010";
const DEFAULT_TERMINAL_BASE_URL: &str =
    "http://my-stupid-website-terminal.my-stupid-website.svc.cluster.local:80";
const DEFAULT_CACHE_TTL_SECONDS: u64 = 60;

pub trait EnvSource {
    fn get(&self, key: &str) -> Option<String>;
}

#[derive(Default)]
pub struct SystemEnv;

impl EnvSource for SystemEnv {
    fn get(&self, key: &str) -> Option<String> {
        env::var(key).ok()
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub radio_service_url: String,
    pub terminal_service_url: String,
    pub request_timeout: Duration,
    pub allow_origins: Vec<String>,
    pub allowed_service_hostnames: Vec<String>,
    pub session: SessionConfig,
    pub cache: CacheConfig,
    pub csrf_proof_secret: String,
    pub csrf_proof_secret_generated: bool,
    pub trust_proxy: bool,
}

#[derive(Clone, Debug)]
pub struct SessionConfig {
    pub cookie_name: String,
    pub secret: String,
    pub secret_generated: bool,
    pub max_age: Duration,
    pub store: SessionStoreConfig,
}

#[derive(Clone, Debug)]
pub enum SessionStoreConfig {
    Memory,
    Redis(RedisSessionConfig),
}

#[derive(Clone, Debug)]
pub struct RedisSessionConfig {
    pub url: String,
    pub key_prefix: String,
    #[allow(dead_code)]
    pub connect_timeout_ms: u64,
    pub tls_reject_unauthorized: bool,
}

#[derive(Clone, Debug)]
pub struct CacheConfig {
    pub ttl: Duration,
    pub memory: MemoryCacheConfig,
    pub redis: Option<RedisCacheConfig>,
}

#[derive(Clone, Debug)]
pub struct MemoryCacheConfig {
    pub enabled: bool,
    pub max_entries: usize,
}

#[derive(Clone, Debug)]
pub struct RedisCacheConfig {
    pub url: String,
    pub key_prefix: String,
    #[allow(dead_code)]
    pub connect_timeout_ms: u64,
    pub tls_reject_unauthorized: bool,
}

impl Config {
    pub fn load(logger: &Logger) -> Result<Self> {
        Self::load_with_env(logger, &SystemEnv)
    }

    pub fn load_with_env(logger: &Logger, env: &impl EnvSource) -> Result<Self> {
        let port = parse_port(env.get("PORT"), DEFAULT_PORT);
        let radio_service_url = env
            .get("RADIO_SERVICE_URL")
            .map(|value| trim_trailing_slash(&value))
            .unwrap_or_else(|| trim_trailing_slash(DEFAULT_RADIO_BASE_URL));
        let terminal_service_url = env
            .get("TERMINAL_SERVICE_URL")
            .map(|value| trim_trailing_slash(&value))
            .unwrap_or_else(|| trim_trailing_slash(DEFAULT_TERMINAL_BASE_URL));
        let allow_origins = split_list(env.get("CORS_ALLOW_ORIGINS"));
        let explicit_hosts = split_list(env.get("ALLOWED_SERVICE_HOSTNAMES"));
        let derived_hosts = vec![
            extract_hostname(&radio_service_url),
            extract_hostname(&terminal_service_url),
        ]
        .into_iter()
        .flatten();
        let allowed_service_hostnames = merge_unique(explicit_hosts, derived_hosts);

        let request_timeout = Duration::from_millis(parse_positive_int(
            env.get("UPSTREAM_TIMEOUT_MS"),
            10_000,
        ) as u64);

        let session_secret =
            read_required_secret(env.get("SESSION_SECRET"), "SESSION_SECRET", logger)?;
        let session_secret_generated = false;
        let csrf_secret = env.get("CSRF_PROOF_SECRET");
        let (csrf_proof_secret, csrf_proof_secret_generated) =
            if let Some(secret) = read_optional_secret(csrf_secret, "CSRF_PROOF_SECRET", logger)? {
                (secret, false)
            } else {
                (session_secret.clone(), true)
            };

        let session_cookie_name = env
            .get("SESSION_COOKIE_NAME")
            .and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            })
            .unwrap_or_else(|| "gateway.sid".to_string());
        let session_max_age_seconds =
            parse_positive_int(env.get("SESSION_MAX_AGE_SECONDS"), 60 * 60 * 24 * 30);
        let session_max_age = Duration::from_secs(session_max_age_seconds as u64);

        let redis_url = env.get("CACHE_REDIS_URL").or_else(|| env.get("REDIS_URL"));
        let cache_redis_enabled = redis_url
            .as_ref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
        let cache_redis_config = redis_url
            .as_ref()
            .filter(|value| !value.is_empty())
            .map(|url| RedisCacheConfig {
                url: url.clone(),
                key_prefix: env
                    .get("CACHE_KEY_PREFIX")
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "gateway:cache:".to_string()),
                connect_timeout_ms: parse_positive_int(
                    env.get("CACHE_REDIS_CONNECT_TIMEOUT_MS"),
                    5_000,
                ) as u64,
                tls_reject_unauthorized: parse_bool(
                    env.get("CACHE_REDIS_TLS_REJECT_UNAUTHORIZED"),
                    true,
                ),
            });

        let memory_cache_enabled = parse_bool(env.get("CACHE_MEMORY_ENABLED"), true);
        let memory_cache_max_entries =
            parse_positive_int(env.get("CACHE_MEMORY_MAX_ENTRIES"), 200).max(10) as usize;
        let cache_config = CacheConfig {
            ttl: Duration::from_secs(parse_positive_int(
                env.get("CACHE_TTL_SECONDS"),
                DEFAULT_CACHE_TTL_SECONDS as i64,
            ) as u64),
            memory: MemoryCacheConfig {
                enabled: memory_cache_enabled,
                max_entries: memory_cache_max_entries,
            },
            redis: if cache_redis_enabled {
                cache_redis_config
            } else {
                None
            },
        };

        let session_store = resolve_session_store(env, &cache_config, logger)?;

        let session_config = SessionConfig {
            cookie_name: session_cookie_name,
            secret: session_secret,
            secret_generated: session_secret_generated,
            max_age: session_max_age,
            store: session_store,
        };

        let app_env = env
            .get("APP_ENV")
            .unwrap_or_else(|| "development".to_string());

        let config = Self {
            port,
            radio_service_url,
            terminal_service_url,
            request_timeout,
            allow_origins,
            allowed_service_hostnames,
            session: session_config,
            cache: cache_config,
            csrf_proof_secret,
            csrf_proof_secret_generated,
            trust_proxy: parse_bool(env.get("TRUST_PROXY"), false),
        };

        config.validate(&app_env)?;
        Ok(config)
    }
}

fn resolve_session_store(
    env: &impl EnvSource,
    cache_config: &CacheConfig,
    logger: &Logger,
) -> Result<SessionStoreConfig> {
    if let Some(url) = env
        .get("SESSION_REDIS_URL")
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(SessionStoreConfig::Redis(RedisSessionConfig {
            url,
            key_prefix: env
                .get("SESSION_REDIS_KEY_PREFIX")
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "gateway:session:".to_string()),
            connect_timeout_ms: parse_positive_int(
                env.get("SESSION_REDIS_CONNECT_TIMEOUT_MS"),
                5_000,
            ) as u64,
            tls_reject_unauthorized: parse_bool(
                env.get("SESSION_REDIS_TLS_REJECT_UNAUTHORIZED"),
                true,
            ),
        }));
    }

    if let Some(redis) = &cache_config.redis {
        logger.info(
            "session.store.redis_fallback",
            serde_json::json!({
                "message": "Using cache redis configuration for session storage",
            }),
        );
        return Ok(SessionStoreConfig::Redis(RedisSessionConfig {
            url: redis.url.clone(),
            key_prefix: env
                .get("SESSION_REDIS_KEY_PREFIX")
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "gateway:session:".to_string()),
            connect_timeout_ms: parse_positive_int(
                env.get("SESSION_REDIS_CONNECT_TIMEOUT_MS"),
                5_000,
            ) as u64,
            tls_reject_unauthorized: parse_bool(
                env.get("SESSION_REDIS_TLS_REJECT_UNAUTHORIZED"),
                true,
            ),
        }));
    }

    logger.warn(
        "session.store.memory_mode",
        serde_json::json!({
            "message": "Session data falling back to in-memory store",
        }),
    );
    Ok(SessionStoreConfig::Memory)
}

fn parse_port(value: Option<String>, fallback: u16) -> u16 {
    value
        .and_then(|raw| raw.parse::<u16>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

fn parse_positive_int(value: Option<String>, fallback: i64) -> i64 {
    value
        .and_then(|raw| raw.parse::<i64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

fn parse_bool(value: Option<String>, fallback: bool) -> bool {
    match value.map(|raw| raw.trim().to_lowercase()).as_deref() {
        Some("true" | "1" | "yes" | "y") => true,
        Some("false" | "0" | "no" | "n") => false,
        _ => fallback,
    }
}

fn split_list(value: Option<String>) -> Vec<String> {
    value
        .map(|raw| {
            raw.split(',')
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn trim_trailing_slash(value: &str) -> String {
    value.trim_end_matches('/').to_string()
}

fn extract_hostname(value: &str) -> Option<String> {
    url::Url::parse(value)
        .ok()
        .and_then(|url| url.host_str().map(|host| host.to_string()))
}

fn merge_unique(left: Vec<String>, right: impl Iterator<Item = String>) -> Vec<String> {
    let mut set = HashSet::new();
    let mut result = Vec::new();
    for item in left.into_iter().chain(right) {
        if set.insert(item.clone()) {
            result.push(item);
        }
    }
    result
}

fn read_required_secret(value: Option<String>, env_var: &str, logger: &Logger) -> Result<String> {
    let value = value
        .map(|raw| raw.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("{env_var} must be set and non-empty"))?;

    if value.len() < 32 {
        logger.warn(
            "secret.short",
            serde_json::json!({ "label": env_var, "message": "Secret shorter than 32 chars" }),
        );
    }

    Ok(value)
}

fn read_optional_secret(
    value: Option<String>,
    env_var: &str,
    logger: &Logger,
) -> Result<Option<String>> {
    let secret = match value {
        Some(raw) => {
            let trimmed = raw.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        None => None,
    };

    if let Some(secret) = secret.as_ref()
        && secret.len() < 32
    {
        logger.warn(
            "secret.short",
            serde_json::json!({ "label": env_var, "message": "Secret shorter than 32 chars" }),
        );
    }

    Ok(secret)
}

impl Config {
    fn validate(&self, app_env: &str) -> Result<()> {
        if self.request_timeout.as_millis() == 0 {
            return Err(anyhow!("UPSTREAM_TIMEOUT_MS must be greater than zero"));
        }
        if self.cache.ttl.as_secs() == 0 {
            return Err(anyhow!("CACHE_TTL_SECONDS must be greater than zero"));
        }
        if self.cache.memory.enabled && self.cache.memory.max_entries == 0 {
            return Err(anyhow!(
                "CACHE_MEMORY_MAX_ENTRIES must be greater than zero when memory cache is enabled"
            ));
        }

        validate_url(&self.radio_service_url, "RADIO_SERVICE_URL")?;
        validate_url(&self.terminal_service_url, "TERMINAL_SERVICE_URL")?;

        if self.allowed_service_hostnames.is_empty() {
            return Err(anyhow!(
                "ALLOWED_SERVICE_HOSTNAMES must resolve to at least one host"
            ));
        }

        if matches!(self.session.store, SessionStoreConfig::Memory)
            && app_env.eq_ignore_ascii_case("production")
        {
            return Err(anyhow!(
                "session store cannot fall back to memory when APP_ENV=production"
            ));
        }

        Ok(())
    }
}

fn validate_url(value: &str, label: &str) -> Result<()> {
    let url = url::Url::parse(value).map_err(|err| anyhow!("{label} invalid URL: {err}"))?;
    match url.scheme() {
        "http" | "https" => {}
        other => {
            return Err(anyhow!("{label} must use http or https (got {other})"));
        }
    }
    if url.host_str().unwrap_or_default().is_empty() {
        return Err(anyhow!("{label} must include a host"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logger::Logger;
    use std::collections::HashMap;

    #[derive(Default)]
    struct TestEnv {
        values: HashMap<String, String>,
    }

    impl TestEnv {
        fn with(mut self, key: &str, value: &str) -> Self {
            self.values.insert(key.to_string(), value.to_string());
            self
        }
    }

    impl EnvSource for TestEnv {
        fn get(&self, key: &str) -> Option<String> {
            self.values.get(key).cloned()
        }
    }

    #[test]
    fn config_loads_with_dummy_env() {
        let env = TestEnv::default()
            .with("SESSION_SECRET", "a_secure_dummy_secret_value_that_is_long")
            .with("PORT", "18080");

        let config = Config::load_with_env(&Logger::new("test"), &env).expect("config should load");
        assert!(config.port > 0);
        assert_eq!(config.allowed_service_hostnames.len(), 2);
        assert!(config.cache.ttl.as_secs() > 0);
    }
}
