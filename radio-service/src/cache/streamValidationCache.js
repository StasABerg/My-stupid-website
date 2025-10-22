export async function loadValidationCache(redis, cacheKey) {
  if (!redis || !cacheKey) {
    return null;
  }
  try {
    const rawCache = await redis.hgetall(cacheKey);
    const cache = new Map();
    for (const [url, value] of Object.entries(rawCache)) {
      try {
        cache.set(url, JSON.parse(value));
      } catch (_error) {
        continue;
      }
    }
    return cache;
  } catch (error) {
    console.warn("stream-validation-cache-read-error", { message: error.message });
    return null;
  }
}

export async function writeValidationCache({
  redis,
  cacheKey,
  updates,
  removals,
  ttlSeconds,
}) {
  if (!redis || !cacheKey) {
    return;
  }

  try {
    const pipeline = redis.pipeline();
    if (Array.isArray(updates)) {
      for (const update of updates) {
        pipeline.hset(cacheKey, update.streamUrl, JSON.stringify(update.value));
      }
    }
    if (removals && removals.size > 0) {
      pipeline.hdel(cacheKey, ...removals);
    }
    if (ttlSeconds > 0) {
      pipeline.expire(cacheKey, ttlSeconds);
    }

    const shouldExec =
      (updates && updates.length > 0) || (removals && removals.size > 0) || ttlSeconds > 0;
    if (shouldExec) {
      await pipeline.exec();
    }
  } catch (error) {
    console.warn("stream-validation-cache-write-error", { message: error.message });
  }
}
