import { numberFromEnv } from "./env.js";

export function buildApiConfig(env) {
  const defaultPageSizeCandidate = numberFromEnv(env.API_DEFAULT_PAGE_SIZE, 50);
  const maxPageSizeCandidate = numberFromEnv(env.API_MAX_PAGE_SIZE, 100);
  const defaultPageSize = defaultPageSizeCandidate > 0 ? defaultPageSizeCandidate : 50;
  const maxPageSize = maxPageSizeCandidate > 0 ? maxPageSizeCandidate : 100;

  return {
    defaultPageSize: Math.min(defaultPageSize, maxPageSize),
    maxPageSize,
  };
}

export function validateApiConfig(config) {
  if (config.maxPageSize <= 0) {
    throw new Error("API_MAX_PAGE_SIZE must be greater than zero.");
  }
  if (config.defaultPageSize <= 0) {
    throw new Error("API_DEFAULT_PAGE_SIZE must be greater than zero.");
  }
  if (config.defaultPageSize > config.maxPageSize) {
    throw new Error("API_DEFAULT_PAGE_SIZE cannot exceed API_MAX_PAGE_SIZE.");
  }
}
