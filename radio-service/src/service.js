import { readStationsFromCache, writeStationsToCache } from "./cache.js";
import { getStationsFromS3, refreshStations } from "./stations.js";

export async function loadStations(redis, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = await readStationsFromCache(redis);
    if (cached) {
      return { payload: cached, cacheSource: "cache" };
    }
  }

  try {
    const payload = await getStationsFromS3();
    if (payload && payload.stations) {
      await writeStationsToCache(redis, payload);
      return { payload, cacheSource: "s3" };
    }
  } catch (error) {
    console.warn("s3-read-error", { message: error.message });
  }

  const payload = await refreshStations();
  await writeStationsToCache(redis, payload);
  return { payload, cacheSource: "radio-browser" };
}

export async function updateStations(redis) {
  const payload = await refreshStations();
  await writeStationsToCache(redis, payload);
  return { payload, cacheSource: "radio-browser" };
}
