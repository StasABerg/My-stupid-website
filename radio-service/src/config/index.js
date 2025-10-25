import "dotenv/config";
import { deriveTrustProxyValue, numberFromEnv } from "./env.js";
import { buildS3Config, validateS3Config } from "./s3.js";
import { buildRadioBrowserConfig, validateRadioBrowserConfig } from "./radioBrowser.js";
import { buildApiConfig, validateApiConfig } from "./api.js";
import { buildStreamProxyConfig, validateStreamProxyConfig } from "./streamProxy.js";
import {
  buildStreamValidationConfig,
  validateStreamValidationConfig,
} from "./streamValidation.js";

const allowInsecureTransports = process.env.ALLOW_INSECURE_TRANSPORT === "true";

const s3 = buildS3Config(process.env);
const radioBrowser = buildRadioBrowserConfig(process.env, allowInsecureTransports);
const api = buildApiConfig(process.env);
const streamProxy = buildStreamProxyConfig(process.env);
const streamValidation = buildStreamValidationConfig(process.env);

export const config = {
  port: numberFromEnv(process.env.PORT, 4010),
  trustProxy: deriveTrustProxyValue(process.env.TRUST_PROXY),
  redisUrl: process.env.REDIS_URL,
  cacheKey: process.env.STATIONS_CACHE_KEY ?? "radio:stations:all",
  cacheTtlSeconds: numberFromEnv(process.env.STATIONS_CACHE_TTL, 900),
  memoryCacheTtlSeconds: numberFromEnv(process.env.STATIONS_MEMORY_CACHE_TTL, 5),
  s3,
  radioBrowser,
  api,
  streamProxy,
  streamValidation,
  refreshToken: process.env.STATIONS_REFRESH_TOKEN ?? "",
  allowInsecureTransports,
};

export function validateConfig() {
  if (!config.redisUrl) {
    throw new Error("REDIS_URL must be provided so the service can populate the cache.");
  }

  validateS3Config(config.s3, config.allowInsecureTransports);
  validateRadioBrowserConfig(config.radioBrowser, config.allowInsecureTransports);
  validateApiConfig(config.api);
  validateStreamProxyConfig(config.streamProxy);
  validateStreamValidationConfig(config.streamValidation);

  let redisUrl;
  try {
    redisUrl = new URL(config.redisUrl);
  } catch (error) {
    throw new Error(`Invalid REDIS_URL provided: ${error.message}`);
  }

  if (redisUrl.protocol !== "rediss:" && config.allowInsecureTransports !== true) {
    throw new Error(
      "REDIS_URL must use TLS (rediss://). Set ALLOW_INSECURE_TRANSPORT=true to bypass in trusted environments.",
    );
  }

  if (!config.refreshToken) {
    throw new Error(
      "STATIONS_REFRESH_TOKEN must be configured to protect the refresh endpoint.",
    );
  }

  if (
    Number.isFinite(config.memoryCacheTtlSeconds) &&
    config.memoryCacheTtlSeconds < 0
  ) {
    throw new Error("STATIONS_MEMORY_CACHE_TTL must be zero or a positive integer.");
  }
}
