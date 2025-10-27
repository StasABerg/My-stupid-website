import { config } from "./config/index.js";
import { buildStationsFingerprint } from "./stations/normalize.js";
import { logger } from "./logger.js";

export async function readStationsFromCache(redis) {
  const raw = await redis.get(config.cacheKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    logger.warn("cache.parse_error", { error });
    return null;
  }
}

export async function writeStationsToCache(
  redis,
  payload,
  serializedPayload,
  { fingerprint } = {},
) {
  const ttl = config.cacheTtlSeconds;
  const body =
    typeof serializedPayload === "string" ? serializedPayload : JSON.stringify(payload);

  const cached = await redis.get(config.cacheKey);
  if (cached) {
    let shouldSkip = false;
    if (fingerprint) {
      try {
        const parsed = JSON.parse(cached);
        const cachedFingerprint = buildStationsFingerprint(parsed?.stations);
        shouldSkip = cachedFingerprint === fingerprint;
      } catch (_error) {
        shouldSkip = false;
      }
    } else {
      shouldSkip = cached === body;
    }

    if (shouldSkip) {
      if (ttl > 0) {
        await redis.expire(config.cacheKey, ttl);
      }
      return false;
    }
  }

  if (ttl > 0) {
    await redis.set(config.cacheKey, body, "EX", ttl);
  } else {
    await redis.set(config.cacheKey, body);
  }

  return true;
}
