import { GlideClient, Logger, TimeUnit } from "@valkey/valkey-glide";

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

function buildClientOptions(redisUrl, config) {
  const url = new URL(redisUrl);
  const port = url.port ? Number.parseInt(url.port, 10) : 6379;
  const options = {
    addresses: [{ host: url.hostname, port }],
  };
  if (url.username) {
    options.username = decodeURIComponent(url.username);
  }
  if (url.password) {
    options.password = decodeURIComponent(url.password);
  }
  if (url.pathname && url.pathname !== "/") {
    const db = Number.parseInt(url.pathname.slice(1), 10);
    if (Number.isFinite(db) && db >= 0) {
      options.database = db;
    }
  }
  if (url.protocol === "rediss:") {
    options.tls = {
      rejectUnauthorized: config.redis.tlsRejectUnauthorized !== false,
    };
  }
  return options;
}

export function createCache(config) {
  try {
    Logger.setLoggerConfig("OFF", undefined, { useSharedLogger: false, logToConsole: false });
  } catch (error) {
    try {
      Logger.init("OFF", undefined, { useSharedLogger: false, logToConsole: false });
    } catch (innerError) {
      log("valkey-logger-init-error", { message: innerError.message || error.message });
    }
  }
  const ttlSeconds = Math.max(config.ttlSeconds ?? 0, 0);
  const maxEntries = Math.max(config.memory?.maxEntries ?? 200, 10);

  let memoryCache = null;
  if (config.memory?.enabled !== false) {
    memoryCache = new MemoryCache({ ttlSeconds, maxEntries });
  }

  if (config.redis?.enabled) {
    const redisUrl = config.redis.url;
    try {
      const clientPromise = GlideClient.createClient({
        ...buildClientOptions(redisUrl, config),
      });
      const wrappedClientPromise = clientPromise.then((client) => {
        client.on("error", (error) => log("cache-redis-error", { message: error.message }));
        log("cache-redis-ready", { keyPrefix: config.redis.keyPrefix });
        return client;
      });
      const keyPrefix = config.redis.keyPrefix ?? "gateway:cache:";
      return {
        async get(key) {
          try {
            const client = await wrappedClientPromise;
            const cached = await client.get(`${keyPrefix}${key}`);
            if (cached !== null) {
              return cached;
            }
          } catch (error) {
            log("cache-redis-get-error", { message: error.message });
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
          try {
            const client = await wrappedClientPromise;
            const effectiveTtl = Math.max(ttl ?? ttlSeconds, 0);
            if (effectiveTtl > 0) {
              await client.set(`${keyPrefix}${key}`, value, {
                expiry: { type: TimeUnit.Seconds, count: effectiveTtl },
              });
            } else {
              await client.set(`${keyPrefix}${key}`, value);
            }
          } catch (error) {
            log("cache-redis-set-error", { message: error.message });
          }
        },
        async shutdown() {
          try {
            const client = await wrappedClientPromise;
            await client.close();
          } catch (error) {
            log("cache-redis-shutdown-error", { message: error.message });
          }
          await memoryCache?.shutdown?.();
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
