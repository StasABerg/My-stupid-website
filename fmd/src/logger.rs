use hostname::get;
use serde::Serialize;
use serde_json::Value;
use std::env;
use std::sync::Arc;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
}

impl LogLevel {
    fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Error => "error",
            LogLevel::Warn => "warn",
            LogLevel::Info => "info",
            LogLevel::Debug => "debug",
        }
    }

    fn from_str(value: &str) -> Self {
        match value.to_ascii_lowercase().as_str() {
            "error" => LogLevel::Error,
            "warn" | "warning" => LogLevel::Warn,
            "debug" => LogLevel::Debug,
            _ => LogLevel::Info,
        }
    }
}

#[derive(Clone)]
pub struct Logger {
    service: Arc<str>,
    environment: Arc<str>,
    host: Arc<str>,
    min_level: LogLevel,
}

impl Logger {
    pub fn new(service: &'static str) -> Self {
        let environment = env::var("APP_ENV")
            .or_else(|_| env::var("RUST_ENV"))
            .unwrap_or_else(|_| "development".to_string());
        let host = get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .or_else(|| env::var("HOSTNAME").ok())
            .unwrap_or_else(|| "unknown".to_string());
        let min_level = env::var("LOG_LEVEL")
            .ok()
            .map(|value| LogLevel::from_str(&value))
            .unwrap_or(LogLevel::Info);

        Self {
            service: Arc::from(service),
            environment: Arc::from(environment),
            host: Arc::from(host),
            min_level,
        }
    }

    fn should_log(&self, level: LogLevel) -> bool {
        level <= self.min_level
    }

    fn emit<T: Serialize>(&self, level: LogLevel, event: &str, context: T) {
        if !self.should_log(level) {
            return;
        }

        let timestamp = OffsetDateTime::now_utc();
        let serialized = serde_json::to_value(context).unwrap_or(Value::Null);
        let mut payload = serde_json::Map::new();
        payload.insert(
            "timestamp".into(),
            Value::String(
                timestamp
                    .format(&Rfc3339)
                    .unwrap_or_else(|_| timestamp.to_string()),
            ),
        );
        payload.insert("service".into(), Value::String(self.service.to_string()));
        payload.insert("env".into(), Value::String(self.environment.to_string()));
        payload.insert("host".into(), Value::String(self.host.to_string()));
        payload.insert("level".into(), Value::String(level.as_str().to_string()));
        payload.insert("event".into(), Value::String(event.to_string()));

        match serialized {
            Value::Object(map) => {
                for (key, value) in map {
                    payload.insert(key, value);
                }
            }
            Value::Null => {}
            other => {
                payload.insert("context".into(), other);
            }
        }

        let line = Value::Object(payload).to_string();
        match level {
            LogLevel::Error | LogLevel::Warn => eprintln!("{line}"),
            _ => println!("{line}"),
        }
    }

    pub fn debug<T: Serialize>(&self, event: &str, context: T) {
        self.emit(LogLevel::Debug, event, context);
    }

    pub fn info<T: Serialize>(&self, event: &str, context: T) {
        self.emit(LogLevel::Info, event, context);
    }

    pub fn warn<T: Serialize>(&self, event: &str, context: T) {
        self.emit(LogLevel::Warn, event, context);
    }

    pub fn error<T: Serialize>(&self, event: &str, context: T) {
        self.emit(LogLevel::Error, event, context);
    }
}
