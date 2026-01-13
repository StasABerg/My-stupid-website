use serde_json::{Map, Value};
use std::env;
use std::fmt::Display;
use time::OffsetDateTime;

const SERVICE_NAME: &str = "terminal-service";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
}

impl LogLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            LogLevel::Error => "error",
            LogLevel::Warn => "warn",
            LogLevel::Info => "info",
            LogLevel::Debug => "debug",
        }
    }

    pub fn from_env() -> Self {
        match env::var("LOG_LEVEL")
            .unwrap_or_else(|_| "info".to_string())
            .to_ascii_lowercase()
            .as_str()
        {
            "error" => LogLevel::Error,
            "warn" => LogLevel::Warn,
            "debug" => LogLevel::Debug,
            _ => LogLevel::Info,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Logger {
    env: String,
    host: String,
    min_level: LogLevel,
}

impl Logger {
    pub fn new(host: String) -> Self {
        let env = env::var("APP_ENV")
            .or_else(|_| env::var("NODE_ENV"))
            .or_else(|_| env::var("RUST_ENV"))
            .unwrap_or_else(|_| "development".to_string());
        Self {
            env,
            host,
            min_level: LogLevel::from_env(),
        }
    }

    pub fn info(&self, event: &str, context: impl Into<Value>) {
        self.emit(LogLevel::Info, event, context);
    }

    #[allow(dead_code)]
    pub fn warn(&self, event: &str, context: impl Into<Value>) {
        self.emit(LogLevel::Warn, event, context);
    }

    pub fn error(&self, event: &str, context: impl Into<Value>) {
        self.emit(LogLevel::Error, event, context);
    }

    #[allow(dead_code)]
    pub fn debug(&self, event: &str, context: impl Into<Value>) {
        self.emit(LogLevel::Debug, event, context);
    }

    fn emit(&self, level: LogLevel, event: &str, context: impl Into<Value>) {
        if level > self.min_level {
            return;
        }
        let mut payload = Map::new();
        payload.insert("timestamp".to_string(), Value::String(OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap_or_else(|_| "".to_string())));
        payload.insert("service".to_string(), Value::String(SERVICE_NAME.to_string()));
        payload.insert("env".to_string(), Value::String(self.env.clone()));
        payload.insert("host".to_string(), Value::String(self.host.clone()));
        payload.insert("level".to_string(), Value::String(level.as_str().to_string()));
        payload.insert("event".to_string(), Value::String(event.to_string()));

        match context.into() {
            Value::Object(map) => {
                for (key, value) in map {
                    payload.insert(key, value);
                }
            }
            other => {
                payload.insert("context".to_string(), other);
            }
        }

        let message = Value::Object(payload).to_string();
        match level {
            LogLevel::Error => eprintln!("{}", message),
            LogLevel::Warn => eprintln!("{}", message),
            _ => println!("{}", message),
        }
    }
}

#[allow(dead_code)]
pub fn log_error<E: Display>(logger: &Logger, event: &str, error: E) {
    logger.error(
        event,
        Value::Object(Map::from_iter([(
            "error".to_string(),
            Value::String(error.to_string()),
        )])),
    );
}
