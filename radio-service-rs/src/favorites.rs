use std::collections::HashSet;

use deadpool_redis::{redis::AsyncCommands, Pool};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const FAVORITES_KEY_PREFIX: &str = "radio:favorites:";
const FAVORITES_CLIENT_PREFIX: &str = "radio:favorites:client:";
const FAVORITES_STORAGE_VERSION: u32 = 2;
pub const FAVORITES_TTL_SECONDS: usize = 60 * 60 * 24 * 30;
pub const MAX_FAVORITES: usize = 6;

#[derive(Clone)]
pub struct FavoritesStore {
    pool: Pool,
}

impl FavoritesStore {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn read(&self, key: &str) -> anyhow::Result<Vec<FavoriteEntry>> {
        let mut conn = self.pool.get().await?;
        let raw: Option<String> = conn.get(key).await?;
        if let Some(raw) = raw {
            let value: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
            Ok(dedupe_entries(normalize_entries_from_raw(&value)))
        } else {
            Ok(vec![])
        }
    }

    pub async fn write(&self, key: &str, favorites: &[FavoriteEntry]) -> anyhow::Result<()> {
        let mut conn = self.pool.get().await?;
        let payload = FavoritesPayload {
            version: FAVORITES_STORAGE_VERSION,
            entries: favorites,
        };
        let serialized = serde_json::to_string(&payload)?;
        conn.set_ex::<_, _, ()>(
            key,
            serialized,
            FAVORITES_TTL_SECONDS.try_into().unwrap_or(u64::MAX),
        )
        .await?;
        Ok(())
    }

    pub async fn refresh_ttl(&self, key: &str) -> anyhow::Result<()> {
        let mut conn = self.pool.get().await?;
        let _: () = conn
            .expire(key, FAVORITES_TTL_SECONDS.try_into().unwrap_or(i64::MAX))
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
