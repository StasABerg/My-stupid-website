use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const STATIONS_SCHEMA_VERSION: i32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Station {
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
    pub coordinates: Option<StationCoordinates>,
    pub bitrate: Option<i32>,
    pub codec: Option<String>,
    pub hls: bool,
    #[serde(rename = "isOnline")]
    pub is_online: bool,
    #[serde(rename = "lastCheckedAt")]
    pub last_checked_at: Option<String>,
    #[serde(rename = "lastChangedAt")]
    pub last_changed_at: Option<String>,
    #[serde(rename = "clickCount")]
    pub click_count: i32,
    #[serde(rename = "clickTrend")]
    pub click_trend: i32,
    pub votes: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StationCoordinates {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StationsPayload {
    pub schema_version: Option<i32>,
    pub updated_at: DateTime<Utc>,
    pub source: Option<String>,
    pub requests: Vec<String>,
    pub total: usize,
    pub stations: Vec<Station>,
    pub fingerprint: Option<String>,
}

impl StationsPayload {
    pub fn ensure_fingerprint(&mut self) -> Result<&str> {
        if self.fingerprint.is_none() {
            let fp = crate::stations::build_stations_fingerprint(&self.stations)?;
            self.fingerprint = Some(fp);
        }
        Ok(self.fingerprint.as_deref().unwrap_or("unknown"))
    }
}
