import { readStationsFromCache, writeStationsToCache } from "./cache.js";
import {
  getStationsFromS3,
  notifyStationClick,
  refreshStations,
  sanitizePersistedStationsPayload,
} from "./stations.js";

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

  try {
    const payload = await getStationsFromS3();
    const sanitizedS3 = sanitizePersistedStationsPayload(payload);
    if (sanitizedS3) {
      if (sanitizedS3 !== payload) {
        console.log("cache-upgraded", { source: "s3" });
      }
      const serialized = JSON.stringify(sanitizedS3);
      await writeStationsToCache(redis, sanitizedS3, serialized);
      return { payload: sanitizedS3, cacheSource: "s3" };
    }
  } catch (error) {
    console.warn("s3-read-error", { message: error.message });
  }

  const payload = await refreshStations();
  const serialized = JSON.stringify(payload);
  await writeStationsToCache(redis, payload, serialized);
  return { payload, cacheSource: "radio-browser" };
}

export async function updateStations(redis) {
  const payload = await refreshStations();
  const serialized = JSON.stringify(payload);
  await writeStationsToCache(redis, payload, serialized);
  return { payload, cacheSource: "radio-browser" };
}

export async function recordStationClick(stationUuid) {
  return notifyStationClick(stationUuid);
}
