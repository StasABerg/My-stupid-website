import { readStationsFromCache, writeStationsToCache } from "./cache.js";
import {
  getStationsFromStore,
  notifyStationClick,
  persistStationsPayload,
  refreshStations,
  sanitizePersistedStationsPayload,
} from "./stations/index.js";
import { cacheStationsInMemory, getStationsFromMemory } from "./cache/inMemoryStationsCache.js";
import { ensureProcessedStations } from "./stations/processedPayload.js";
import { logger } from "./logger.js";

let inflightRefreshPromise = null;

function scheduleRefresh(redis) {
  if (!inflightRefreshPromise) {
    inflightRefreshPromise = (async () => {
      try {
        const { payload, fingerprint } = await refreshStations({ redis });
        if (fingerprint && !payload.fingerprint) {
          payload.fingerprint = fingerprint;
        }
        const serialized = JSON.stringify(payload);
        await writeStationsToCache(redis, payload, serialized, {
          fingerprint,
        });
        cacheStationsInMemory({
          payload,
          cacheSource: "radio-browser",
          fingerprint,
        });
        await persistStationsPayload(payload, { fingerprint });
        ensureProcessedStations(payload).catch((error) => {
          logger.warn("processed_stations.worker_error", { error });
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
      const payload = await getStationsFromStore();
      const sanitizedDbPayload = sanitizePersistedStationsPayload(payload);
      if (sanitizedDbPayload) {
        const serialized = JSON.stringify(sanitizedDbPayload);
        await writeStationsToCache(redis, sanitizedDbPayload, serialized);
        cacheStationsInMemory({
          payload: sanitizedDbPayload,
          cacheSource: "database",
          fingerprint: sanitizedDbPayload.fingerprint ?? null,
        });
        ensureProcessedStations(sanitizedDbPayload).catch((error) => {
          logger.warn("processed_stations.worker_error", { error });
        });
        scheduleRefresh(redis).catch((error) => {
          logger.warn("stations.background_refresh_error", { error });
        });
        return { payload: sanitizedDbPayload, cacheSource: "database" };
      }
    } catch (error) {
      logger.warn("database.read_error", { error });
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
