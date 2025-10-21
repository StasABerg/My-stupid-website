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

async function validateStationStream(station) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.streamValidation.timeoutMs);

  try {
    const clean = async (response) => {
      if (response?.body) {
        try {
          await response.body.cancel();
        } catch (_error) {
          /* ignore cancellation errors */
        }
      }
    };

    const headers = { Range: "bytes=0-4095" };
    let candidate;
    try {
      candidate = await fetch(station.streamUrl, {
        method: "GET",
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
      return { ok: false, reason: "network" };
    }

    if (!candidate.ok && candidate.status !== 206) {
      await clean(candidate);
      return { ok: false, reason: `status-${candidate.status}` };
    }

    const finalUrl = candidate.url ?? station.streamUrl;
    if (!finalUrl.toLowerCase().startsWith("https://")) {
      await clean(candidate);
      return { ok: false, reason: "insecure-redirect" };
    }

    const contentType = candidate.headers.get("content-type") ?? "";

    const lowerType = contentType.toLowerCase().split(";")[0].trim();
    const isKnownStreamType =
      lowerType.startsWith("audio/") ||
      lowerType.startsWith("video/") ||
      lowerType.includes("mpegurl") ||
      lowerType === "application/octet-stream" ||
      lowerType === "application/x-mpegurl";

    let hasData = false;
    const body = candidate.body;
    if (body) {
      if (typeof body.getReader === "function") {
        const reader = body.getReader();
        try {
          const { value, done } = await reader.read();
          hasData = Boolean(value && value.length > 0 && !done);
        } finally {
          try {
            await reader.cancel();
          } catch (_error) {
            /* ignore cancellation errors */
          }
        }
      } else if (typeof body[Symbol.asyncIterator] === "function") {
        for await (const chunk of body) {
          if (chunk && chunk.length > 0) {
            hasData = true;
            break;
          }
        }
      }
    }

    await clean(candidate);

    if (!isKnownStreamType) {
      return { ok: false, reason: "unexpected-content-type" };
    }
    if (!hasData) {
      return { ok: false, reason: "empty-response" };
    }

    return {
      ok: true,
      finalUrl,
      contentType,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timeout);
  }
}

async function validateStationStreams(stations, { redis } = {}) {
  const concurrency = Math.max(1, config.streamValidation.concurrency);
  const accepted = new Array(stations.length);
  const dropCounts = new Map();
  const cacheKey = config.streamValidation.cacheKey;
  const cacheTtlMs = config.streamValidation.cacheTtlSeconds * 1000;
  const now = Date.now();

  let cache = null;
  if (redis && cacheKey) {
    try {
      const rawCache = await redis.hgetall(cacheKey);
      cache = new Map();
      for (const [url, value] of Object.entries(rawCache)) {
        try {
          const parsed = JSON.parse(value);
          cache.set(url, parsed);
        } catch (_error) {
          continue;
        }
      }
    } catch (error) {
      console.warn("stream-validation-cache-read-error", { message: error.message });
    }
  }

  const cacheUpdates = [];
  const cacheRemovals = new Set();

  let index = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= stations.length) {
        break;
      }

      const station = stations[currentIndex];
      const cacheEntry = cache?.get(station.streamUrl);
      if (cacheEntry && typeof cacheEntry.validatedAt === "number") {
        if (now - cacheEntry.validatedAt <= cacheTtlMs) {
          const updatedStation = { ...station };
          if (cacheEntry.finalUrl) {
            updatedStation.streamUrl = cacheEntry.finalUrl;
          }
          if (cacheEntry.forceHls === true) {
            updatedStation.hls = true;
          }
          accepted[currentIndex] = updatedStation;
          continue;
        }
      }

      const result = await validateStationStream(station);
      if (result.ok) {
        const updatedStation = { ...station };
        if (result.finalUrl && result.finalUrl !== station.streamUrl) {
          updatedStation.streamUrl = result.finalUrl;
        }
        if (result.contentType && /mpegurl/i.test(result.contentType) && !station.hls) {
          updatedStation.hls = true;
        }
        accepted[currentIndex] = updatedStation;
        if (redis && cacheKey) {
          cacheUpdates.push({
            streamUrl: station.streamUrl,
            value: {
              validatedAt: Date.now(),
              finalUrl: updatedStation.streamUrl,
              forceHls: updatedStation.hls === true,
            },
          });
        }
      } else {
        const reason = result.reason ?? "invalid";
        dropCounts.set(reason, (dropCounts.get(reason) ?? 0) + 1);
        if (redis && cacheKey) {
          cacheRemovals.add(station.streamUrl);
        }
      }
    }
  });

  await Promise.all(workers);

  const filtered = accepted.filter(Boolean);
  if (redis && cacheKey) {
    try {
      const pipeline = redis.pipeline();
      for (const update of cacheUpdates) {
        pipeline.hset(cacheKey, update.streamUrl, JSON.stringify(update.value));
      }
      if (cacheRemovals.size > 0) {
        pipeline.hdel(cacheKey, ...cacheRemovals);
      }
      const shouldExpire = config.streamValidation.cacheTtlSeconds > 0;
      if (shouldExpire) {
        pipeline.expire(cacheKey, config.streamValidation.cacheTtlSeconds);
      }
      if (cacheUpdates.length > 0 || cacheRemovals.size > 0 || shouldExpire) {
        await pipeline.exec();
      }
    } catch (error) {
      console.warn("stream-validation-cache-write-error", { message: error.message });
    }
  }

  return {
    stations: filtered,
    dropped: stations.length - filtered.length,
    reasons: Object.fromEntries(dropCounts),
  };
}

async function fetchFromRadioBrowser({ redis } = {}) {
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

  let validationDrops = 0;
  let finalStations = stations;
  if (config.streamValidation.enabled) {
    const { stations: validatedStations, dropped, reasons } =
      await validateStationStreams(stations, { redis });
    validationDrops = dropped;
    finalStations = validatedStations;
    if (validationDrops > 0) {
      console.log("stream-validation", { dropped: validationDrops, reasons });
    }
  }

  if (finalStations.length === 0) {
    throw new Error("Radio Browser API returned no stations");
  }

  if (filteredStations > 0 || validationDrops > 0) {
    console.log("filtered-stations", {
      droppedNormalizing: filteredStations,
      droppedValidation: validationDrops,
    });
  }

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    source: requestUrl,
    requests: requestUrls,
    total: finalStations.length,
    stations: finalStations,
  };

  const countryGroups = buildCountryGroups(finalStations);

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

export async function refreshStations(options = {}) {
  return fetchFromRadioBrowser(options);
}
