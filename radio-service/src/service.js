import { readStationsFromCache, writeStationsToCache } from "./cache.js";
import {
  getStationsFromS3,
  notifyStationClick,
  refreshStations,
  sanitizePersistedStationsPayload,
} from "./stations.js";

let inflightRefreshPromise = null;

function scheduleRefresh(redis) {
  if (!inflightRefreshPromise) {
    inflightRefreshPromise = (async () => {
      try {
        const payload = await refreshStations({ redis });
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

    try {
      const payload = await getStationsFromS3();
      const sanitizedS3 = sanitizePersistedStationsPayload(payload);
      if (sanitizedS3) {
        const serialized = JSON.stringify(sanitizedS3);
        await writeStationsToCache(redis, sanitizedS3, serialized);
        scheduleRefresh(redis).catch((error) => {
          console.warn("background-refresh-error", { message: error.message });
        });
        return { payload: sanitizedS3, cacheSource: "s3" };
      }
    } catch (error) {
      console.warn("s3-read-error", { message: error.message });
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
