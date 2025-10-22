import { booleanFromEnv, numberFromEnv } from "./env.js";

const RADIO_BROWSER_DEFAULT_BASE_URL = "https://de2.api.radio-browser.info";
const RADIO_BROWSER_STATIONS_PATH = "/json/stations";
const RADIO_BROWSER_STATION_CLICK_PATH = "/json/url";

export function buildRadioBrowserConfig(env, allowInsecureTransports) {
  const forceHttpsStreamsFlag = booleanFromEnv(env.RADIO_BROWSER_FORCE_HTTPS_STREAMS);
  const enforceHttpsStreams =
    forceHttpsStreamsFlag === null ? !allowInsecureTransports : forceHttpsStreamsFlag;
  const countryConcurrencyCandidate = numberFromEnv(
    env.RADIO_BROWSER_COUNTRY_CONCURRENCY,
    4,
  );
  const countryConcurrency =
    countryConcurrencyCandidate > 0 ? countryConcurrencyCandidate : 4;

  return {
    defaultBaseUrl: RADIO_BROWSER_DEFAULT_BASE_URL,
    stationsPath: RADIO_BROWSER_STATIONS_PATH,
    stationClickPath: RADIO_BROWSER_STATION_CLICK_PATH,
    limit: numberFromEnv(env.RADIO_BROWSER_LIMIT, 0),
    pageSize: numberFromEnv(env.RADIO_BROWSER_PAGE_SIZE, 0),
    maxPages: numberFromEnv(env.RADIO_BROWSER_MAX_PAGES, 0),
    userAgent: "My-stupid-website/1.0 (stasaberg)",
    countryConcurrency,
    enforceHttpsStreams,
  };
}

export function validateRadioBrowserConfig(config, allowInsecureTransports) {
  if (config.pageSize < 0) {
    throw new Error("RADIO_BROWSER_PAGE_SIZE cannot be negative.");
  }
  if (config.maxPages < 0) {
    throw new Error("RADIO_BROWSER_MAX_PAGES cannot be negative.");
  }
  if (config.limit < 0) {
    throw new Error("RADIO_BROWSER_LIMIT cannot be negative.");
  }
  if (config.countryConcurrency <= 0) {
    throw new Error("RADIO_BROWSER_COUNTRY_CONCURRENCY must be greater than zero.");
  }
  if (!config.userAgent || config.userAgent.trim().length === 0) {
    throw new Error("A Radio Browser user agent must be provided for outbound requests.");
  }

  const radioBrowserUrls = [config.stationsPath, config.stationClickPath].map((path) => {
    try {
      return new URL(path, config.defaultBaseUrl);
    } catch (error) {
      throw new Error(`Invalid Radio Browser API URL provided: ${error.message}`);
    }
  });

  for (const url of radioBrowserUrls) {
    if (url.protocol !== "https:" && allowInsecureTransports !== true) {
      throw new Error(
        "Radio Browser endpoints must use HTTPS. Set ALLOW_INSECURE_TRANSPORT=true to bypass in trusted environments.",
      );
    }
  }
}
