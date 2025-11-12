use crate::config::{Config, SessionStoreConfig};
use crate::logger::Logger;
use crate::redis_client::build_redis_client;
use anyhow::{Result, anyhow};
use hmac::{Hmac, Mac};
use http::{HeaderMap, Method, header};
use rand::{RngCore, SeedableRng, rngs::StdRng};
use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
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
    pub async fn new(config: Arc<Config>, logger: Logger) -> Result<Self> {
        let ttl = config.session.max_age;
        let mut session_secret = config.session.secret.clone();
        let store = SessionStore::new(&config.session.store, ttl).await?;
        if config.session.secret_generated
            && let Some(redis) = store.redis_handle()
        {
            if let Err(error) = synchronize_secret(redis, &mut session_secret).await {
                logger.warn(
                    "session.secret_sync_failed",
                    serde_json::json!({ "error": error.to_string() }),
                );
            } else {
                logger.info(
                    "session.secret_synchronized",
                    serde_json::json!({ "source": "redis" }),
                );
            }
        }

        let proof_secret = if config.csrf_proof_secret.is_empty() {
            session_secret.clone()
        } else {
            config.csrf_proof_secret.clone()
        };

        if config.csrf_proof_secret_generated {
            logger.warn(
                "session.csrf_proof_secret_derived",
                serde_json::json!({
                    "message": "CSRF proof secret derived from session secret; provide CSRF_PROOF_SECRET for stronger guarantees."
                }),
            );
        }

        let csrf_store = CsrfStore::new(store.redis_handle(), ttl);

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
        self.record_issued_session(&record).await;

        Ok(IssuedSession {
            session_id,
            csrf_token: nonce,
            csrf_proof,
            expires_at,
        })
    }

    async fn record_issued_session(&self, record: &SessionRecord) {
        if let Err(error) = self.csrf_store.store_record(&record.nonce, record).await {
            self.logger.warn(
                "session.csrf_store_failed",
                serde_json::json!({ "error": error.to_string() }),
            );
        }
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
            } else {
                self.logger.warn(
                    "session.csrf_proof_invalid",
                    serde_json::json!({ "proofLength": proof.len() }),
                );
            }
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
            && let Some(token) = csrf_token.as_deref()
            && let Some(csrf_record) = self.csrf_store.load_by_token(token).await
        {
            if current_millis() > csrf_record.expires_at {
                let _ = self
                    .csrf_store
                    .delete(Some(token), csrf_record.csrf_proof.as_deref())
                    .await;
            } else {
                final_nonce = Some(csrf_record.nonce.clone());
                final_expires_at = Some(csrf_record.expires_at);
                final_proof = csrf_record.csrf_proof.clone();
            }
        }

        if final_nonce.is_none()
            && let Some(proof) = csrf_proof.as_deref()
            && let Some(proof_record) = self.csrf_store.load_by_proof(proof).await
        {
            if current_millis() > proof_record.expires_at {
                let _ = self
                    .csrf_store
                    .delete(Some(&proof_record.nonce), Some(proof))
                    .await;
            } else {
                final_nonce = Some(proof_record.nonce.clone());
                final_expires_at = Some(proof_record.expires_at);
                final_proof = proof_record.csrf_proof.clone();
                if csrf_token.is_none() {
                    csrf_token = Some(proof_record.nonce);
                }
            }
        }

        let final_nonce = final_nonce.ok_or(SessionValidationError {
            status: 401,
            message: "Session required",
        })?;

        let expires = final_expires_at.ok_or(SessionValidationError {
            status: 401,
            message: "Invalid session",
        })?;

        if current_millis() > expires {
            let _ = self
                .csrf_store
                .delete(Some(&final_nonce), final_proof.as_deref())
                .await;
            return Err(SessionValidationError {
                status: 401,
                message: "Session expired",
            });
        }

        let csrf_required = method != Method::OPTIONS;
        if csrf_required
            && (csrf_token.as_deref().is_none() || csrf_token.as_deref() != Some(&final_nonce))
        {
            return Err(SessionValidationError {
                status: 403,
                message: "Missing or invalid CSRF token",
            });
        }

        record.nonce = final_nonce.clone();
        record.expires_at = current_millis() + self.ttl.as_millis() as i64;
        record.csrf_proof = final_proof
            .clone()
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
        self.record_issued_session(record).await;
        Ok(())
    }
}

fn current_millis() -> i64 {
    (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0)))
    .as_millis() as i64
}

fn random_hex(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    let mut rng = StdRng::from_os_rng();
    rng.fill_bytes(&mut buffer);
    hex::encode(buffer)
}

fn header_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn query_param(uri: &http::Uri, key: &str) -> Option<String> {
    let query = uri.query()?;
    form_urlencoded::parse(query.as_bytes())
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.into_owned())
        .filter(|value| !value.is_empty())
}

fn build_csrf_proof(secret: &str, nonce: &str, expires_at: i64) -> Option<String> {
    if secret.is_empty() || nonce.is_empty() {
        return None;
    }
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

async fn synchronize_secret(redis: &RedisHandle, session_secret: &mut String) -> Result<()> {
    let mut conn = redis.manager.clone();
    let key = format!("{}__secret", redis.key_prefix);
    let _: () = redis::cmd("SETNX")
        .arg(&key)
        .arg(session_secret.as_str())
        .query_async(&mut conn)
        .await
        .map_err(|e| anyhow!(e.to_string()))?;
    if let Ok(shared) = conn.get::<_, String>(&key).await
        && !shared.is_empty()
    {
        *session_secret = shared;
    }
    Ok(())
}

#[derive(Clone)]
struct SessionStore {
    backend: SessionBackend,
    ttl: Duration,
    key_prefix: String,
    redis_handle: Option<RedisHandle>,
}

impl SessionStore {
    async fn new(config: &SessionStoreConfig, ttl: Duration) -> Result<Self> {
        match config {
            SessionStoreConfig::Memory => Ok(Self {
                backend: SessionBackend::Memory(Arc::new(MemoryStore::default())),
                ttl,
                key_prefix: "gateway:session:".into(),
                redis_handle: None,
            }),
            SessionStoreConfig::Redis(redis_cfg) => {
                let client = build_redis_client(&redis_cfg.url, redis_cfg.tls_reject_unauthorized)?;
                let manager = ConnectionManager::new(client).await?;
                let handle = RedisHandle {
                    manager: manager.clone(),
                    key_prefix: redis_cfg.key_prefix.clone(),
                };
                Ok(Self {
                    backend: SessionBackend::Redis(Arc::new(RedisStore { manager })),
                    ttl,
                    key_prefix: redis_cfg.key_prefix.clone(),
                    redis_handle: Some(handle),
                })
            }
        }
    }

    fn redis_handle(&self) -> Option<&RedisHandle> {
        self.redis_handle.as_ref()
    }

    fn redis_key(&self, session_id: &str) -> String {
        format!("{}{}", self.key_prefix, session_id)
    }

    async fn get(&self, session_id: &str) -> Result<Option<SessionRecord>> {
        match &self.backend {
            SessionBackend::Memory(store) => store.get(session_id).await,
            SessionBackend::Redis(store) => store.get(&self.redis_key(session_id)).await,
        }
    }

    async fn set(&self, session_id: &str, record: &SessionRecord) -> Result<()> {
        match &self.backend {
            SessionBackend::Memory(store) => store.set(session_id, record.clone(), self.ttl).await,
            SessionBackend::Redis(store) => {
                store
                    .set(&self.redis_key(session_id), record, self.ttl)
                    .await
            }
        }
    }
}

#[derive(Clone)]
struct RedisHandle {
    manager: ConnectionManager,
    key_prefix: String,
}

#[derive(Clone)]
enum SessionBackend {
    Memory(Arc<MemoryStore>),
    Redis(Arc<RedisStore>),
}

#[derive(Clone, Serialize, Deserialize)]
struct SessionRecord {
    nonce: String,
    expires_at: i64,
    csrf_proof: Option<String>,
}

#[derive(Default)]
struct MemoryStore {
    entries: Mutex<HashMap<String, MemoryEntry>>,
}

struct MemoryEntry {
    record: SessionRecord,
    expires_at: Instant,
}

impl MemoryStore {
    async fn get(&self, session_id: &str) -> Result<Option<SessionRecord>> {
        let mut guard = self.entries.lock().await;
        if let Some(entry) = guard.get(session_id)
            && Instant::now() < entry.expires_at
        {
            return Ok(Some(entry.record.clone()));
        }
        guard.remove(session_id);
        Ok(None)
    }

    async fn set(&self, session_id: &str, record: SessionRecord, ttl: Duration) -> Result<()> {
        let mut guard = self.entries.lock().await;
        guard.insert(
            session_id.to_string(),
            MemoryEntry {
                record,
                expires_at: Instant::now() + ttl,
            },
        );
        Ok(())
    }
}

struct RedisStore {
    manager: ConnectionManager,
}

impl RedisStore {
    async fn get(&self, key: &str) -> Result<Option<SessionRecord>> {
        let mut conn = self.manager.clone();
        let raw: Option<String> = conn.get(key).await?;
        if let Some(value) = raw {
            let record = serde_json::from_str(&value)?;
            Ok(Some(record))
        } else {
            Ok(None)
        }
    }

    async fn set(&self, key: &str, record: &SessionRecord, ttl: Duration) -> Result<()> {
        let mut conn = self.manager.clone();
        let payload = serde_json::to_string(record)?;
        let seconds = ttl.as_secs().max(1);
        conn.set_ex::<_, _, ()>(key, payload, seconds).await?;
        Ok(())
    }
}

enum CsrfStore {
    Redis(Arc<RedisCsrfStore>),
    Memory(Arc<MemoryCsrfStore>),
}

impl Clone for CsrfStore {
    fn clone(&self) -> Self {
        match self {
            CsrfStore::Redis(store) => CsrfStore::Redis(store.clone()),
            CsrfStore::Memory(store) => CsrfStore::Memory(store.clone()),
        }
    }
}

impl CsrfStore {
    fn new(handle: Option<&RedisHandle>, ttl: Duration) -> Self {
        if let Some(redis) = handle {
            CsrfStore::Redis(Arc::new(RedisCsrfStore::new(redis, ttl)))
        } else {
            CsrfStore::Memory(Arc::new(MemoryCsrfStore::new(ttl)))
        }
    }

    async fn store_record(&self, token: &str, record: &SessionRecord) -> Result<()> {
        let stored = StoredCsrfRecord {
            nonce: record.nonce.clone(),
            expires_at: record.expires_at,
            csrf_proof: record.csrf_proof.clone(),
        };
        match self {
            CsrfStore::Redis(store) => store.store(token, &stored).await,
            CsrfStore::Memory(store) => store.store(token, stored).await,
        }
    }

    async fn load_by_token(&self, token: &str) -> Option<StoredCsrfRecord> {
        match self {
            CsrfStore::Redis(store) => store.load_by_token(token).await,
            CsrfStore::Memory(store) => store.load_by_token(token).await,
        }
    }

    async fn load_by_proof(&self, proof: &str) -> Option<StoredCsrfRecord> {
        match self {
            CsrfStore::Redis(store) => store.load_by_proof(proof).await,
            CsrfStore::Memory(store) => store.load_by_proof(proof).await,
        }
    }

    async fn delete(&self, token: Option<&str>, proof: Option<&str>) -> Result<()> {
        match self {
            CsrfStore::Redis(store) => store.delete(token, proof).await,
            CsrfStore::Memory(store) => store.delete(token, proof).await,
        }
    }
}

struct RedisCsrfStore {
    manager: ConnectionManager,
    session_key_prefix: String,
    proof_key_prefix: String,
    ttl_seconds: u64,
}

impl RedisCsrfStore {
    fn new(handle: &RedisHandle, ttl: Duration) -> Self {
        Self {
            manager: handle.manager.clone(),
            session_key_prefix: format!("{}nonce:", handle.key_prefix),
            proof_key_prefix: format!("{}proof:", handle.key_prefix),
            ttl_seconds: ttl.as_secs().max(1),
        }
    }

    fn session_key(&self, token: &str) -> String {
        format!("{}{}", self.session_key_prefix, token)
    }

    fn proof_key(&self, proof: &str) -> String {
        format!("{}{}", self.proof_key_prefix, proof)
    }

    async fn store(&self, token: &str, record: &StoredCsrfRecord) -> Result<()> {
        let mut conn = self.manager.clone();
        let payload = serde_json::to_string(record)?;
        conn.set_ex::<_, _, ()>(&self.session_key(token), payload.clone(), self.ttl_seconds)
            .await?;
        if let Some(proof) = &record.csrf_proof {
            conn.set_ex::<_, _, ()>(&self.proof_key(proof), payload, self.ttl_seconds)
                .await?;
        }
        Ok(())
    }

    async fn load_by_token(&self, token: &str) -> Option<StoredCsrfRecord> {
        let mut conn = self.manager.clone();
        let raw: Option<String> = conn.get(self.session_key(token)).await.ok()?;
        raw.and_then(|value| serde_json::from_str(&value).ok())
    }

    async fn load_by_proof(&self, proof: &str) -> Option<StoredCsrfRecord> {
        let mut conn = self.manager.clone();
        let raw: Option<String> = conn.get(self.proof_key(proof)).await.ok()?;
        raw.and_then(|value| serde_json::from_str(&value).ok())
    }

    async fn delete(&self, token: Option<&str>, proof: Option<&str>) -> Result<()> {
        if token.is_none() && proof.is_none() {
            return Ok(());
        }
        let mut conn = self.manager.clone();
        let mut keys = Vec::new();
        if let Some(token) = token {
            keys.push(self.session_key(token));
        }
        if let Some(proof) = proof {
            keys.push(self.proof_key(proof));
        }
        if !keys.is_empty() {
            let _: () = redis::cmd("DEL").arg(keys).query_async(&mut conn).await?;
        }
        Ok(())
    }
}

struct MemoryCsrfStore {
    sessions: Mutex<HashMap<String, StoredCsrfRecord>>,
    proofs: Mutex<HashMap<String, StoredCsrfRecord>>,
}

impl MemoryCsrfStore {
    fn new(_ttl: Duration) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            proofs: Mutex::new(HashMap::new()),
        }
    }

    async fn store(&self, token: &str, record: StoredCsrfRecord) -> Result<()> {
        let mut sessions = self.sessions.lock().await;
        sessions.insert(token.to_string(), record.clone());
        drop(sessions);
        if let Some(proof) = &record.csrf_proof {
            let mut proofs = self.proofs.lock().await;
            proofs.insert(proof.clone(), record.clone());
        }
        // Lazy expiration handled during lookup/delete.
        Ok(())
    }

    async fn load_by_token(&self, token: &str) -> Option<StoredCsrfRecord> {
        let mut sessions = self.sessions.lock().await;
        if let Some(record) = sessions.get(token).cloned() {
            if current_millis() > record.expires_at {
                sessions.remove(token);
                if let Some(proof) = &record.csrf_proof {
                    self.proofs.lock().await.remove(proof);
                }
                None
            } else {
                Some(record)
            }
        } else {
            None
        }
    }

    async fn load_by_proof(&self, proof: &str) -> Option<StoredCsrfRecord> {
        let mut proofs = self.proofs.lock().await;
        if let Some(record) = proofs.get(proof).cloned() {
            if current_millis() > record.expires_at {
                proofs.remove(proof);
                self.sessions.lock().await.remove(&record.nonce);
                None
            } else {
                Some(record)
            }
        } else {
            None
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
struct StoredCsrfRecord {
    nonce: String,
    expires_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    csrf_proof: Option<String>,
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
