import { createClient } from "@valkey/valkey-glide";

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
    this.enabled = true;
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
    if (!entry) {
      return null;
    }
    return entry.value;
  }

  async set(key, value, ttlSeconds) {
    this.pruneExpired();
    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
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

export function createCache(config) {
  const ttlSeconds = Math.max(config.ttlSeconds ?? 0, 0);
  const maxEntries = Math.max(config.memory?.maxEntries ?? 200, 10);

  let memoryCache = null;
  if (config.memory?.enabled !== false) {
    memoryCache = new MemoryCache({ ttlSeconds, maxEntries });
  }

  if (config.redis?.enabled) {
    const redisUrl = config.redis.url;
    try {
      const client = createClient({
        url: redisUrl,
        socket: {
          tls: redisUrl.startsWith("rediss://"),
          rejectUnauthorized: config.redis.tlsRejectUnauthorized !== false,
        },
        lazyConnect: config.redis.lazyConnect ?? false,
      });
      client.on("error", (error) => log("cache-redis-error", { message: error.message }));
      client.on("ready", () => log("cache-redis-ready", { keyPrefix: config.redis.keyPrefix }));

      const keyPrefix = config.redis.keyPrefix ?? "gateway:cache:";

      return {
        async get(key) {
          await client.connect();
          const cached = await client.getBuffer(`${keyPrefix}${key}`);
          if (cached !== null) {
            return cached.toString("utf8");
          }
          if (memoryCache) {
            return memoryCache.get(key);
          }
          return null;
        },
        async set(key, value, ttl) {
          if (memoryCache) {
            await memoryCache.set(key, value, ttlSeconds);
          }
          await client.connect();
          await client.set(`${keyPrefix}${key}`, value, {
            EX: Math.max(ttl ?? ttlSeconds, 1),
          });
        },
        async shutdown() {
          await Promise.all([client.quit(), memoryCache?.shutdown?.()]);
        },
      };
    } catch (error) {
      log("cache-redis-init-error", { message: error.message });
    }
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
