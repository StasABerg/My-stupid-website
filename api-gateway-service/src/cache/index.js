import Redis from "ioredis";

function log(event, details = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...details,
    }),
  );
}

class MemoryCache {
  constructor({ ttlSeconds, maxEntries }) {
    this.ttlMs = Math.max(ttlSeconds, 1) * 1000;
    this.maxEntries = Math.max(maxEntries, 10);
    this.store = new Map();
  }

  pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  async get(key) {
    this.pruneExpired();
    const entry = this.store.get(key);
    return entry ? entry.value : null;
  }

  async set(key, value, ttlSeconds) {
    this.pruneExpired();
    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
    const ttl = Math.max(ttlSeconds ?? 0, 0) * 1000 || this.ttlMs;
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  async shutdown() {
    this.store.clear();
  }
}

function buildRedisClient(config) {
  const url = new URL(config.redis.url);
  const options = {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  };

  if (url.protocol === "rediss:") {
    options.tls = {
      rejectUnauthorized: config.redis.tlsRejectUnauthorized !== false,
    };
  }

  return new Redis(config.redis.url, options);
}

export function createCache(config) {
  const ttlSeconds = Math.max(config.ttlSeconds ?? 0, 0);
  const maxEntries = Math.max(config.memory?.maxEntries ?? 200, 10);

  let memoryCache = null;
  if (config.memory?.enabled !== false) {
    memoryCache = new MemoryCache({ ttlSeconds, maxEntries });
  }

  if (config.redis?.enabled && config.redis.url) {
    const client = buildRedisClient(config);
    const keyPrefix = config.redis.keyPrefix ?? "gateway:cache:";

    client.on("error", (error) => {
      log("cache-redis-error", { message: error.message });
    });

    const ensureConnected = async () => {
      if (client.status !== "ready") {
        await client.connect();
      }
    };

    return {
      async get(key) {
        try {
          await ensureConnected();
          const cached = await client.get(`${keyPrefix}${key}`);
          if (cached !== null) {
            return cached;
          }
        } catch (error) {
          log("cache-redis-get-error", { message: error.message });
        }

        return memoryCache ? memoryCache.get(key) : null;
      },

      async set(key, value, ttl) {
        if (memoryCache) {
          await memoryCache.set(key, value, ttlSeconds);
        }

        try {
          await ensureConnected();
          const effectiveTtl = Math.max(ttl ?? ttlSeconds, 0);
          if (effectiveTtl > 0) {
            await client.set(`${keyPrefix}${key}`, value, "EX", effectiveTtl);
          } else {
            await client.set(`${keyPrefix}${key}`, value);
          }
        } catch (error) {
          log("cache-redis-set-error", { message: error.message });
        }
      },

      async shutdown() {
        try {
          await client.quit();
        } catch {
          client.disconnect();
        }
        await memoryCache?.shutdown?.();
      },
    };
  }

  log("cache-memory-only", { maxEntries, ttlSeconds });
  const fallback = memoryCache ?? new MemoryCache({ ttlSeconds, maxEntries });
  return {
    get(key) {
      return fallback.get(key);
    },
    set(key, value, ttl) {
      return fallback.set(key, value, ttl ?? ttlSeconds);
    },
    shutdown() {
      return fallback.shutdown();
    },
  };
}
