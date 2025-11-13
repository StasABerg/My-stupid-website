use crate::logger::Logger;
use crate::metrics::GatewayMetrics;
use http::{HeaderMap, Method, Uri};
use serde_json::json;
use std::{net::SocketAddr, time::Instant};
use uuid::Uuid;

#[derive(Clone)]
pub struct RequestContextManager {
    logger: Logger,
    metrics: GatewayMetrics,
}

pub struct RequestContext {
    pub request_id: String,
    pub method: Method,
    pub raw_uri: String,
    pub origin: Option<String>,
    pub remote_address: Option<String>,
    started_at: Instant,
    completed: bool,
    logger: Logger,
    metrics: GatewayMetrics,
}

impl RequestContextManager {
    pub fn new(logger: Logger, metrics: GatewayMetrics) -> Self {
        Self { logger, metrics }
    }

    pub fn start(
        &self,
        method: Method,
        uri: &Uri,
        headers: &HeaderMap,
        remote: Option<&SocketAddr>,
    ) -> RequestContext {
        let request_id = headers
            .get("x-request-id")
            .and_then(|value| value.to_str().ok())
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.to_string())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let origin = headers
            .get("origin")
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string());
        let remote_address = remote.map(|addr| addr.to_string());
        self.metrics.start_request();
        let context = RequestContext {
            method: method.clone(),
            raw_uri: uri.to_string(),
            request_id: request_id.clone(),
            origin,
            remote_address,
            started_at: Instant::now(),
            completed: false,
            logger: self.logger.clone(),
            metrics: self.metrics.clone(),
        };
        self.logger.info(
            "request.received",
            json!({
                "requestId": request_id,
                "method": method.as_str(),
                "rawUrl": context.raw_uri,
                "origin": context.origin,
                "remoteAddress": context.remote_address,
            }),
        );
        context
    }
}

impl RequestContext {
    pub fn complete(mut self, status_code: u16, extra: serde_json::Value) {
        if self.completed {
            return;
        }
        self.completed = true;
        self.metrics.finish_request();
        let duration_ms = self.started_at.elapsed().as_secs_f64() * 1000.0;
        let mut payload = json!({
            "requestId": self.request_id,
            "method": self.method.as_str(),
            "rawUrl": self.raw_uri,
            "statusCode": status_code,
            "durationMs": duration_ms,
        });
        if let Some(origin) = &self.origin {
            payload["origin"] = json!(origin);
        }
        if let Some(remote) = &self.remote_address {
            payload["remoteAddress"] = json!(remote);
        }
        if let serde_json::Value::Object(additional) = extra {
            for (key, value) in additional {
                payload[&key] = value;
            }
        }
        self.logger.info("request.completed", payload);
    }
}
