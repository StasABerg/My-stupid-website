use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

#[derive(Clone)]
pub struct Logger {
    service: Arc<str>,
}

impl Logger {
    pub fn new(service: &'static str) -> Self {
        Self {
            service: Arc::from(service),
        }
    }

    fn emit<T: Serialize>(&self, level: &str, event: &str, context: T) {
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
        payload.insert("level".into(), Value::String(level.to_string()));
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
            "error" => eprintln!("{}", line),
            "warn" => eprintln!("{}", line),
            _ => println!("{}", line),
        }
    }

    pub fn debug<T: Serialize>(&self, event: &str, context: T) {
        self.emit("debug", event, context);
    }

    pub fn info<T: Serialize>(&self, event: &str, context: T) {
        self.emit("info", event, context);
    }

    pub fn warn<T: Serialize>(&self, event: &str, context: T) {
        self.emit("warn", event, context);
    }

    pub fn error<T: Serialize>(&self, event: &str, context: T) {
        self.emit("error", event, context);
    }
}
