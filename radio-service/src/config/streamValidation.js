import { booleanFromEnv, numberFromEnv } from "./env.js";

export function buildStreamValidationConfig(env) {
  const enabledFlag = booleanFromEnv(env.STREAM_VALIDATION_ENABLED);
  const enabled = enabledFlag !== false;
  const timeoutCandidate = numberFromEnv(env.STREAM_VALIDATION_TIMEOUT_MS, 5000);
  const concurrencyCandidate = numberFromEnv(env.STREAM_VALIDATION_CONCURRENCY, 8);
  const cacheKey = env.STREAM_VALIDATION_CACHE_KEY ?? "radio:streams:validated";
  const cacheTtlCandidate = numberFromEnv(env.STREAM_VALIDATION_CACHE_TTL, 86400);

  return {
    enabled,
    timeoutMs: timeoutCandidate > 0 ? timeoutCandidate : 5000,
    concurrency: concurrencyCandidate > 0 ? concurrencyCandidate : 8,
    cacheKey,
    cacheTtlSeconds: cacheTtlCandidate > 0 ? cacheTtlCandidate : 86400,
  };
}

export function validateStreamValidationConfig(config) {
  if (config.concurrency <= 0) {
    throw new Error("STREAM_VALIDATION_CONCURRENCY must be greater than zero.");
  }
  if (config.timeoutMs <= 0) {
    throw new Error("STREAM_VALIDATION_TIMEOUT_MS must be greater than zero.");
  }
  if (!config.cacheKey || config.cacheKey.trim().length === 0) {
    throw new Error("STREAM_VALIDATION_CACHE_KEY must be provided.");
  }
}
