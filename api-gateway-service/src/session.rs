use crate::config::Config;
use crate::logger::Logger;
use anyhow::{Result, anyhow};
use hmac::{Hmac, Mac};
use http::{HeaderMap, Method, header};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time;
use url::form_urlencoded;

type HmacSha256 = Hmac<Sha256>;
const CSRF_PROOF_VERSION: u8 = 1;

#[derive(Clone)]
pub struct SessionManager {
    cookie_name: String,
    ttl: Duration,
    proof_secret: String,
    store: SessionStore,
    csrf_store: CsrfStore,
    logger: Logger,
}

#[derive(Clone, Debug)]
pub struct SessionSnapshot {
    pub session_id: String,
    pub nonce: String,
    pub csrf_proof: String,
    pub expires_at: i64,
}

#[derive(Clone, Debug)]
pub struct IssuedSession {
    pub session_id: String,
    pub csrf_token: String,
    pub csrf_proof: String,
    pub expires_at: i64,
}

#[derive(Debug)]
pub struct SessionValidationError {
    pub status: u16,
    pub message: &'static str,
}

impl SessionManager {
    pub async fn new(config: Arc<Config>, logger: Logger, postgres: PgPool) -> Result<Self> {
        let ttl = config.session.max_age;
        let session_secret = config.session.secret.clone();
        let proof_secret = if config.csrf_proof_secret.is_empty() {
            session_secret
        } else {
            config.csrf_proof_secret.clone()
        };

        let (store, csrf_store) = if config.app_env.eq_ignore_ascii_case("test") {
            (SessionStore::memory(), CsrfStore::memory())
        } else {
            (
                SessionStore::postgres(postgres.clone()),
                CsrfStore::postgres(postgres.clone()),
            )
        };

        if !config.app_env.eq_ignore_ascii_case("test") {
            spawn_cleanup(postgres, logger.clone());
        }

        Ok(Self {
            cookie_name: config.session.cookie_name.clone(),
            ttl,
            proof_secret,
            store,
            csrf_store,
            logger,
        })
    }

    pub fn cookie_name(&self) -> &str {
        &self.cookie_name
    }

    pub async fn issue_session(&self) -> Result<IssuedSession> {
        let session_id = random_hex(16);
        let nonce = random_hex(16);
        let expires_at = current_millis() + self.ttl.as_millis() as i64;
        let csrf_proof = build_csrf_proof(&self.proof_secret, &nonce, expires_at)
            .ok_or_else(|| anyhow!("failed to build csrf proof"))?;

        let record = SessionRecord {
            nonce: nonce.clone(),
            expires_at,
            csrf_proof: Some(csrf_proof.clone()),
        };

        self.store.set(&session_id, &record).await?;
        self.csrf_store.store_record(&record.nonce, &record).await?;

        Ok(IssuedSession {
            session_id,
            csrf_token: nonce,
            csrf_proof,
            expires_at,
        })
    }

    pub async fn validate_session(
        &self,
        headers: &HeaderMap,
        method: &Method,
        uri: Option<&http::Uri>,
    ) -> Result<SessionSnapshot, SessionValidationError> {
        let session_cookie =
            extract_cookie(headers, &self.cookie_name).ok_or(SessionValidationError {
                status: 401,
                message: "Session required",
            })?;

        let mut record = self
            .store
            .get(&session_cookie)
            .await
            .map_err(|_| SessionValidationError {
                status: 500,
                message: "Session store unavailable",
            })?
            .ok_or(SessionValidationError {
                status: 401,
                message: "Session expired",
            })?;

        let mut csrf_token = header_value(headers, "x-gateway-csrf");
        let mut csrf_proof = header_value(headers, "x-gateway-csrf-proof");

        if csrf_token.is_none() {
            csrf_token = uri.and_then(|value| query_param(value, "csrfToken"));
        }
        if csrf_proof.is_none() {
            csrf_proof = uri.and_then(|value| query_param(value, "csrfProof"));
        }

        if let Some(proof) = csrf_proof.clone() {
            if let Some(verified) = verify_csrf_proof(&self.proof_secret, &proof) {
                if let Some(token) = csrf_token.as_ref()
                    && token != &verified.nonce
                {
                    return Err(SessionValidationError {
                        status: 403,
                        message: "Missing or invalid CSRF token",
                    });
                }

                record.nonce = verified.nonce.clone();
                record.expires_at = current_millis() + self.ttl.as_millis() as i64;
                record.csrf_proof =
                    build_csrf_proof(&self.proof_secret, &record.nonce, record.expires_at);

                self.persist_session(&session_cookie, &record)
                    .await
                    .map_err(|_| SessionValidationError {
                        status: 500,
                        message: "Session store unavailable",
                    })?;

                return Ok(SessionSnapshot {
                    session_id: session_cookie,
                    nonce: record.nonce.clone(),
                    csrf_proof: record.csrf_proof.clone().unwrap_or_default(),
                    expires_at: record.expires_at,
                });
            }

            self.logger.warn(
                "session.csrf_proof_invalid",
                serde_json::json!({ "proofLength": proof.len() }),
            );
        }

        let mut final_nonce = if record.nonce.is_empty() {
            None
        } else {
            Some(record.nonce.clone())
        };
        let mut final_expires_at = if record.expires_at > 0 {
            Some(record.expires_at)
        } else {
            None
        };
        let mut final_proof = record.csrf_proof.clone();

        if final_nonce.is_none()
            && let Some(token) = csrf_token.as_ref()
            && let Some(csrf_record) = self.csrf_store.load_by_token(token).await
        {
            if current_millis() > csrf_record.expires_at {
                self.csrf_store
                    .delete(Some(token), csrf_record.csrf_proof.as_deref())
                    .await
                    .ok();
            } else {
                final_nonce = Some(csrf_record.nonce.clone());
                final_proof = csrf_record.csrf_proof.clone();
                final_expires_at = Some(csrf_record.expires_at);
            }
        }

        if final_nonce.is_none()
            && let Some(proof) = csrf_proof.as_ref()
            && let Some(proof_record) = self.csrf_store.load_by_proof(proof).await
        {
            if current_millis() > proof_record.expires_at {
                self.csrf_store.delete(None, Some(proof)).await.ok();
            } else {
                final_nonce = Some(proof_record.nonce.clone());
                final_proof = proof_record.csrf_proof.clone();
                final_expires_at = Some(proof_record.expires_at);
            }
        }

        let expires = final_expires_at.ok_or(SessionValidationError {
            status: 401,
            message: "Session expired",
        })?;
        if current_millis() > expires {
            self.store.delete(&session_cookie).await.ok();
            self.csrf_store
                .delete(final_nonce.as_deref(), final_proof.as_deref())
                .await
                .ok();
            return Err(SessionValidationError {
                status: 401,
                message: "Session expired",
            });
        }

        let csrf_required = !matches!(method, &Method::GET | &Method::HEAD | &Method::OPTIONS);
        if csrf_required {
            let token = csrf_token.ok_or(SessionValidationError {
                status: 403,
                message: "Missing or invalid CSRF token",
            })?;
            let proof = csrf_proof.ok_or(SessionValidationError {
                status: 403,
                message: "Missing or invalid CSRF proof",
            })?;

            let nonce = final_nonce.clone().ok_or(SessionValidationError {
                status: 403,
                message: "Missing or invalid CSRF token",
            })?;

            if token != nonce {
                return Err(SessionValidationError {
                    status: 403,
                    message: "Missing or invalid CSRF token",
                });
            }

            if let Some(verified) = verify_csrf_proof(&self.proof_secret, &proof) {
                if verified.nonce != nonce {
                    return Err(SessionValidationError {
                        status: 403,
                        message: "Missing or invalid CSRF proof",
                    });
                }
            } else {
                return Err(SessionValidationError {
                    status: 403,
                    message: "Missing or invalid CSRF proof",
                });
            }
        }

        record.nonce = final_nonce.unwrap_or_else(|| record.nonce.clone());
        record.expires_at = current_millis() + self.ttl.as_millis() as i64;
        record.csrf_proof = final_proof
            .or_else(|| build_csrf_proof(&self.proof_secret, &record.nonce, record.expires_at));

        self.persist_session(&session_cookie, &record)
            .await
            .map_err(|_| SessionValidationError {
                status: 500,
                message: "Session store unavailable",
            })?;

        Ok(SessionSnapshot {
            session_id: session_cookie,
            nonce: record.nonce.clone(),
            csrf_proof: record.csrf_proof.clone().unwrap_or_default(),
            expires_at: record.expires_at,
        })
    }

    async fn persist_session(&self, session_id: &str, record: &SessionRecord) -> Result<()> {
        self.store.set(session_id, record).await?;
        self.csrf_store.store_record(&record.nonce, record).await?;
        Ok(())
    }
}

fn spawn_cleanup(pool: PgPool, logger: Logger) {
    tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(60 * 10));
        loop {
            interval.tick().await;
            for table in ["gateway_sessions", "gateway_csrf"] {
                let query = format!(
                    "WITH doomed AS (SELECT ctid FROM {table} WHERE expires_at <= NOW() LIMIT 5000) DELETE FROM {table} WHERE ctid IN (SELECT ctid FROM doomed)"
                );
                if let Err(error) = sqlx::query(&query).execute(&pool).await {
                    logger.warn(
                        "session.cleanup_failed",
                        serde_json::json!({ "table": table, "error": error.to_string() }),
                    );
                }
            }
        }
    });
}

#[derive(Clone)]
enum SessionStore {
    Postgres(PgPool),
    Memory(Arc<MemorySessionStore>),
}

impl SessionStore {
    fn postgres(pool: PgPool) -> Self {
        Self::Postgres(pool)
    }

    fn memory() -> Self {
        Self::Memory(Arc::new(MemorySessionStore::default()))
    }

    async fn get(&self, session_id: &str) -> Result<Option<SessionRecord>> {
        match self {
            SessionStore::Postgres(pool) => {
                let record: Option<sqlx::types::Json<SessionRecord>> = sqlx::query_scalar(
                    r#"
                    SELECT record
                    FROM gateway_sessions
                    WHERE session_id = $1
                      AND expires_at > NOW()
                    "#,
                )
                .bind(session_id)
                .fetch_optional(pool)
                .await?;
                Ok(record.map(|json| json.0))
            }
            SessionStore::Memory(store) => store.get(session_id).await,
        }
    }

    async fn set(&self, session_id: &str, record: &SessionRecord) -> Result<()> {
        match self {
            SessionStore::Postgres(pool) => {
                sqlx::query(
                    r#"
                    INSERT INTO gateway_sessions (session_id, record, expires_at, updated_at)
                    VALUES ($1, $2, to_timestamp($3::double precision / 1000.0), NOW())
                    ON CONFLICT (session_id) DO UPDATE
                      SET record = EXCLUDED.record,
                          expires_at = EXCLUDED.expires_at,
                          updated_at = NOW()
                    "#,
                )
                .bind(session_id)
                .bind(serde_json::to_value(record)?)
                .bind(record.expires_at)
                .execute(pool)
                .await?;
                Ok(())
            }
            SessionStore::Memory(store) => store.set(session_id, record).await,
        }
    }

    async fn delete(&self, session_id: &str) -> Result<()> {
        match self {
            SessionStore::Postgres(pool) => {
                sqlx::query("DELETE FROM gateway_sessions WHERE session_id = $1")
                    .bind(session_id)
                    .execute(pool)
                    .await?;
                Ok(())
            }
            SessionStore::Memory(store) => store.delete(session_id).await,
        }
    }
}

#[derive(Default)]
struct MemorySessionStore {
    entries: Mutex<HashMap<String, SessionRecord>>,
}

impl MemorySessionStore {
    async fn get(&self, session_id: &str) -> Result<Option<SessionRecord>> {
        let mut entries = self.entries.lock().await;
        if let Some(record) = entries.get(session_id).cloned() {
            if current_millis() > record.expires_at {
                entries.remove(session_id);
                return Ok(None);
            }
            return Ok(Some(record));
        }
        Ok(None)
    }

    async fn set(&self, session_id: &str, record: &SessionRecord) -> Result<()> {
        let mut entries = self.entries.lock().await;
        entries.insert(session_id.to_string(), record.clone());
        Ok(())
    }

    async fn delete(&self, session_id: &str) -> Result<()> {
        let mut entries = self.entries.lock().await;
        entries.remove(session_id);
        Ok(())
    }
}

#[derive(Clone)]
enum CsrfStore {
    Postgres(PgPool),
    Memory(Arc<MemoryCsrfStore>),
}

impl CsrfStore {
    fn postgres(pool: PgPool) -> Self {
        Self::Postgres(pool)
    }

    fn memory() -> Self {
        Self::Memory(Arc::new(MemoryCsrfStore::default()))
    }

    async fn store_record(&self, token: &str, record: &SessionRecord) -> Result<()> {
        let stored = StoredCsrfRecord {
            nonce: record.nonce.clone(),
            expires_at: record.expires_at,
            csrf_proof: record.csrf_proof.clone(),
        };

        match self {
            CsrfStore::Postgres(pool) => {
                sqlx::query(
                    r#"
                    INSERT INTO gateway_csrf (csrf_token, csrf_proof, record, expires_at, updated_at)
                    VALUES ($1, $2, $3, to_timestamp($4::double precision / 1000.0), NOW())
                    ON CONFLICT (csrf_token) DO UPDATE
                      SET csrf_proof = EXCLUDED.csrf_proof,
                          record = EXCLUDED.record,
                          expires_at = EXCLUDED.expires_at,
                          updated_at = NOW()
                    "#,
                )
                .bind(token)
                .bind(stored.csrf_proof.clone())
                .bind(serde_json::to_value(&stored)?)
                .bind(stored.expires_at)
                .execute(pool)
                .await?;
                Ok(())
            }
            CsrfStore::Memory(store) => store.store(token, stored).await,
        }
    }

    async fn load_by_token(&self, token: &str) -> Option<StoredCsrfRecord> {
        match self {
            CsrfStore::Postgres(pool) => {
                let record: Option<sqlx::types::Json<StoredCsrfRecord>> = sqlx::query_scalar(
                    r#"
                    SELECT record
                    FROM gateway_csrf
                    WHERE csrf_token = $1
                      AND expires_at > NOW()
                    "#,
                )
                .bind(token)
                .fetch_optional(pool)
                .await
                .ok()?;
                record.map(|json| json.0)
            }
            CsrfStore::Memory(store) => store.load_by_token(token).await,
        }
    }

    async fn load_by_proof(&self, proof: &str) -> Option<StoredCsrfRecord> {
        match self {
            CsrfStore::Postgres(pool) => {
                let record: Option<sqlx::types::Json<StoredCsrfRecord>> = sqlx::query_scalar(
                    r#"
                    SELECT record
                    FROM gateway_csrf
                    WHERE csrf_proof = $1
                      AND expires_at > NOW()
                    "#,
                )
                .bind(proof)
                .fetch_optional(pool)
                .await
                .ok()?;
                record.map(|json| json.0)
            }
            CsrfStore::Memory(store) => store.load_by_proof(proof).await,
        }
    }

    async fn delete(&self, token: Option<&str>, proof: Option<&str>) -> Result<()> {
        match self {
            CsrfStore::Postgres(pool) => {
                if let Some(token) = token {
                    sqlx::query("DELETE FROM gateway_csrf WHERE csrf_token = $1")
                        .bind(token)
                        .execute(pool)
                        .await?;
                }
                if let Some(proof) = proof {
                    sqlx::query("DELETE FROM gateway_csrf WHERE csrf_proof = $1")
                        .bind(proof)
                        .execute(pool)
                        .await?;
                }
                Ok(())
            }
            CsrfStore::Memory(store) => store.delete(token, proof).await,
        }
    }
}

#[derive(Default)]
struct MemoryCsrfStore {
    sessions: Mutex<HashMap<String, StoredCsrfRecord>>,
    proofs: Mutex<HashMap<String, StoredCsrfRecord>>,
}

impl MemoryCsrfStore {
    async fn store(&self, token: &str, record: StoredCsrfRecord) -> Result<()> {
        let mut sessions = self.sessions.lock().await;
        sessions.insert(token.to_string(), record.clone());
        drop(sessions);

        if let Some(proof) = &record.csrf_proof {
            let mut proofs = self.proofs.lock().await;
            proofs.insert(proof.clone(), record);
        }
        Ok(())
    }

    async fn load_by_token(&self, token: &str) -> Option<StoredCsrfRecord> {
        let mut sessions = self.sessions.lock().await;
        let record = sessions.get(token).cloned()?;
        if current_millis() > record.expires_at {
            sessions.remove(token);
            if let Some(proof) = &record.csrf_proof {
                self.proofs.lock().await.remove(proof);
            }
            None
        } else {
            Some(record)
        }
    }

    async fn load_by_proof(&self, proof: &str) -> Option<StoredCsrfRecord> {
        let mut proofs = self.proofs.lock().await;
        let record = proofs.get(proof).cloned()?;
        if current_millis() > record.expires_at {
            proofs.remove(proof);
            self.sessions.lock().await.remove(&record.nonce);
            None
        } else {
            Some(record)
        }
    }

    async fn delete(&self, token: Option<&str>, proof: Option<&str>) -> Result<()> {
        if let Some(token) = token {
            self.sessions.lock().await.remove(token);
        }
        if let Some(proof) = proof {
            self.proofs.lock().await.remove(proof);
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct SessionRecord {
    nonce: String,
    expires_at: i64,
    csrf_proof: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct StoredCsrfRecord {
    nonce: String,
    expires_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    csrf_proof: Option<String>,
}

fn current_millis() -> i64 {
    use std::time::SystemTime;
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn random_hex(bytes: usize) -> String {
    let mut rng = rand::rng();
    let mut buf = vec![0u8; bytes];
    rng.fill_bytes(&mut buf);
    hex::encode(buf)
}

fn header_value(headers: &HeaderMap, key: &str) -> Option<String> {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn query_param(uri: &http::Uri, key: &str) -> Option<String> {
    let query = uri.query()?;
    form_urlencoded::parse(query.as_bytes())
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.to_string())
}

fn build_csrf_proof(secret: &str, nonce: &str, expires_at: i64) -> Option<String> {
    let expires_segment = if expires_at > 0 {
        format!("{:x}", expires_at)
    } else {
        "0".to_string()
    };
    let payload = format!("{}:{}", nonce, expires_segment);
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(payload.as_bytes());
    let signature = mac.finalize().into_bytes();
    Some(format!(
        "v{CSRF_PROOF_VERSION}.{}.{}.{}",
        expires_segment,
        nonce,
        hex::encode(signature)
    ))
}

fn verify_csrf_proof(secret: &str, proof: &str) -> Option<StoredCsrfRecord> {
    let mut parts = proof.split('.');
    let version = parts.next()?;
    if version != format!("v{CSRF_PROOF_VERSION}") {
        return None;
    }
    let expires_segment = parts.next()?;
    let nonce = parts.next()?.to_string();
    let signature = parts.next()?;
    let expires_at = i64::from_str_radix(expires_segment, 16).ok()?;
    let payload = format!("{}:{}", nonce, expires_segment);
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(payload.as_bytes());
    let expected = mac.finalize().into_bytes();
    let provided = hex::decode(signature).ok()?;
    if expected.len() != provided.len() {
        return None;
    }
    if !expected.iter().zip(provided.iter()).all(|(a, b)| a == b) {
        return None;
    }
    Some(StoredCsrfRecord {
        nonce,
        expires_at,
        csrf_proof: Some(proof.to_string()),
    })
}

fn extract_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';')
        .map(|segment| segment.trim())
        .find_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let key = parts.next()?.trim();
            if key != name {
                return None;
            }
            let value = parts.next()?.trim();
            if value.is_empty() {
                None
            } else {
                Some(value.to_string())
            }
        })
}
