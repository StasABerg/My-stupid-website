import { numberFromEnv } from "./env.js";

export function buildStreamProxyConfig(env) {
  const timeoutCandidate = numberFromEnv(env.STREAM_PROXY_TIMEOUT_MS, 15000);
  return {
    timeoutMs: timeoutCandidate > 0 ? timeoutCandidate : 15000,
  };
}

export function validateStreamProxyConfig(config) {
  if (config.timeoutMs <= 0) {
    throw new Error("STREAM_PROXY_TIMEOUT_MS must be greater than zero.");
  }
}
