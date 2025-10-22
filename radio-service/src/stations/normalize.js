import { createHash } from "node:crypto";
import { config } from "../config/index.js";
import { SCHEMA_VERSION, stationSchema } from "./schemas.js";
import {
  isBlockedDomain,
  normalizeList,
  sanitizeStationUrl,
  sanitizeStreamUrl,
  selectStreamUrl,
  sanitizeUrl,
} from "./sanitize.js";

export function normalizeStation(station) {
  const data = stationSchema.parse(station);
  const streamUrl = selectStreamUrl(data);
  if (!streamUrl) {
    return null;
  }

  if (isBlockedDomain(streamUrl)) {
    return null;
  }

  const isOnline = data.lastcheckok === 1;
  const hasSslError =
    typeof data.ssl_error === "number" ? data.ssl_error !== 0 : false;
  if (!isOnline || hasSslError) {
    return null;
  }

  const homepage = sanitizeStationUrl(data.homepage ?? null);
  const favicon = sanitizeStationUrl(data.favicon ?? null);

  return {
    id: data.stationuuid,
    name: data.name,
    streamUrl,
    homepage: homepage ?? null,
    favicon: favicon ?? null,
    country: data.country ?? null,
    countryCode: data.countrycode?.toUpperCase() ?? null,
    state: data.state ?? null,
    languages: normalizeList(data.language),
    tags: normalizeList(data.tags),
    coordinates:
      typeof data.geo_lat === "number" && typeof data.geo_long === "number"
        ? { lat: data.geo_lat, lon: data.geo_long }
        : null,
    bitrate: typeof data.bitrate === "number" ? data.bitrate : null,
    codec: data.codec ?? null,
    hls: data.hls === 1,
    isOnline,
    lastCheckedAt: data.lastchecktime ?? null,
    lastChangedAt: data.lastchangetime ?? null,
    clickCount: typeof data.clickcount === "number" ? data.clickcount : 0,
    clickTrend: typeof data.clicktrend === "number" ? data.clicktrend : 0,
    votes: typeof data.votes === "number" ? data.votes : 0,
  };
}

export function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildCountryGroups(stations) {
  const groups = new Map();

  for (const station of stations) {
    const countryCode = station.countryCode ?? null;
    const countryName = station.country ?? null;
    const baseKey = countryCode ? countryCode.toLowerCase() : slugify(countryName ?? "unknown");
    const key = baseKey.length > 0 ? baseKey : "unknown";

    if (!groups.has(key)) {
      groups.set(key, {
        code: countryCode,
        name: countryName,
        stations: [],
      });
    } else {
      const group = groups.get(key);
      if (!group.code && countryCode) {
        group.code = countryCode;
      }
      if (!group.name && countryName) {
        group.name = countryName;
      }
    }

    groups.get(key).stations.push(station);
  }

  return groups;
}

export function buildStationSignature(station) {
  return [station.streamUrl, station.lastChangedAt ?? null]
    .map((value) => (value === null || value === undefined ? "" : String(value)))
    .join("|");
}

export function buildStationsFingerprint(stations) {
  if (!Array.isArray(stations) || stations.length === 0) {
    return "empty";
  }

  const hash = createHash("sha256");
  for (const station of stations) {
    hash.update(JSON.stringify(station));
    hash.update("\n");
  }

  return hash.digest("hex");
}

export function sanitizePersistedStationRecord(station) {
  if (!station || typeof station !== "object") {
    return null;
  }

  const streamUrl = sanitizeStreamUrl(station.streamUrl);
  if (!streamUrl) {
    return null;
  }

  if (station.isOnline !== true) {
    return null;
  }

  const homepage = sanitizeStationUrl(station.homepage ?? null);
  const favicon = sanitizeStationUrl(station.favicon ?? null);

  return {
    ...station,
    streamUrl,
    homepage: homepage ?? null,
    favicon: favicon ?? null,
    isOnline: true,
  };
}

export function sanitizePersistedStationsPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (payload.schemaVersion === SCHEMA_VERSION) {
    return payload;
  }

  const stations = Array.isArray(payload.stations) ? payload.stations : [];
  const sanitizedStations = stations
    .map((station) => sanitizePersistedStationRecord(station))
    .filter(Boolean);

  if (sanitizedStations.length === 0) {
    return null;
  }

  const sanitizedRequests = Array.isArray(payload.requests)
    ? payload.requests
        .map((value) =>
          sanitizeUrl(value, {
            forceHttps: true,
            allowInsecure: config.allowInsecureTransports,
          }),
        )
        .filter(Boolean)
    : [];
  const requests =
    sanitizedRequests.length > 0
      ? sanitizedRequests
      : Array.isArray(payload.requests)
        ? payload.requests
        : [];
  const source = sanitizeUrl(payload.source ?? null, {
    forceHttps: true,
    allowInsecure: config.allowInsecureTransports,
  });

  return {
    ...payload,
    schemaVersion: SCHEMA_VERSION,
    source: source ?? null,
    requests,
    stations: sanitizedStations,
    total: sanitizedStations.length,
  };
}
