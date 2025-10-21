import { readStationsFromCache, writeStationsToCache } from "./cache.js";
import { notifyStationClick, refreshStations, sanitizePersistedStationsPayload } from "./stations.js";

let inflightRefreshPromise = null;

function scheduleRefresh(redis) {
  if (!inflightRefreshPromise) {
    inflightRefreshPromise = (async () => {
      try {
        const payload = await refreshStations();
        const serialized = JSON.stringify(payload);
        await writeStationsToCache(redis, payload, serialized);
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
    const cached = await readStationsFromCache(redis);
    const sanitizedCache = sanitizePersistedStationsPayload(cached);
    if (sanitizedCache) {
      if (sanitizedCache !== cached) {
        console.log("cache-upgraded", { source: "redis" });
        const serialized = JSON.stringify(sanitizedCache);
        await writeStationsToCache(redis, sanitizedCache, serialized);
      }
      return { payload: sanitizedCache, cacheSource: "cache" };
    }
  }

  const payload = await scheduleRefresh(redis);
  return { payload, cacheSource: "radio-browser" };
}

export async function updateStations(redis) {
  const payload = await scheduleRefresh(redis);
  return { payload, cacheSource: "radio-browser" };
}

export async function recordStationClick(stationUuid) {
  return notifyStationClick(stationUuid);
}
