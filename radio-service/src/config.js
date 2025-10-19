import "dotenv/config";

const RADIO_BROWSER_DEFAULT_BASE_URL = "https://de2.api.radio-browser.info";
const RADIO_BROWSER_COUNTRIES_PATH = "/json/countries";
const RADIO_BROWSER_STATIONS_BY_COUNTRY_PATH = "/json/stations/bycountry";
const RADIO_BROWSER_STATION_CLICK_PATH = "/json/url";

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

export const config = {
  port: numberFromEnv(process.env.PORT, 4010),
  trustProxy: trustProxyFromEnv(process.env.TRUST_PROXY),
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
    countryPrefix: process.env.STATIONS_BY_COUNTRY_PREFIX ?? "stations/by-country",
  },
  radioBrowser: {
    defaultBaseUrl: RADIO_BROWSER_DEFAULT_BASE_URL,
    countriesPath: RADIO_BROWSER_COUNTRIES_PATH,
    stationsByCountryPath: RADIO_BROWSER_STATIONS_BY_COUNTRY_PATH,
    stationClickPath: RADIO_BROWSER_STATION_CLICK_PATH,
    limit: numberFromEnv(process.env.RADIO_BROWSER_LIMIT, 0),
    pageSize: numberFromEnv(process.env.RADIO_BROWSER_PAGE_SIZE, 0),
    maxPages: numberFromEnv(process.env.RADIO_BROWSER_MAX_PAGES, 0),
    userAgent: "My-stupid-website/1.0 (stasaberg)",
    countryConcurrency,
    enforceHttpsStreams,
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

  const radioBrowserUrls = [
    config.radioBrowser.countriesPath,
    config.radioBrowser.stationsByCountryPath,
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
