import { config } from "../config/index.js";

const CLOCK_SKEW_MS = 50;

const state = {
  payload: null,
  cacheSource: null,
  expiresAt: 0,
  fingerprint: null,
};

function now() {
  return Date.now();
}

export function getStationsFromMemory() {
  if (!state.payload) {
    return null;
  }

  if (now() + CLOCK_SKEW_MS >= state.expiresAt) {
    return null;
  }

  return {
    payload: state.payload,
    cacheSource: state.cacheSource,
    fingerprint: state.fingerprint,
  };
}

export function cacheStationsInMemory({ payload, cacheSource, fingerprint }) {
  const ttlSeconds =
    Number.isFinite(config.memoryCacheTtlSeconds) && config.memoryCacheTtlSeconds > 0
      ? config.memoryCacheTtlSeconds
      : 0;

  if (ttlSeconds === 0) {
    clearStationsMemoryCache();
    return;
  }

  state.payload = payload;
  state.cacheSource = cacheSource;
  state.fingerprint = fingerprint ?? null;
  state.expiresAt = now() + ttlSeconds * 1000;
}

export function clearStationsMemoryCache() {
  state.payload = null;
  state.cacheSource = null;
  state.fingerprint = null;
  state.expiresAt = 0;
}
