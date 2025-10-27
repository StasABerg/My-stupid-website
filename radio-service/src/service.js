import { readStationsFromCache, writeStationsToCache } from "./cache.js";
import {
  getStationsFromS3,
  notifyStationClick,
  refreshStations,
  sanitizePersistedStationsPayload,
  scheduleStationsPersistence,
} from "./stations/index.js";
import { cacheStationsInMemory, getStationsFromMemory } from "./cache/inMemoryStationsCache.js";
import { ensureProcessedStations } from "./stations/processedPayload.js";
import { logger } from "./logger.js";

let inflightRefreshPromise = null;

function scheduleRefresh(redis) {
  if (!inflightRefreshPromise) {
    inflightRefreshPromise = (async () => {
      try {
        const { payload, countryGroups, fingerprint } = await refreshStations({ redis });
        if (fingerprint && !payload.fingerprint) {
          payload.fingerprint = fingerprint;
        }
        const serialized = JSON.stringify(payload);
        const cacheUpdated = await writeStationsToCache(redis, payload, serialized, {
          fingerprint,
        });
        cacheStationsInMemory({
          payload,
          cacheSource: "radio-browser",
          fingerprint,
        });
        ensureProcessedStations(payload).catch((error) => {
          logger.warn("processed_stations.worker_error", { error });
        });
        scheduleStationsPersistence(payload, countryGroups, {
          fingerprint,
          changed: cacheUpdated,
        });
        return payload;
      } finally {
        inflightRefreshPromise = null;
      }
    })();
  }
  return inflightRefreshPromise;
}

export async function loadStations(redis, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const memoryCached = getStationsFromMemory();
    if (memoryCached?.payload) {
      return {
        payload: memoryCached.payload,
        cacheSource: memoryCached.cacheSource ?? "memory",
      };
    }

    const cached = await readStationsFromCache(redis);
    const sanitizedCache = sanitizePersistedStationsPayload(cached);
    if (sanitizedCache) {
      if (sanitizedCache !== cached) {
        logger.info("cache.upgraded", { source: "redis" });
        const serialized = JSON.stringify(sanitizedCache);
        await writeStationsToCache(redis, sanitizedCache, serialized);
      }
      cacheStationsInMemory({
        payload: sanitizedCache,
        cacheSource: "cache",
        fingerprint: sanitizedCache.fingerprint ?? null,
      });
      ensureProcessedStations(sanitizedCache).catch((error) => {
        logger.warn("processed_stations.worker_error", { error });
      });
      return { payload: sanitizedCache, cacheSource: "cache" };
    }

    try {
      const payload = await getStationsFromS3();
      const sanitizedS3 = sanitizePersistedStationsPayload(payload);
      if (sanitizedS3) {
        const serialized = JSON.stringify(sanitizedS3);
        await writeStationsToCache(redis, sanitizedS3, serialized);
        cacheStationsInMemory({
          payload: sanitizedS3,
          cacheSource: "s3",
          fingerprint: sanitizedS3.fingerprint ?? null,
        });
        ensureProcessedStations(sanitizedS3).catch((error) => {
          logger.warn("processed_stations.worker_error", { error });
        });
        scheduleRefresh(redis).catch((error) => {
          logger.warn("stations.background_refresh_error", { error });
        });
        return { payload: sanitizedS3, cacheSource: "s3" };
      }
    } catch (error) {
      logger.warn("s3.read_error", { error });
    }
  }

  const payload = await scheduleRefresh(redis);
  cacheStationsInMemory({
    payload,
    cacheSource: "radio-browser",
    fingerprint: payload?.fingerprint ?? null,
  });
  ensureProcessedStations(payload).catch((error) => {
    logger.warn("processed_stations.worker_error", { error });
  });
  return { payload, cacheSource: "radio-browser" };
}

export async function updateStations(redis) {
  const payload = await scheduleRefresh(redis);
  cacheStationsInMemory({
    payload,
    cacheSource: "radio-browser",
    fingerprint: payload?.fingerprint ?? null,
  });
  ensureProcessedStations(payload).catch((error) => {
    logger.warn("processed_stations.worker_error", { error });
  });
  return { payload, cacheSource: "radio-browser" };
}

export async function recordStationClick(stationUuid) {
  return notifyStationClick(stationUuid);
}
