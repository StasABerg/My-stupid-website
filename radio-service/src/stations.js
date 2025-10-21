import { z } from "zod";
import { config } from "./config.js";
import {
  buildRadioBrowserUrl,
  getRadioBrowserBaseUrl,
  rotateRadioBrowserBaseUrl,
} from "./radioBrowser.js";
import { fetchStationsFromS3, scheduleStationsPersistence } from "./s3.js";

export const SCHEMA_VERSION = 3;

const stationSchema = z.object({
  stationuuid: z.string(),
  name: z.string().min(1),
  url: z.string().url().or(z.string().min(1)),
  url_resolved: z.string().optional(),
  homepage: z.string().nullable().optional(),
  favicon: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  countrycode: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  geo_lat: z.coerce.number().nullable().optional(),
  geo_long: z.coerce.number().nullable().optional(),
  bitrate: z.coerce.number().nullable().optional(),
  codec: z.string().nullable().optional(),
  lastcheckok: z.coerce.number().nullable().optional(),
  ssl_error: z.coerce.number().nullable().optional(),
  lastchecktime: z.string().nullable().optional(),
  lastchangetime: z.string().nullable().optional(),
  clickcount: z.coerce.number().nullable().optional(),
  clicktrend: z.coerce.number().nullable().optional(),
  votes: z.coerce.number().nullable().optional(),
  hls: z.coerce.number().nullable().optional(),
});

class RadioBrowserRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "RadioBrowserRequestError";
  }
}

async function withRotatingRadioBrowserHost(executor) {
  const attempted = new Set();
  let lastError;

  // Loop until we have tried every known host once.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const baseUrl = await getRadioBrowserBaseUrl();
    if (attempted.has(baseUrl)) {
      break;
    }

    attempted.add(baseUrl);

    try {
      return await executor(baseUrl);
    } catch (error) {
      if (!(error instanceof RadioBrowserRequestError)) {
        throw error;
      }
      lastError = error;
      await rotateRadioBrowserBaseUrl();
    }
  }

  throw lastError ?? new RadioBrowserRequestError("All Radio Browser endpoints failed.");
}

function normalizeList(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function sanitizeUrl(rawUrl, { forceHttps = false, allowInsecure = false } = {}) {
  if (!rawUrl) return null;
  const trimmed = rawUrl.toString().trim();
  if (trimmed.length === 0) return null;

  const normalizedInput = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;

  try {
    const parsed = new URL(normalizedInput);
    if (parsed.protocol === "https:") {
      return parsed.toString();
    }

    if (parsed.protocol === "http:") {
      if (forceHttps || !allowInsecure) {
        parsed.protocol = "https:";
        return parsed.toString();
      }
      if (allowInsecure) {
        return parsed.toString();
      }
      return null;
    }

    return allowInsecure ? parsed.toString() : null;
  } catch (_error) {
    return null;
  }
}

function sanitizeStreamUrl(rawUrl) {
  return sanitizeUrl(rawUrl, {
    forceHttps: true,
    allowInsecure: false,
  });
}

function selectStreamUrl(data) {
  return sanitizeStreamUrl(data.url_resolved);
}

function normalizeStation(station) {
  const data = stationSchema.parse(station);
  const streamUrl = selectStreamUrl(data);
  if (!streamUrl) {
    return null;
  }

  const isOnline = data.lastcheckok === 1;
  const hasSslError =
    typeof data.ssl_error === "number" ? data.ssl_error !== 0 : false;
  if (!isOnline || hasSslError) {
    return null;
  }

  const homepage = sanitizeUrl(data.homepage ?? null, {
    forceHttps: config.radioBrowser.enforceHttpsStreams,
    allowInsecure: config.allowInsecureTransports,
  });
  const favicon = sanitizeUrl(data.favicon ?? null, {
    forceHttps: config.radioBrowser.enforceHttpsStreams,
    allowInsecure: config.allowInsecureTransports,
  });

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

function buildDefaultHeaders() {
  return {
    "User-Agent": config.radioBrowser.userAgent,
    Accept: "application/json",
  };
}

async function buildStationsUrl({ baseUrl }) {
  const url = await buildRadioBrowserUrl(config.radioBrowser.stationsPath, { baseUrl });
  url.searchParams.set("hidebroken", "true");
  url.searchParams.set("order", "clickcount");
  url.searchParams.set("reverse", "true");
  url.searchParams.set("lastcheckok", "1");
  url.searchParams.set("ssl_error", "0");

  if (Number.isFinite(config.radioBrowser.limit) && config.radioBrowser.limit > 0) {
    url.searchParams.set("limit", String(config.radioBrowser.limit));
  }

  return url;
}

async function fetchStations() {
  return withRotatingRadioBrowserHost(async (baseUrl) => {
    const url = await buildStationsUrl({ baseUrl });

    let response;
    try {
      response = await fetch(url, {
        headers: buildDefaultHeaders(),
      });
    } catch (error) {
      throw new RadioBrowserRequestError(
        `Radio Browser stations request failed: ${error.message} for ${url.toString()}`,
      );
    }

    if (!response.ok) {
      throw new RadioBrowserRequestError(
        `Radio Browser stations request failed: ${response.status} for ${url.toString()}`,
      );
    }

    const rawStations = await response.json();
    if (!Array.isArray(rawStations)) {
      throw new Error("Unexpected stations payload from Radio Browser API");
    }

    return { rawStations, requestUrl: url.toString() };
  });
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildCountryGroups(stations) {
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

async function fetchFromRadioBrowser() {
  const { rawStations, requestUrl } = await fetchStations();
  const requestUrls = [requestUrl];

  const stations = [];
  let filteredStations = 0;

  const maxStations =
    Number.isFinite(config.radioBrowser.limit) && config.radioBrowser.limit > 0
      ? config.radioBrowser.limit
      : Number.POSITIVE_INFINITY;

  for (const station of rawStations) {
    if (stations.length >= maxStations) {
      break;
    }

    const normalized = normalizeStation(station);
    if (normalized) {
      stations.push(normalized);
    } else {
      filteredStations += 1;
    }
  }

  if (stations.length === 0) {
    throw new Error("Radio Browser API returned no stations");
  }

  if (filteredStations > 0) {
    console.log("filtered-stations", { dropped: filteredStations });
  }

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    source: requestUrl,
    requests: requestUrls,
    total: stations.length,
    stations,
  };

  const countryGroups = buildCountryGroups(stations);

  scheduleStationsPersistence(payload, countryGroups);
  return payload;
}

function sanitizePersistedStationRecord(station) {
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

  const homepage = sanitizeUrl(station.homepage ?? null, {
    forceHttps: config.radioBrowser.enforceHttpsStreams,
    allowInsecure: config.allowInsecureTransports,
  });
  const favicon = sanitizeUrl(station.favicon ?? null, {
    forceHttps: config.radioBrowser.enforceHttpsStreams,
    allowInsecure: config.allowInsecureTransports,
  });

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

async function buildStationClickUrl(stationUuid, { baseUrl }) {
  const basePath = config.radioBrowser.stationClickPath.replace(/\/$/, "");
  return buildRadioBrowserUrl(`${basePath}/${encodeURIComponent(stationUuid)}`, { baseUrl });
}

export async function notifyStationClick(stationUuid) {
  if (!stationUuid || stationUuid.trim().length === 0) {
    throw new Error("A station UUID is required to record a click.");
  }

  return withRotatingRadioBrowserHost(async (baseUrl) => {
    const url = await buildStationClickUrl(stationUuid, { baseUrl });

    let response;
    try {
      response = await fetch(url, {
        headers: buildDefaultHeaders(),
      });
    } catch (error) {
      throw new RadioBrowserRequestError(
        `Radio Browser click request failed: ${error.message} for ${url.toString()}`,
      );
    }

    if (!response.ok) {
      throw new RadioBrowserRequestError(
        `Radio Browser click request failed: ${response.status} for ${url.toString()}`,
      );
    }

    const payload = await response.json();
    if (!payload || (payload.ok !== "true" && payload.ok !== true)) {
      throw new Error("Radio Browser did not confirm the click event.");
    }

    return payload;
  });
}

export async function getStationsFromS3() {
  return fetchStationsFromS3();
}

export async function refreshStations() {
  return fetchFromRadioBrowser();
}
