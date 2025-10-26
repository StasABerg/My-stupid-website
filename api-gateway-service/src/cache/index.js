import { GlideClient } from "@valkey/valkey-glide";

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
  const valkeyModule = await import("@valkey/valkey-glide");
  const createClient =
    typeof valkeyModule.createClient === "function"
      ? valkeyModule.createClient
      : typeof valkeyModule.default === "function"
        ? valkeyModule.default
        : typeof valkeyModule.default?.createClient === "function"
          ? valkeyModule.default.createClient
          : null;

  if (!createClient) {
    const exportedKeys = Object.keys(valkeyModule || {});
    const defaultKeys = Object.keys(valkeyModule?.default || {});
    throw new Error(
      `Unable to resolve createClient from @valkey/valkey-glide (exports: ${exportedKeys.join(
        ", ",
      )}; default exports: ${defaultKeys.join(", ")})`,
    );
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
      const useTls = redisUrl.startsWith("rediss://");
      const client = new GlideClient(redisUrl, {
        tls: useTls
          ? {
              rejectUnauthorized: config.redis.tlsRejectUnauthorized !== false,
            }
          : undefined,
      });
      client.on("error", (error) => log("cache-redis-error", { message: error.message }));
      client.on("ready", () => log("cache-redis-ready", { keyPrefix: config.redis.keyPrefix }));

      const keyPrefix = config.redis.keyPrefix ?? "gateway:cache:";
      let connectPromise = null;
      const ensureConnected = async () => {
        if (client.isReady) {
          return;
        }
        if (!connectPromise) {
          connectPromise = client.connect().finally(() => {
            connectPromise = null;
          });
        }
        await connectPromise;
      };

      return {
        async get(key) {
          await ensureConnected();
          const cached = await client.get(`${keyPrefix}${key}`);
          if (cached !== null) {
            return cached;
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
          await ensureConnected();
          await client.set(`${keyPrefix}${key}`, value, {
            EX: Math.max(ttl ?? ttlSeconds, 1),
          });
        },
        async shutdown() {
          try {
            if (client.isOpen || client.isReady) {
              await client.quit();
            } else {
              await client.disconnect();
            }
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
