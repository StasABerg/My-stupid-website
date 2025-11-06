import crypto from "node:crypto";
import { logger } from "./logger.js";

const DEFAULT_PORT = 8080;
const DEFAULT_RADIO_BASE_URL =
  process.env.RADIO_SERVICE_URL ??
  "http://my-stupid-website-radio.my-stupid-website.svc.cluster.local:4010";
const DEFAULT_TERMINAL_BASE_URL =
  process.env.TERMINAL_SERVICE_URL ??
  "http://my-stupid-website-terminal.my-stupid-website.svc.cluster.local:80";
const DEFAULT_CACHE_TTL_SECONDS = 60;

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function splitList(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function extractHostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

const radioServiceUrl = DEFAULT_RADIO_BASE_URL.replace(/\/$/, "");
const terminalServiceUrl = DEFAULT_TERMINAL_BASE_URL.replace(/\/$/, "");
const explicitAllowedHosts = splitList(process.env.ALLOWED_SERVICE_HOSTNAMES);
const derivedHosts = [extractHostname(radioServiceUrl), extractHostname(terminalServiceUrl)].filter(
  (value) => value !== null,
);
const allowedServiceHostnames = Array.from(
  new Set([...derivedHosts, ...explicitAllowedHosts]),
);

function deriveSessionSecret(rawSecret) {
  const value = rawSecret?.trim();
  if (value && value.length >= 32) {
    return { value, generated: false };
  }

  const deterministicSeed = [
    process.env.INSTANCE_SECRET_SEED ?? "",
    DEFAULT_RADIO_BASE_URL,
    DEFAULT_TERMINAL_BASE_URL,
    process.env.NODE_ENV ?? "",
  ]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join("|");

  const generated = crypto.createHash("sha256").update(deterministicSeed).digest("hex");
  logger.warn("session.secret_ephemeral", {
    message:
      "SESSION_SECRET not provided or too short; deriving deterministic key from configuration. Provide SESSION_SECRET for stronger guarantees.",
  });
  return { value: generated, generated: true };
}

function parseDurationSeconds(value, fallbackSeconds) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSeconds;
}

function parseBoolean(value, fallback) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const derivedSessionSecret = deriveSessionSecret(process.env.SESSION_SECRET);

const redisUrlFromEnv = process.env.CACHE_REDIS_URL ?? process.env.REDIS_URL ?? "";
const cacheRedisEnabled = typeof redisUrlFromEnv === "string" && redisUrlFromEnv.trim().length > 0;

const sessionRedisUrlFromEnv = process.env.SESSION_REDIS_URL ?? "";
const sessionRedisUrlCandidate = typeof sessionRedisUrlFromEnv === "string" ? sessionRedisUrlFromEnv.trim() : "";
const sessionRedisUrlFallback = cacheRedisEnabled ? redisUrlFromEnv.trim() : "";
const sessionRedisUrl = sessionRedisUrlCandidate || sessionRedisUrlFallback;
const sessionRedisEnabled = sessionRedisUrl.length > 0;
const sessionRedisKeyPrefix = process.env.SESSION_REDIS_KEY_PREFIX?.trim() || "gateway:session:";
const sessionRedisConnectTimeoutMs = parsePositiveInt(
  process.env.SESSION_REDIS_CONNECT_TIMEOUT_MS,
  5000,
);
const sessionRedisTlsRejectUnauthorized = parseBoolean(
  process.env.SESSION_REDIS_TLS_REJECT_UNAUTHORIZED,
  true,
);

export const config = {
  port: parsePort(process.env.PORT, DEFAULT_PORT),
  radioServiceUrl,
  terminalServiceUrl,
  requestTimeoutMs: parsePort(process.env.UPSTREAM_TIMEOUT_MS, 10000),
  allowOrigins: splitList(process.env.CORS_ALLOW_ORIGINS),
  allowedServiceHostnames,
  session: {
    cookieName: process.env.SESSION_COOKIE_NAME?.trim() || "gateway.sid",
    secret: derivedSessionSecret.value,
    secretGenerated: derivedSessionSecret.generated,
    maxAgeMs:
      parseDurationSeconds(process.env.SESSION_MAX_AGE_SECONDS, 60 * 60 * 24 * 30) * 1000,
    store: {
      type: sessionRedisEnabled ? "redis" : "memory",
      redis: {
        enabled: sessionRedisEnabled,
        url: sessionRedisEnabled ? sessionRedisUrl : "",
        keyPrefix: sessionRedisKeyPrefix,
        connectTimeoutMs: sessionRedisConnectTimeoutMs,
        tlsRejectUnauthorized: sessionRedisTlsRejectUnauthorized,
      },
    },
  },
  cache: {
    ttlSeconds: parseDurationSeconds(process.env.CACHE_TTL_SECONDS, DEFAULT_CACHE_TTL_SECONDS),
    memory: {
      maxEntries: parsePositiveInt(process.env.CACHE_MEMORY_MAX_ENTRIES, 200),
      enabled: parseBoolean(process.env.CACHE_MEMORY_ENABLED, true),
    },
    redis: {
      enabled: cacheRedisEnabled,
      url: cacheRedisEnabled ? redisUrlFromEnv.trim() : "",
      keyPrefix: process.env.CACHE_KEY_PREFIX?.trim() || "gateway:cache:",
      connectTimeoutMs: parsePositiveInt(process.env.CACHE_REDIS_CONNECT_TIMEOUT_MS, 5000),
      tlsRejectUnauthorized: parseBoolean(
        process.env.CACHE_REDIS_TLS_REJECT_UNAUTHORIZED,
        true,
      ),
    },
  },
};
