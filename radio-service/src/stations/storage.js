import { withPgClient } from "../db/postgres.js";
import { logger } from "../logger.js";
import { buildStationsFingerprint } from "./normalize.js";

const STATION_COLUMNS = [
  "id",
  "payload_id",
  "name",
  "stream_url",
  "homepage",
  "favicon",
  "country",
  "country_code",
  "state",
  "languages",
  "tags",
  "coordinates",
  "bitrate",
  "codec",
  "hls",
  "is_online",
  "last_checked_at",
  "last_changed_at",
  "click_count",
  "click_trend",
  "votes",
];

const COLUMN_COUNT = STATION_COLUMNS.length;
const MAX_BATCH_SIZE = 400;

function sanitizeArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string");
}

function serializeStation(station, payloadId) {
  return [
    station.id,
    payloadId,
    station.name,
    station.streamUrl,
    station.homepage ?? null,
    station.favicon ?? null,
    station.country ?? null,
    station.countryCode ?? null,
    station.state ?? null,
    sanitizeArray(station.languages),
    sanitizeArray(station.tags),
    station.coordinates ?? null,
    Number.isFinite(station.bitrate) ? station.bitrate : null,
    station.codec ?? null,
    Boolean(station.hls),
    station.isOnline === undefined ? true : Boolean(station.isOnline),
    station.lastCheckedAt ?? null,
    station.lastChangedAt ?? null,
    Number.isFinite(station.clickCount) ? station.clickCount : 0,
    Number.isFinite(station.clickTrend) ? station.clickTrend : 0,
    Number.isFinite(station.votes) ? station.votes : 0,
  ];
}

function deserializeStation(row) {
  return {
    id: row.id,
    name: row.name,
    streamUrl: row.stream_url,
    homepage: row.homepage,
    favicon: row.favicon,
    country: row.country,
    countryCode: row.country_code,
    state: row.state,
    languages: Array.isArray(row.languages) ? row.languages : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
    coordinates: row.coordinates ?? null,
    bitrate: row.bitrate,
    codec: row.codec,
    hls: row.hls ?? false,
    isOnline: row.is_online ?? true,
    lastCheckedAt: row.last_checked_at ?? null,
    lastChangedAt: row.last_changed_at ?? null,
    clickCount: row.click_count ?? 0,
    clickTrend: row.click_trend ?? 0,
    votes: row.votes ?? 0,
  };
}

async function insertStations(client, payloadId, stations) {
  if (!Array.isArray(stations) || stations.length === 0) {
    return;
  }

  const quotedColumns = STATION_COLUMNS.map((column) => `"${column}"`).join(", ");
  const updateAssignments = STATION_COLUMNS.filter((column) => column !== "id").map(
    (column) => `"${column}" = EXCLUDED."${column}"`,
  );
  updateAssignments.push(`updated_at = NOW()`);

  for (let offset = 0; offset < stations.length; offset += MAX_BATCH_SIZE) {
    const batch = stations.slice(offset, offset + MAX_BATCH_SIZE);
    const values = [];
    const placeholders = [];

    batch.forEach((station, index) => {
      const rowValues = serializeStation(station, payloadId);
      values.push(...rowValues);
      const baseIndex = index * COLUMN_COUNT;
      const rowPlaceholders = rowValues.map(
        (_value, columnOffset) => `$${baseIndex + columnOffset + 1}`,
      );
      placeholders.push(`(${rowPlaceholders.join(", ")})`);
    });

    const query = `
      INSERT INTO stations (${quotedColumns})
      VALUES ${placeholders.join(", ")}
      ON CONFLICT (id) DO UPDATE SET ${updateAssignments.join(", ")}
    `;

    await client.query(query, values);
  }
}

function coerceUpdatedAt(value) {
  if (!value) {
    return new Date();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date();
  }
  return date;
}

export async function loadStationsFromDatabase() {
  return withPgClient(async (client) => {
    const { rows } = await client.query(
      `
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
      `,
    );

    if (rows.length === 0) {
      return null;
    }

    const payloadRow = rows[0];
    const stationsResult = await client.query(
      `
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
      `,
      [payloadRow.id],
    );

    const stations = stationsResult.rows.map((row) => deserializeStation(row));

    return {
      schemaVersion: payloadRow.schema_version ?? null,
      updatedAt: payloadRow.updated_at?.toISOString?.() ?? null,
      source: payloadRow.source ?? null,
      requests: Array.isArray(payloadRow.requests) ? payloadRow.requests : [],
      total: payloadRow.total ?? stations.length,
      fingerprint: payloadRow.fingerprint ?? buildStationsFingerprint(stations),
      stations,
    };
  });
}

export async function persistStationsPayload(payload, { fingerprint } = {}) {
  const stations = Array.isArray(payload?.stations) ? payload.stations : [];
  if (stations.length === 0) {
    throw new Error("Cannot persist empty stations payload.");
  }

  const effectiveFingerprint = fingerprint ?? buildStationsFingerprint(stations);

  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      const { rows } = await client.query(
        `
          SELECT ss.payload_id AS id, sp.fingerprint
          FROM station_state ss
          LEFT JOIN station_payloads sp ON sp.id = ss.payload_id
          FOR UPDATE OF ss
        `,
      );

      if (rows.length > 0 && rows[0].fingerprint === effectiveFingerprint) {
        await client.query("UPDATE station_state SET updated_at = NOW() WHERE id = TRUE");
        await client.query("COMMIT");
        return { changed: false, payloadId: rows[0].id };
      }

      const updatedAt = coerceUpdatedAt(payload.updatedAt);
      const { rows: inserted } = await client.query(
        `
          INSERT INTO station_payloads (schema_version, updated_at, source, requests, total, fingerprint)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6)
          RETURNING id
        `,
        [
          payload.schemaVersion ?? null,
          updatedAt,
          payload.source ?? null,
          JSON.stringify(payload.requests ?? []),
          Number.isFinite(payload.total) ? payload.total : stations.length,
          effectiveFingerprint,
        ],
      );

      const payloadId = inserted[0].id;
      await insertStations(client, payloadId, stations);

      await client.query(
        `
          INSERT INTO station_state (id, payload_id, updated_at)
          VALUES (TRUE, $1, NOW())
          ON CONFLICT (id) DO UPDATE SET payload_id = EXCLUDED.payload_id, updated_at = NOW()
        `,
        [payloadId],
      );

      await client.query("DELETE FROM station_payloads WHERE id <> $1", [payloadId]);

      await client.query("COMMIT");
      logger.info("stations.persisted", { total: stations.length });
      return { changed: true, payloadId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
