import "dotenv/config";

const RADIO_BROWSER_DEFAULT_BASE_URL = "https://de2.api.radio-browser.info";
const RADIO_BROWSER_STATIONS_PATH = "/json/stations";
const RADIO_BROWSER_STATION_CLICK_PATH = "/json/url";

function deriveMetadataKey(objectKey) {
  if (!objectKey) {
    return null;
  }
  const trimmed = objectKey.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.toLowerCase().endsWith(".json")) {
    return `${trimmed.slice(0, -5)}-metadata.json`;
  }
  return `${trimmed}-metadata.json`;
}

function numberFromEnv(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanFromEnv(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function trustProxyFromEnv(value) {
  if (value === undefined || value === null) {
    return true;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  const asNumber = Number.parseInt(trimmed, 10);
  if (Number.isFinite(asNumber) && String(asNumber) === trimmed) {
    return asNumber;
  }
  if (trimmed.includes(",")) {
    const parts = trimmed
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return parts.length > 0 ? parts : true;
  }
  return trimmed;
}

const allowInsecureTransports = process.env.ALLOW_INSECURE_TRANSPORT === "true";
const forceHttpsStreamsFlag = booleanFromEnv(process.env.RADIO_BROWSER_FORCE_HTTPS_STREAMS);
const enforceHttpsStreams =
  forceHttpsStreamsFlag === null ? !allowInsecureTransports : forceHttpsStreamsFlag;
const countryConcurrencyCandidate = numberFromEnv(
  process.env.RADIO_BROWSER_COUNTRY_CONCURRENCY,
  4,
);
const countryConcurrency = countryConcurrencyCandidate > 0 ? countryConcurrencyCandidate : 4;

function deriveTrustProxyValue(rawValue) {
  const baseValue = trustProxyFromEnv(rawValue);
  const clusterCidr = "10.42.0.0/16";

  if (baseValue === false) {
    return [clusterCidr];
  }

  if (baseValue === true) {
    return true;
  }

  if (typeof baseValue === "number") {
    return [baseValue, clusterCidr];
  }

  if (typeof baseValue === "string") {
    const parsed = baseValue
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    parsed.push(clusterCidr);
    return parsed;
  }

  if (Array.isArray(baseValue)) {
    return [...baseValue, clusterCidr];
  }

  return [clusterCidr];
}
const apiDefaultPageSizeCandidate = numberFromEnv(process.env.API_DEFAULT_PAGE_SIZE, 50);
const apiMaxPageSizeCandidate = numberFromEnv(process.env.API_MAX_PAGE_SIZE, 100);
const apiDefaultPageSize =
  apiDefaultPageSizeCandidate > 0 ? apiDefaultPageSizeCandidate : 50;
const apiMaxPageSize = apiMaxPageSizeCandidate > 0 ? apiMaxPageSizeCandidate : 100;
const streamProxyTimeoutCandidate = numberFromEnv(process.env.STREAM_PROXY_TIMEOUT_MS, 15000);
const streamProxyTimeoutMs =
  streamProxyTimeoutCandidate > 0 ? streamProxyTimeoutCandidate : 15000;
const streamValidationEnabledFlag = booleanFromEnv(process.env.STREAM_VALIDATION_ENABLED);
const streamValidationEnabled = streamValidationEnabledFlag !== false;
const streamValidationTimeoutCandidate = numberFromEnv(
  process.env.STREAM_VALIDATION_TIMEOUT_MS,
  5000,
);
const streamValidationTimeoutMs =
  streamValidationTimeoutCandidate > 0 ? streamValidationTimeoutCandidate : 5000;
const streamValidationConcurrencyCandidate = numberFromEnv(
  process.env.STREAM_VALIDATION_CONCURRENCY,
  8,
);
const streamValidationConcurrency =
  streamValidationConcurrencyCandidate > 0 ? streamValidationConcurrencyCandidate : 8;

export const config = {
  port: numberFromEnv(process.env.PORT, 4010),
  trustProxy: deriveTrustProxyValue(process.env.TRUST_PROXY),
  redisUrl: process.env.REDIS_URL,
  cacheKey: process.env.STATIONS_CACHE_KEY ?? "radio:stations:all",
  cacheTtlSeconds: numberFromEnv(process.env.STATIONS_CACHE_TTL, 900),
  s3: {
    endpoint: process.env.MINIO_ENDPOINT,
    region: process.env.MINIO_REGION,
    accessKeyId:
      process.env.MINIO_ACCESS_KEY ?? process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey:
      process.env.MINIO_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY,
    bucket: process.env.MINIO_BUCKET,
    objectKey: process.env.STATIONS_OBJECT_KEY,
    metadataKey:
      process.env.STATIONS_METADATA_OBJECT_KEY ??
      deriveMetadataKey(process.env.STATIONS_OBJECT_KEY),
    countryPrefix: process.env.STATIONS_BY_COUNTRY_PREFIX ?? "stations/by-country",
  },
  radioBrowser: {
    defaultBaseUrl: RADIO_BROWSER_DEFAULT_BASE_URL,
    stationsPath: RADIO_BROWSER_STATIONS_PATH,
    stationClickPath: RADIO_BROWSER_STATION_CLICK_PATH,
    limit: numberFromEnv(process.env.RADIO_BROWSER_LIMIT, 0),
    pageSize: numberFromEnv(process.env.RADIO_BROWSER_PAGE_SIZE, 0),
    maxPages: numberFromEnv(process.env.RADIO_BROWSER_MAX_PAGES, 0),
    userAgent: "My-stupid-website/1.0 (stasaberg)",
    countryConcurrency,
    enforceHttpsStreams,
  },
  api: {
    defaultPageSize: Math.min(apiDefaultPageSize, apiMaxPageSize),
    maxPageSize: apiMaxPageSize,
  },
  streamProxy: {
    timeoutMs: streamProxyTimeoutMs,
  },
  streamValidation: {
    enabled: streamValidationEnabled,
    timeoutMs: streamValidationTimeoutMs,
    concurrency: streamValidationConcurrency,
  },
  refreshToken: process.env.STATIONS_REFRESH_TOKEN ?? "",
  allowInsecureTransports,
};

export function validateConfig() {
  if (!config.redisUrl) {
    throw new Error("REDIS_URL must be provided so the service can populate the cache.");
  }
  if (!config.s3.accessKeyId || !config.s3.secretAccessKey) {
    throw new Error(
      "MINIO_ACCESS_KEY and MINIO_SECRET_KEY (or AWS_* equivalents) must be set to reach the station artifacts bucket.",
    );
  }
  if (!config.s3.bucket) {
    throw new Error("MINIO_BUCKET must be specified so the service knows where to store stations.");
  }
  if (!config.s3.endpoint) {
    throw new Error("MINIO_ENDPOINT must be provided so the service can reach the object store.");
  }
  if (!config.s3.metadataKey) {
    throw new Error(
      "STATIONS_METADATA_OBJECT_KEY (or a derivable value) must be set so station metadata can be stored separately.",
    );
  }
  if (config.radioBrowser.pageSize < 0) {
    throw new Error("RADIO_BROWSER_PAGE_SIZE cannot be negative.");
  }
  if (config.radioBrowser.maxPages < 0) {
    throw new Error("RADIO_BROWSER_MAX_PAGES cannot be negative.");
  }
  if (config.radioBrowser.limit < 0) {
    throw new Error("RADIO_BROWSER_LIMIT cannot be negative.");
  }
  if (config.radioBrowser.countryConcurrency <= 0) {
    throw new Error("RADIO_BROWSER_COUNTRY_CONCURRENCY must be greater than zero.");
  }
  if (!config.radioBrowser.userAgent || config.radioBrowser.userAgent.trim().length === 0) {
    throw new Error("A Radio Browser user agent must be provided for outbound requests.");
  }
  if (config.api.maxPageSize <= 0) {
    throw new Error("API_MAX_PAGE_SIZE must be greater than zero.");
  }
  if (config.api.defaultPageSize <= 0) {
    throw new Error("API_DEFAULT_PAGE_SIZE must be greater than zero.");
  }
  if (config.api.defaultPageSize > config.api.maxPageSize) {
    throw new Error("API_DEFAULT_PAGE_SIZE cannot exceed API_MAX_PAGE_SIZE.");
  }
  if (config.streamProxy.timeoutMs <= 0) {
    throw new Error("STREAM_PROXY_TIMEOUT_MS must be greater than zero.");
  }
  if (config.streamValidation.concurrency <= 0) {
    throw new Error("STREAM_VALIDATION_CONCURRENCY must be greater than zero.");
  }
  if (config.streamValidation.timeoutMs <= 0) {
    throw new Error("STREAM_VALIDATION_TIMEOUT_MS must be greater than zero.");
  }

  const radioBrowserUrls = [
    config.radioBrowser.stationsPath,
    config.radioBrowser.stationClickPath,
  ].map((path) => {
    try {
      return new URL(path, config.radioBrowser.defaultBaseUrl);
    } catch (error) {
      throw new Error(`Invalid Radio Browser API URL provided: ${error.message}`);
    }
  });

  for (const url of radioBrowserUrls) {
    if (url.protocol !== "https:" && config.allowInsecureTransports !== true) {
      throw new Error(
        "Radio Browser endpoints must use HTTPS. Set ALLOW_INSECURE_TRANSPORT=true to bypass in trusted environments.",
      );
    }
  }
  if (!config.refreshToken) {
    throw new Error(
      "STATIONS_REFRESH_TOKEN must be configured to protect the refresh endpoint.",
    );
  }

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

  let s3Endpoint;
  try {
    s3Endpoint = new URL(config.s3.endpoint);
  } catch (error) {
    throw new Error(`Invalid MINIO_ENDPOINT provided: ${error.message}`);
  }

  if (s3Endpoint.protocol !== "https:" && config.allowInsecureTransports !== true) {
    throw new Error(
      "MINIO_ENDPOINT must use HTTPS. Set ALLOW_INSECURE_TRANSPORT=true to bypass in trusted environments.",
    );
  }
}
