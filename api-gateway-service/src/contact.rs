use anyhow::Result;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use lettre::{
    message::{header::ContentType, Message},
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Tokio1Executor,
};
use redis::AsyncCommands;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, LazyLock};

use crate::app::AppState;

static EMAIL_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$")
        .expect("email regex should compile")
});

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactRequest {
    name: String,
    email: Option<String>,
    message: String,
    #[serde(default)]
    turnstile_token: Option<String>,
    #[serde(default)]
    honeypot: Option<String>,
    #[serde(default)]
    timestamp: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactResponse {
    request_id: String,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TurnstileVerifyRequest {
    secret: String,
    response: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    remoteip: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TurnstileVerifyResponse {
    success: bool,
    #[serde(default)]
    _challenge_ts: Option<String>,
    #[serde(default)]
    _hostname: Option<String>,
    #[serde(default, rename = "error-codes")]
    _error_codes: Vec<String>,
}

pub async fn handle_contact(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<ContactRequest>,
) -> Result<Response, ContactError> {
    let logger = &state.logger;
    let config = state.config.contact.as_ref().ok_or(ContactError::Unavailable)?;

    let request_id = headers
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    let client_ip = extract_client_ip(&headers);
    let user_agent = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Honeypot check
    if req.honeypot.as_deref().unwrap_or("").trim() != "" {
        logger.warn("contact.honeypot_triggered", serde_json::json!({
            "requestId": request_id,
            "clientIp": client_ip,
        }));
        return Err(ContactError::Spam);
    }

    // Timestamp check (minimum 2 seconds to fill form)
    if let Some(ts) = req.timestamp {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        if now - ts < 2 {
            logger.warn("contact.too_fast", serde_json::json!({
                "requestId": request_id,
                "clientIp": client_ip,
                "duration": now - ts,
            }));
            return Err(ContactError::Spam);
        }
    }

    // Validate inputs
    validate_contact_request(&req)?;

    // Turnstile verification
    if config.turnstile.enabled {
        let token = req
            .turnstile_token
            .as_deref()
            .ok_or(ContactError::MissingTurnstile)?;
        verify_turnstile(
            &state.http_client,
            &config.turnstile.secret_key,
            token,
            client_ip.as_deref(),
        )
        .await?;
    }

    // Rate limiting
    if let Some(ip) = &client_ip {
        check_rate_limit(&state, ip, config.rate_limit.max_per_ip, config.rate_limit.window_seconds).await?;
    }

    // Deduplication
    let fingerprint = compute_fingerprint(&req);
    check_duplicate(&state, &fingerprint, config.rate_limit.dedupe_window_seconds).await?;

    // Send email
    send_contact_email(&state, config, &req, &request_id, &client_ip, &user_agent).await?;

    logger.info("contact.submitted", serde_json::json!({
        "requestId": request_id,
        "clientIp": client_ip,
    }));

    Ok(Json(ContactResponse {
        request_id: request_id.clone(),
        status: "received".to_string(),
    })
    .into_response())
}

fn extract_client_ip(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|raw| raw.split(',').next())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|value| value.to_str().ok())
                .map(|value| value.to_string())
        })
}

fn validate_contact_request(req: &ContactRequest) -> Result<(), ContactError> {
    // Name validation
    let name = req.name.trim();
    if name.is_empty() {
        return Err(ContactError::Validation("name cannot be empty".to_string()));
    }
    if req.name.len() > 80 {
        return Err(ContactError::Validation("name too long (max 80 chars)".to_string()));
    }
    if contains_control_chars(&req.name) {
        return Err(ContactError::Validation("name contains invalid characters".to_string()));
    }

    // Email validation
    if let Some(email) = &req.email {
        if email.len() > 120 {
            return Err(ContactError::Validation("email too long (max 120 chars)".to_string()));
        }
        if !EMAIL_REGEX.is_match(email) {
            return Err(ContactError::Validation("invalid email format".to_string()));
        }
    }

    // Message validation
    let message = req.message.trim();
    if message.is_empty() {
        return Err(ContactError::Validation("message cannot be empty".to_string()));
    }
    if message.len() > 2000 {
        return Err(ContactError::Validation("message too long (max 2000 chars)".to_string()));
    }
    if contains_control_chars(&req.message) {
        return Err(ContactError::Validation("message contains invalid characters".to_string()));
    }

    Ok(())
}

fn contains_control_chars(s: &str) -> bool {
    s.chars().any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
}

async fn verify_turnstile(
    client: &reqwest::Client,
    secret: &str,
    token: &str,
    ip: Option<&str>,
) -> Result<(), ContactError> {
    let verify_req = TurnstileVerifyRequest {
        secret: secret.to_string(),
        response: token.to_string(),
        remoteip: ip.map(|s| s.to_string()),
    };

    let resp = client
        .post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
        .json(&verify_req)
        .send()
        .await
        .map_err(|_| ContactError::TurnstileFailed)?;

    let verify_resp: TurnstileVerifyResponse = resp
        .json()
        .await
        .map_err(|_| ContactError::TurnstileFailed)?;

    if !verify_resp.success {
        return Err(ContactError::TurnstileFailed);
    }

    Ok(())
}

async fn check_rate_limit(
    state: &AppState,
    client_ip: &str,
    max_requests: u32,
    window_seconds: u64,
) -> Result<(), ContactError> {
    let redis_config = match &state.config.cache.redis {
        Some(r) => r,
        None => return Ok(()), // No Redis, skip rate limiting
    };

    let mut conn = state
        .redis_cache_client
        .as_ref()
        .ok_or(ContactError::Internal)?
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| ContactError::Internal)?;

    let key = format!("{}contact:ratelimit:{}", redis_config.key_prefix, client_ip);
    let count: u32 = conn.incr(&key, 1).await.map_err(|_| ContactError::Internal)?;

    if count == 1 {
        let _: () = conn
            .expire(&key, window_seconds as i64)
            .await
            .map_err(|_| ContactError::Internal)?;
    }

    if count > max_requests {
        return Err(ContactError::RateLimited);
    }

    Ok(())
}

async fn check_duplicate(
    state: &AppState,
    fingerprint: &str,
    window_seconds: u64,
) -> Result<(), ContactError> {
    let redis_config = match &state.config.cache.redis {
        Some(r) => r,
        None => return Ok(()), // No Redis, skip deduplication
    };

    let mut conn = state
        .redis_cache_client
        .as_ref()
        .ok_or(ContactError::Internal)?
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| ContactError::Internal)?;

    let key = format!("{}contact:dedupe:{}", redis_config.key_prefix, fingerprint);
    let exists: bool = conn.exists(&key).await.map_err(|_| ContactError::Internal)?;

    if exists {
        return Err(ContactError::Duplicate);
    }

    let _: () = conn
        .set_ex(&key, "1", window_seconds)
        .await
        .map_err(|_| ContactError::Internal)?;

    Ok(())
}

fn compute_fingerprint(req: &ContactRequest) -> String {
    let mut hasher = Sha256::new();
    hasher.update(req.message.to_lowercase().trim().as_bytes());
    if let Some(email) = &req.email {
        hasher.update(email.to_lowercase().trim().as_bytes());
    }
    hex::encode(hasher.finalize())
}

async fn send_contact_email(
    state: &AppState,
    contact_config: &crate::config::ContactConfig,
    req: &ContactRequest,
    request_id: &str,
    client_ip: &Option<String>,
    user_agent: &Option<String>,
) -> Result<(), ContactError> {
    let config = &contact_config.email;

    let email_display = req
        .email
        .as_ref()
        .map(|e| e.trim())
        .filter(|e| !e.is_empty())
        .unwrap_or("(not provided)");

    let body = format!(
        "New contact form submission\n\n\
        Request ID: {}\n\
        Name: {}\n\
        Email: {}\n\
        Client IP: {}\n\
        User Agent: {}\n\n\
        Message:\n{}\n",
        request_id,
        req.name.trim(),
        email_display,
        client_ip.as_deref().unwrap_or("(unknown)"),
        user_agent.as_deref().unwrap_or("(unknown)"),
        req.message.trim(),
    );

    let email = Message::builder()
        .from(config.from_address.parse().map_err(|_| ContactError::EmailFailed)?)
        .to(config.to_address.parse().map_err(|_| ContactError::EmailFailed)?)
        .subject("[Contact] New Message")
        .header(ContentType::TEXT_PLAIN)
        .body(body)
        .map_err(|_| ContactError::EmailFailed)?;

    let creds = Credentials::new(
        config.smtp_username.clone(),
        config.smtp_password.clone(),
    );

    let mailer = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.smtp_host)
        .map_err(|_| ContactError::EmailFailed)?
        .port(config.smtp_port)
        .credentials(creds)
        .build();

    mailer
        .send(email)
        .await
        .map_err(|e| {
            state.logger.error("contact.email_send_failed", serde_json::json!({
                "error": e.to_string(),
                "requestId": request_id,
            }));
            ContactError::EmailFailed
        })?;

    Ok(())
}

#[derive(Debug)]
pub enum ContactError {
    Validation(String),
    MissingTurnstile,
    TurnstileFailed,
    RateLimited,
    Duplicate,
    Spam,
    EmailFailed,
    Internal,
    Unavailable,
}

impl IntoResponse for ContactError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ContactError::Validation(msg) => (StatusCode::BAD_REQUEST, msg),
            ContactError::MissingTurnstile => (StatusCode::BAD_REQUEST, "missing turnstile token".to_string()),
            ContactError::TurnstileFailed => (StatusCode::BAD_REQUEST, "turnstile verification failed".to_string()),
            ContactError::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded".to_string()),
            ContactError::Duplicate => (StatusCode::CONFLICT, "duplicate submission".to_string()),
            ContactError::Spam => (StatusCode::BAD_REQUEST, "invalid submission".to_string()),
            ContactError::EmailFailed => (StatusCode::INTERNAL_SERVER_ERROR, "failed to send email".to_string()),
            ContactError::Internal => (StatusCode::INTERNAL_SERVER_ERROR, "internal error".to_string()),
            ContactError::Unavailable => (StatusCode::SERVICE_UNAVAILABLE, "contact form is not configured".to_string()),
        };

        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}
