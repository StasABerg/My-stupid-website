use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;

const FAVORITES_KEY_PREFIX: &str = "radio:favorites:";
const FAVORITES_CLIENT_PREFIX: &str = "radio:favorites:client:";
const FAVORITES_STORAGE_VERSION: u32 = 2;
pub const FAVORITES_TTL_SECONDS: i64 = 60 * 60 * 24 * 30;
pub const MAX_FAVORITES: usize = 6;

#[derive(Clone)]
pub struct FavoritesStore {
    pool: PgPool,
}

impl FavoritesStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn read(&self, key: &str) -> anyhow::Result<Vec<FavoriteEntry>> {
        let payload: Option<Value> = sqlx::query_scalar(
            r#"
            SELECT payload
            FROM radio_favorites
            WHERE key = $1
              AND expires_at > NOW()
            "#,
        )
        .bind(key)
        .fetch_optional(&self.pool)
        .await?;

        Ok(match payload {
            Some(value) => dedupe_entries(normalize_entries_from_raw(&value)),
            None => vec![],
        })
    }

    pub async fn write(&self, key: &str, favorites: &[FavoriteEntry]) -> anyhow::Result<()> {
        let payload = FavoritesPayload {
            version: FAVORITES_STORAGE_VERSION,
            entries: favorites,
        };
        let serialized = serde_json::to_value(&payload)?;
        sqlx::query(
            r#"
            INSERT INTO radio_favorites (key, payload, expires_at, updated_at)
            VALUES ($1, $2, NOW() + ($3 * interval '1 second'), NOW())
            ON CONFLICT (key) DO UPDATE
              SET payload = EXCLUDED.payload,
                  expires_at = EXCLUDED.expires_at,
                  updated_at = NOW()
            "#,
        )
        .bind(key)
        .bind(serialized)
        .bind(FAVORITES_TTL_SECONDS)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn refresh_ttl(&self, key: &str) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            UPDATE radio_favorites
              SET expires_at = NOW() + ($2 * interval '1 second'),
                  updated_at = NOW()
            WHERE key = $1
              AND expires_at > NOW()
            "#,
        )
        .bind(key)
        .bind(FAVORITES_TTL_SECONDS)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FavoriteStation {
    pub id: String,
    pub name: String,
    #[serde(rename = "streamUrl")]
    pub stream_url: String,
    pub homepage: Option<String>,
    pub favicon: Option<String>,
    pub country: Option<String>,
    #[serde(rename = "countryCode")]
    pub country_code: Option<String>,
    pub state: Option<String>,
    pub languages: Vec<String>,
    pub tags: Vec<String>,
    pub bitrate: Option<i32>,
    pub codec: Option<String>,
    pub hls: bool,
    #[serde(rename = "isOnline")]
    pub is_online: bool,
    #[serde(rename = "clickCount")]
    pub click_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteEntry {
    pub id: String,
    #[serde(rename = "savedAt")]
    pub saved_at: i64,
    pub station: Option<FavoriteStation>,
}

#[derive(Serialize)]
struct FavoritesPayload<'a> {
    version: u32,
    entries: &'a [FavoriteEntry],
}

#[derive(Deserialize)]
struct LegacyEntry {
    id: Option<String>,
    #[serde(rename = "savedAt")]
    saved_at: Option<i64>,
    station: Option<FavoriteStation>,
}

fn normalize_entries_from_raw(value: &Value) -> Vec<FavoriteEntry> {
    match value {
        Value::Array(items) => items
            .iter()
            .filter_map(|item| match item {
                Value::String(id) => Some(FavoriteEntry {
                    id: id.clone(),
                    saved_at: current_timestamp(),
                    station: None,
                }),
                Value::Object(_) => serde_json::from_value::<LegacyEntry>(item.clone())
                    .ok()
                    .and_then(|entry| {
                        entry.id.map(|id| FavoriteEntry {
                            id,
                            saved_at: entry.saved_at.unwrap_or_else(current_timestamp),
                            station: entry.station,
                        })
                    }),
                _ => None,
            })
            .collect(),
        Value::Object(map) => {
            if let Some(entries) = map.get("entries") {
                return normalize_entries_from_raw(entries);
            }
            if let Some(items) = map.get("items") {
                return normalize_entries_from_raw(items);
            }
            vec![]
        }
        _ => vec![],
    }
}

fn current_timestamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn dedupe_entries(entries: Vec<FavoriteEntry>) -> Vec<FavoriteEntry> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for entry in entries {
        if let Some(id) = sanitize_station_id(&entry.id) {
            if seen.insert(id.clone()) {
                deduped.push(FavoriteEntry {
                    id,
                    saved_at: if entry.saved_at > 0 {
                        entry.saved_at
                    } else {
                        current_timestamp()
                    },
                    station: entry.station,
                });
            }
        }
        if deduped.len() >= MAX_FAVORITES {
            break;
        }
    }
    deduped
}

pub fn build_favorites_key(session_token: &str, client_session_id: Option<&str>) -> String {
    if let Some(id) = client_session_id {
        format!("{FAVORITES_CLIENT_PREFIX}{id}")
    } else {
        format!("{FAVORITES_KEY_PREFIX}{session_token}")
    }
}

pub fn sanitize_station_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.len() < 3 || trimmed.len() > 128 {
        return None;
    }
    if trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '_' | '-'))
    {
        Some(trimmed.to_string())
    } else {
        None
    }
}

pub fn is_valid_session_token(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.len() >= 16 && trimmed.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn is_valid_favorites_session(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.len() < 16 || trimmed.len() > 128 {
        return false;
    }
    trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}
