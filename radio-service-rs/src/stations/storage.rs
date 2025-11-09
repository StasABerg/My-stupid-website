use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{
    postgres::{PgRow, Postgres},
    PgPool, QueryBuilder, Row, Transaction,
};
use thiserror::Error;

use super::{build_stations_fingerprint, Station, StationCoordinates, StationsPayload};

#[derive(Debug, Error)]
pub enum StorageError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("{0}")]
    InvalidData(String),
}

#[derive(Debug)]
pub struct PersistOutcome {
    pub payload_id: i64,
    pub changed: bool,
}

#[derive(Clone)]
pub struct StationStorage {
    pool: PgPool,
}

impl StationStorage {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn load_latest_payload(&self) -> Result<Option<StationsPayload>, StorageError> {
        let row = sqlx::query(
            r#"
            SELECT sp.id,
                   sp.schema_version,
                   sp.updated_at,
                   sp.source,
                   sp.requests,
                   sp.total,
                   sp.fingerprint
            FROM station_state ss
            JOIN station_payloads sp ON sp.id = ss.payload_id
            LIMIT 1
            "#,
        )
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };

        let payload_id: i64 = row.try_get("id")?;
        let requests = json_array_to_vec(row.try_get::<Value, _>("requests")?);
        let total: i64 = row.try_get("total")?;
        let updated_at: DateTime<Utc> = row.try_get("updated_at")?;

        let schema_version_raw: Option<String> =
            row.try_get::<Option<String>, _>("schema_version")?;
        let mut payload = StationsPayload {
            schema_version: parse_schema_version(schema_version_raw),
            updated_at,
            source: row.try_get::<Option<String>, _>("source")?,
            requests,
            total: total.try_into().unwrap_or_default(),
            stations: vec![],
            fingerprint: row.try_get::<Option<String>, _>("fingerprint")?,
        };

        let station_rows = sqlx::query(
            r#"
            SELECT id,
                   name,
                   stream_url,
                   homepage,
                   favicon,
                   country,
                   country_code,
                   state,
                   languages,
                   tags,
                   coordinates,
                   bitrate,
                   codec,
                   hls,
                   is_online,
                   last_checked_at,
                   last_changed_at,
                   click_count,
                   click_trend,
                   votes
            FROM stations
            WHERE payload_id = $1
            ORDER BY name ASC
            "#,
        )
        .bind(payload_id)
        .fetch_all(&self.pool)
        .await?;

        let mut stations = Vec::with_capacity(station_rows.len());
        for row in station_rows {
            stations.push(row_to_station(row)?);
        }
        payload.stations = stations;
        payload.ensure_fingerprint();

        Ok(Some(payload))
    }

    pub async fn persist_payload(
        &self,
        payload: &StationsPayload,
    ) -> Result<PersistOutcome, StorageError> {
        let mut tx = self.pool.begin().await?;

        let fingerprint = payload
            .fingerprint
            .clone()
            .unwrap_or_else(|| build_stations_fingerprint(&payload.stations));

        if let Some(existing) = sqlx::query(
            r#"
            SELECT ss.payload_id, sp.fingerprint
            FROM station_state ss
            LEFT JOIN station_payloads sp ON sp.id = ss.payload_id
            FOR UPDATE OF ss
            "#,
        )
        .fetch_optional(&mut *tx)
        .await?
        {
            let existing_fingerprint: Option<String> = existing.try_get("fingerprint")?;
            if Some(fingerprint.clone()) == existing_fingerprint {
                sqlx::query("UPDATE station_state SET updated_at = NOW() WHERE id = TRUE")
                    .execute(&mut *tx)
                    .await?;
                tx.commit().await?;
                let payload_id: Option<i64> = existing.try_get("payload_id").ok();
                return Ok(PersistOutcome {
                    payload_id: payload_id.unwrap_or_default(),
                    changed: false,
                });
            }
        }

        let req_json = serde_json::to_value(&payload.requests).unwrap_or(Value::Null);
        let schema_version = payload.schema_version.map(|value| value.to_string());
        let inserted = sqlx::query(
            r#"
            INSERT INTO station_payloads (schema_version, updated_at, source, requests, total, fingerprint)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
            "#,
        )
        .bind(&schema_version)
        .bind(payload.updated_at)
        .bind(&payload.source)
        .bind(req_json)
        .bind(i64::try_from(payload.total).unwrap_or(payload.total as i64))
        .bind(&fingerprint)
        .fetch_one(&mut *tx)
        .await?;

        let payload_id: i64 = inserted.try_get("id")?;
        self.insert_stations(&mut tx, payload_id, &payload.stations)
            .await?;

        sqlx::query(
            r#"
            INSERT INTO station_state (id, payload_id, updated_at)
            VALUES (TRUE, $1, NOW())
            ON CONFLICT (id) DO UPDATE SET payload_id = EXCLUDED.payload_id, updated_at = NOW()
            "#,
        )
        .bind(payload_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query("DELETE FROM station_payloads WHERE id <> $1")
            .bind(payload_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;

        Ok(PersistOutcome {
            payload_id,
            changed: true,
        })
    }

    async fn insert_stations(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        payload_id: i64,
        stations: &[Station],
    ) -> Result<(), StorageError> {
        if stations.is_empty() {
            return Ok(());
        }

        const COLUMNS: &str = r#"(id, payload_id, name, stream_url, homepage, favicon, country, country_code, state, languages, tags, coordinates, bitrate, codec, hls, is_online, last_checked_at, last_changed_at, click_count, click_trend, votes)"#;
        const INSERT_BATCH_SIZE: usize = 500;

        for chunk in stations.chunks(INSERT_BATCH_SIZE) {
            let mut builder = QueryBuilder::<Postgres>::new("INSERT INTO stations ");
            builder.push(COLUMNS);
            builder.push(" VALUES ");
            builder.push_values(chunk, |mut b, station| {
                b.push_bind(&station.id);
                b.push_bind(payload_id);
                b.push_bind(&station.name);
                b.push_bind(&station.stream_url);
                b.push_bind(&station.homepage);
                b.push_bind(&station.favicon);
                b.push_bind(&station.country);
                b.push_bind(&station.country_code);
                b.push_bind(&station.state);
                b.push_bind(&station.languages);
                b.push_bind(&station.tags);
                let coords = station
                    .coordinates
                    .as_ref()
                    .and_then(|value| serde_json::to_value(value).ok());
                b.push_bind(coords);
                b.push_bind(station.bitrate);
                b.push_bind(&station.codec);
                b.push_bind(station.hls);
                b.push_bind(station.is_online);
                b.push_bind(&station.last_checked_at);
                b.push_bind(&station.last_changed_at);
                b.push_bind(station.click_count);
                b.push_bind(station.click_trend);
                b.push_bind(station.votes);
            });

            builder.push(
                " ON CONFLICT (id) DO UPDATE SET
                payload_id = EXCLUDED.payload_id,
                name = EXCLUDED.name,
                stream_url = EXCLUDED.stream_url,
                homepage = EXCLUDED.homepage,
                favicon = EXCLUDED.favicon,
                country = EXCLUDED.country,
                country_code = EXCLUDED.country_code,
                state = EXCLUDED.state,
                languages = EXCLUDED.languages,
                tags = EXCLUDED.tags,
                coordinates = EXCLUDED.coordinates,
                bitrate = EXCLUDED.bitrate,
                codec = EXCLUDED.codec,
                hls = EXCLUDED.hls,
                is_online = EXCLUDED.is_online,
                last_checked_at = EXCLUDED.last_checked_at,
                last_changed_at = EXCLUDED.last_changed_at,
                click_count = EXCLUDED.click_count,
                click_trend = EXCLUDED.click_trend,
                votes = EXCLUDED.votes,
                updated_at = NOW()",
            );

            builder.build().execute(&mut **tx).await?;
        }

        Ok(())
    }
}

fn json_array_to_vec(value: Value) -> Vec<String> {
    match value {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|item| item.as_str().map(|s| s.to_string()))
            .collect(),
        _ => vec![],
    }
}

fn row_to_station(row: PgRow) -> Result<Station, StorageError> {
    let languages: Option<Vec<Option<String>>> = row.try_get("languages")?;
    let tags: Option<Vec<Option<String>>> = row.try_get("tags")?;
    let coordinates_value: Option<Value> = row.try_get("coordinates")?;

    let coordinates = coordinates_value
        .and_then(|value| serde_json::from_value::<StationCoordinates>(value).ok());

    Ok(Station {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        stream_url: row.try_get("stream_url")?,
        homepage: row.try_get("homepage")?,
        favicon: row.try_get("favicon")?,
        country: row.try_get("country")?,
        country_code: row.try_get("country_code")?,
        state: row.try_get("state")?,
        languages: normalize_string_array(languages),
        tags: normalize_string_array(tags),
        coordinates,
        bitrate: row.try_get("bitrate")?,
        codec: row.try_get("codec")?,
        hls: row.try_get("hls")?,
        is_online: row.try_get("is_online")?,
        last_checked_at: row.try_get("last_checked_at")?,
        last_changed_at: row.try_get("last_changed_at")?,
        click_count: row.try_get("click_count")?,
        click_trend: row.try_get("click_trend")?,
        votes: row.try_get("votes")?,
    })
}

fn parse_schema_version(value: Option<String>) -> Option<i32> {
    value.and_then(|raw| raw.trim().parse::<i32>().ok())
}

fn normalize_string_array(value: Option<Vec<Option<String>>>) -> Vec<String> {
    value
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| item.map(|v| v.trim().to_string()).filter(|s| !s.is_empty()))
        .collect()
}
