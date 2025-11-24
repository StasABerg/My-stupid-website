use crate::config::Config;
use crate::logger::Logger;
use anyhow::{Result, anyhow};
use http::Uri;
use percent_encoding::percent_decode_str;
use std::sync::Arc;

const RADIO_PREFIX: &str = "/radio";
const TERMINAL_PREFIX: &str = "/terminal";

#[derive(Clone)]
pub struct Routing {
    config: Arc<Config>,
    logger: Logger,
}

#[derive(Clone)]
pub struct Target {
    pub base_url: String,
    pub path: String,
    pub service: &'static str,
}

#[derive(Clone)]
pub struct ParsedUri {
    pub path: String,
    pub query: Option<String>,
}

#[derive(Debug)]
pub struct UriValidationError {
    pub status: u16,
    pub message: &'static str,
    pub reason: &'static str,
}

impl Routing {
    pub fn new(config: Arc<Config>, logger: Logger) -> Self {
        Self { config, logger }
    }

    pub fn validate_base_urls(&self) -> Result<()> {
        self.validate_base_url("radioServiceUrl", &self.config.radio_service_url)?;
        self.validate_base_url("terminalServiceUrl", &self.config.terminal_service_url)?;
        Ok(())
    }

    fn validate_base_url(&self, label: &str, url: &str) -> Result<()> {
        let parsed = url::Url::parse(url).map_err(|error| anyhow!("invalid {label}: {error}"))?;
        let hostname = parsed
            .host_str()
            .ok_or_else(|| anyhow!("{label} missing hostname"))?
            .to_string();
        if !self
            .config
            .allowed_service_hostnames
            .iter()
            .any(|value| value == &hostname)
        {
            return Err(anyhow!(
                "blocked hostname {hostname} for {label}; allowed: {}",
                self.config.allowed_service_hostnames.join(", ")
            ));
        }
        Ok(())
    }

    pub fn parse_uri(&self, uri: &Uri) -> Result<ParsedUri, UriValidationError> {
        if uri.scheme().is_some() || uri.authority().is_some() {
            return Err(UriValidationError {
                status: 400,
                message: "Invalid request URI",
                reason: "unexpected-authority",
            });
        }
        let path_and_query = uri
            .path_and_query()
            .map(|value| value.as_str())
            .unwrap_or("/");
        if path_and_query
            .chars()
            .any(|ch| ch <= '\u{001f}' || ch == '\u{007f}' || ch == '\\')
        {
            return Err(UriValidationError {
                status: 400,
                message: "Invalid request URI",
                reason: "invalid-characters",
            });
        }
        let mut splitter = path_and_query.splitn(2, '?');
        let path = splitter.next().unwrap_or("/");
        let query = splitter.next().map(|value| value.to_string());
        Ok(ParsedUri {
            path: path.to_string(),
            query,
        })
    }

    pub fn determine_target(&self, path: &str) -> Option<Target> {
        if path == RADIO_PREFIX || path.starts_with(&format!("{RADIO_PREFIX}/")) {
            let suffix = path.trim_start_matches(RADIO_PREFIX);
            let sanitized = self.sanitize_path(RADIO_PREFIX, suffix)?;
            return Some(Target {
                base_url: self.config.radio_service_url.clone(),
                path: sanitized,
                service: "radio",
            });
        }

        if path == TERMINAL_PREFIX || path.starts_with(&format!("{TERMINAL_PREFIX}/")) {
            let suffix = path.trim_start_matches(TERMINAL_PREFIX);
            let sanitized = self.sanitize_path(TERMINAL_PREFIX, suffix)?;
            return Some(Target {
                base_url: self.config.terminal_service_url.clone(),
                path: sanitized,
                service: "terminal",
            });
        }

        None
    }

    fn sanitize_path(&self, prefix: &str, suffix: &str) -> Option<String> {
        let mut normalized = if suffix.is_empty() {
            "/".to_string()
        } else {
            suffix.to_string()
        };
        if !normalized.starts_with('/') {
            normalized = format!("/{normalized}");
        }
        let decoded = decode_until_stable(&normalized);
        if contains_traversal(&normalized) || contains_traversal(&decoded) {
            self.logger.warn(
                "request.blocked_ssrf_attempt",
                serde_json::json!({ "prefix": prefix, "suffix": suffix }),
            );
            return None;
        }
        let collapsed = decoded.replace("//", "/");
        Some(if collapsed.is_empty() {
            "/".into()
        } else {
            collapsed
        })
    }

    pub fn should_cache(&self, method: &http::Method, target: &Target) -> bool {
        if method != http::Method::GET {
            return false;
        }
        target.service == "radio"
            && target.path.starts_with("/stations")
            && !target.path.contains("/stream")
    }

    pub fn build_cache_key(&self, target: &Target, query: Option<&str>) -> String {
        let mut params: Vec<(String, String)> = query
            .unwrap_or("")
            .split('&')
            .filter_map(|pair| {
                if pair.is_empty() {
                    return None;
                }
                let mut parts = pair.splitn(2, '=');
                let key = parts.next()?.to_string();
                let value = parts.next().unwrap_or("").to_string();
                Some((key, value))
            })
            .collect();
        params.sort_by(|a, b| a.0.cmp(&b.0));
        let serialized = params
            .into_iter()
            .map(|(k, v)| format!("{}={}", urlencoding::encode(&k), urlencoding::encode(&v)))
            .collect::<Vec<_>>()
            .join("&");
        if serialized.is_empty() {
            format!("{}:{}", target.service, target.path)
        } else {
            format!("{}:{}?{}", target.service, target.path, serialized)
        }
    }
}

fn decode_until_stable(value: &str) -> String {
    let mut current = value.to_string();
    for _ in 0..3 {
        let decoded = percent_decode_str(&current).decode_utf8_lossy().to_string();
        if decoded == current {
            break;
        }
        current = decoded;
    }
    current
}

fn contains_traversal(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("..")
        || lower.contains('\\')
        || lower.contains("//")
        || lower.contains("%2e%2f")
        || lower.contains("%2f%2e")
        || lower.contains("%5c")
        || lower.contains("%2e%2e")
}
