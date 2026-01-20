use anyhow::Result;
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Tokio1Executor,
    message::{
        Message,
        header::{ContentType, Header, HeaderName, HeaderValue},
    },
    transport::smtp::authentication::Credentials,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, LazyLock};

use crate::app::AppState;
use crate::logger::Logger;
use uuid::Uuid;

#[derive(Clone)]
struct ContactRequestIdHeader(String);

impl Header for ContactRequestIdHeader {
    fn name() -> HeaderName {
        HeaderName::new_from_ascii_str("X-Contact-Request-Id")
    }

    fn parse(s: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        Ok(Self(s.to_string()))
    }

    fn display(&self) -> HeaderValue {
        HeaderValue::new(Self::name(), self.0.clone())
    }
}

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
    challenge_ts: Option<String>,
    #[serde(default)]
    hostname: Option<String>,
    #[serde(default)]
    action: Option<String>,
    #[serde(default)]
    cdata: Option<String>,
    #[serde(default, rename = "error-codes")]
    error_codes: Vec<String>,
}

pub async fn handle_contact(
    State(state): State<Arc<AppState>>,
    method: http::Method,
    headers: HeaderMap,
    Json(req): Json<ContactRequest>,
) -> Result<Response, ContactError> {
    let logger = &state.logger;
    let config = state
        .config
        .contact
        .as_ref()
        .ok_or(ContactError::Unavailable)?;

    // Validate CSRF token
    state
        .session_manager
        .validate_session(&headers, &method, None)
        .await
        .map_err(|e| {
            logger.warn(
                "contact.csrf_validation_failed",
                serde_json::json!({
                    "status": e.status,
                    "message": e.message,
                }),
            );
            ContactError::CsrfValidationFailed
        })?;

    let request_id = headers
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let client_ip = extract_client_ip(&headers);
    let user_agent = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Honeypot check
    if req.honeypot.as_deref().unwrap_or("").trim() != "" {
        logger.warn(
            "contact.honeypot_triggered",
            serde_json::json!({
                "requestId": request_id,
                "clientIp": client_ip,
            }),
        );
        return Err(ContactError::Spam);
    }

    // Timestamp check (minimum 2 seconds to fill form)
    if let Some(ts) = req.timestamp {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        if now - ts < 2 {
            logger.warn(
                "contact.too_fast",
                serde_json::json!({
                    "requestId": request_id,
                    "clientIp": client_ip,
                    "duration": now - ts,
                }),
            );
            return Err(ContactError::Spam);
        }
    }

    // Validate inputs
    validate_contact_request(&req)?;

    let turnstile_token = if config.turnstile.enabled {
        Some(
            req.turnstile_token
                .as_deref()
                .ok_or(ContactError::MissingTurnstile)?,
        )
    } else {
        None
    };

    // Rate limiting
    if let Some(ip) = &client_ip {
        check_rate_limit(
            &state,
            ip,
            config.rate_limit.max_per_ip,
            config.rate_limit.window_seconds,
        )
        .await?;
    }

    // Deduplication
    let fingerprint = compute_fingerprint(&req);
    check_duplicate(
        &state,
        &fingerprint,
        config.rate_limit.dedupe_window_seconds,
    )
    .await?;

    // Turnstile verification (validate after cheap anti-spam checks to avoid burning tokens early).
    if let Some(token) = turnstile_token {
        verify_turnstile(
            &state.http_client,
            logger,
            &request_id,
            client_ip.as_deref(),
            &config.turnstile.secret_key,
            token,
        )
        .await?;
    }

    // Send email
    send_contact_email(&state, config, &req, &request_id, &client_ip, &user_agent).await?;

    logger.info(
        "contact.submitted",
        serde_json::json!({
            "requestId": request_id,
            "clientIp": client_ip,
        }),
    );

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
        return Err(ContactError::Validation(
            "name too long (max 80 chars)".to_string(),
        ));
    }
    if contains_control_chars(&req.name) {
        return Err(ContactError::Validation(
            "name contains invalid characters".to_string(),
        ));
    }

    // Email validation
    if let Some(email) = &req.email {
        if email.len() > 120 {
            return Err(ContactError::Validation(
                "email too long (max 120 chars)".to_string(),
            ));
        }
        if !EMAIL_REGEX.is_match(email) {
            return Err(ContactError::Validation("invalid email format".to_string()));
        }
    }

    // Message validation
    let message = req.message.trim();
    if message.is_empty() {
        return Err(ContactError::Validation(
            "message cannot be empty".to_string(),
        ));
    }
    if message.len() > 2000 {
        return Err(ContactError::Validation(
            "message too long (max 2000 chars)".to_string(),
        ));
    }
    if contains_control_chars(&req.message) {
        return Err(ContactError::Validation(
            "message contains invalid characters".to_string(),
        ));
    }

    Ok(())
}

fn contains_control_chars(s: &str) -> bool {
    s.chars()
        .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
}

async fn verify_turnstile(
    client: &reqwest::Client,
    logger: &Logger,
    request_id: &str,
    client_ip: Option<&str>,
    secret: &str,
    token: &str,
) -> Result<(), ContactError> {
    if token.len() > 2048 {
        logger.warn(
            "contact.turnstile_token_too_long",
            serde_json::json!({
                "requestId": request_id,
                "clientIp": client_ip,
                "tokenLength": token.len(),
            }),
        );
        return Err(ContactError::TurnstileFailed);
    }

    let verify_req = TurnstileVerifyRequest {
        secret: secret.to_string(),
        response: token.to_string(),
        remoteip: client_ip.map(|s| s.to_string()),
    };

    let resp = client
        .post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
        .json(&verify_req)
        .send()
        .await
        .map_err(|error| {
            logger.warn(
                "contact.turnstile_request_failed",
                serde_json::json!({
                    "requestId": request_id,
                    "clientIp": client_ip,
                    "error": error.to_string(),
                }),
            );
            ContactError::TurnstileFailed
        })?;

    let status = resp.status();

    let verify_resp: TurnstileVerifyResponse = resp.json().await.map_err(|error| {
        logger.warn(
            "contact.turnstile_response_unreadable",
            serde_json::json!({
                "requestId": request_id,
                "clientIp": client_ip,
                "statusCode": status.as_u16(),
                "error": error.to_string(),
            }),
        );
        ContactError::TurnstileFailed
    })?;

    if !status.is_success() || !verify_resp.success {
        logger.warn(
            "contact.turnstile_failed",
            serde_json::json!({
                "requestId": request_id,
                "clientIp": client_ip,
                "statusCode": status.as_u16(),
                "success": verify_resp.success,
                "errorCodes": verify_resp.error_codes,
                "hostname": verify_resp.hostname,
                "challengeTs": verify_resp.challenge_ts,
                "action": verify_resp.action,
                "cdata": verify_resp.cdata,
            }),
        );
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
    let updated: Result<i64, _> = sqlx::query_scalar(
        r#"
        INSERT INTO gateway_contact_rate_limit (client_ip, count, expires_at, updated_at)
        VALUES ($1, 1, NOW() + ($2 * interval '1 second'), NOW())
        ON CONFLICT (client_ip) DO UPDATE
          SET count = CASE
              WHEN gateway_contact_rate_limit.expires_at <= NOW() THEN 1
              ELSE gateway_contact_rate_limit.count + 1
          END,
          expires_at = CASE
              WHEN gateway_contact_rate_limit.expires_at <= NOW() THEN NOW() + ($2 * interval '1 second')
              ELSE gateway_contact_rate_limit.expires_at
          END,
          updated_at = NOW()
        RETURNING count
        "#,
    )
    .bind(client_ip)
    .bind(i64::try_from(window_seconds).unwrap_or(i64::MAX))
    .fetch_one(&state.postgres)
    .await;

    let count = match updated {
        Ok(value) => value,
        Err(error) => {
            state.logger.warn(
                "contact.rate_limit_store_unavailable",
                serde_json::json!({
                    "clientIp": client_ip,
                    "error": error.to_string(),
                }),
            );
            return Ok(());
        }
    };

    if count > max_requests as i64 {
        return Err(ContactError::RateLimited);
    }

    Ok(())
}

async fn check_duplicate(
    state: &AppState,
    fingerprint: &str,
    window_seconds: u64,
) -> Result<(), ContactError> {
    let inserted: Result<Option<i64>, _> = sqlx::query_scalar(
        r#"
        INSERT INTO gateway_contact_dedupe (fingerprint, expires_at)
        VALUES ($1, NOW() + ($2 * interval '1 second'))
        ON CONFLICT (fingerprint) DO UPDATE
          SET expires_at = EXCLUDED.expires_at
        WHERE gateway_contact_dedupe.expires_at <= NOW()
        RETURNING 1
        "#,
    )
    .bind(fingerprint)
    .bind(i64::try_from(window_seconds).unwrap_or(i64::MAX))
    .fetch_optional(&state.postgres)
    .await;

    match inserted {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err(ContactError::Duplicate),
        Err(error) => {
            state.logger.warn(
                "contact.dedupe_store_unavailable",
                serde_json::json!({
                    "fingerprint": fingerprint,
                    "error": error.to_string(),
                }),
            );
            Ok(())
        }
    }
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

    let subject = format!("[Contact {}] New Message", request_id);
    let message_id =
        lettre::message::header::MessageId::from(format!("<contact-{}@gitgud.zip>", request_id));

    let email = Message::builder()
        .from(
            config
                .from_address
                .parse()
                .map_err(|_| ContactError::EmailFailed)?,
        )
        .to(config
            .to_address
            .parse()
            .map_err(|_| ContactError::EmailFailed)?)
        .subject(subject)
        .header(message_id)
        .header(ContactRequestIdHeader(request_id.to_string()))
        .header(ContentType::TEXT_PLAIN)
        .body(body)
        .map_err(|_| ContactError::EmailFailed)?;

    let creds = Credentials::new(config.smtp_username.clone(), config.smtp_password.clone());

    let mailer = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.smtp_host)
        .map_err(|_| ContactError::EmailFailed)?
        .port(config.smtp_port)
        .credentials(creds)
        .build();

    mailer.send(email).await.map_err(|e| {
        state.logger.error(
            "contact.email_send_failed",
            serde_json::json!({
                "error": e.to_string(),
                "requestId": request_id,
            }),
        );
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
    CsrfValidationFailed,
}

impl IntoResponse for ContactError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ContactError::Validation(msg) => (StatusCode::BAD_REQUEST, msg),
            ContactError::MissingTurnstile => (
                StatusCode::BAD_REQUEST,
                "missing turnstile token".to_string(),
            ),
            ContactError::TurnstileFailed => (
                StatusCode::BAD_REQUEST,
                "turnstile verification failed".to_string(),
            ),
            ContactError::RateLimited => (
                StatusCode::TOO_MANY_REQUESTS,
                "rate limit exceeded".to_string(),
            ),
            ContactError::Duplicate => (StatusCode::CONFLICT, "duplicate submission".to_string()),
            ContactError::Spam => (StatusCode::BAD_REQUEST, "invalid submission".to_string()),
            ContactError::EmailFailed => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to send email".to_string(),
            ),
            ContactError::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal error".to_string(),
            ),
            ContactError::Unavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "contact form is not configured".to_string(),
            ),
            ContactError::CsrfValidationFailed => {
                (StatusCode::FORBIDDEN, "csrf validation failed".to_string())
            }
        };

        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}
