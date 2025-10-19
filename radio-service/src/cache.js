import { config } from "./config.js";

export async function readStationsFromCache(redis) {
  const raw = await redis.get(config.cacheKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn("cache-parse-error", { message: error.message });
    return null;
  }
}

export async function writeStationsToCache(redis, payload, serializedPayload) {
  const ttl = config.cacheTtlSeconds;
  const body =
    typeof serializedPayload === "string" ? serializedPayload : JSON.stringify(payload);
  if (ttl > 0) {
    await redis.set(config.cacheKey, body, "EX", ttl);
  } else {
    await redis.set(config.cacheKey, body);
  }
}
