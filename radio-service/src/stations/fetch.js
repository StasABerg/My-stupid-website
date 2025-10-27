import { config } from "../config/index.js";
import { logger } from "../logger.js";
import {
  buildRadioBrowserUrl,
  getRadioBrowserBaseUrl,
  rotateRadioBrowserBaseUrl,
} from "../radioBrowser.js";
import { fetchWithKeepAlive } from "../http/client.js";
import { buildCountryGroups, buildStationsFingerprint, normalizeStation } from "./normalize.js";
import { SCHEMA_VERSION } from "./schemas.js";
import { validateStationStreams } from "./validation.js";

class RadioBrowserRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "RadioBrowserRequestError";
  }
}

async function withRotatingRadioBrowserHost(executor) {
  const attempted = new Set();
  let lastError;

  // Loop until we have tried every known host once.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const baseUrl = await getRadioBrowserBaseUrl();
    if (attempted.has(baseUrl)) {
      break;
    }

    attempted.add(baseUrl);

    try {
      return await executor(baseUrl);
    } catch (error) {
      if (!(error instanceof RadioBrowserRequestError)) {
        throw error;
      }
      lastError = error;
      await rotateRadioBrowserBaseUrl();
    }
  }

  throw lastError ?? new RadioBrowserRequestError("All Radio Browser endpoints failed.");
}

function buildDefaultHeaders() {
  return {
    "User-Agent": config.radioBrowser.userAgent,
    Accept: "application/json",
  };
}

async function buildStationsUrl({ baseUrl }) {
  const url = await buildRadioBrowserUrl(config.radioBrowser.stationsPath, { baseUrl });
  url.searchParams.set("hidebroken", "true");
  url.searchParams.set("order", "clickcount");
  url.searchParams.set("reverse", "true");
  url.searchParams.set("lastcheckok", "1");
  url.searchParams.set("ssl_error", "0");

  if (Number.isFinite(config.radioBrowser.limit) && config.radioBrowser.limit > 0) {
    url.searchParams.set("limit", String(config.radioBrowser.limit));
  }

  return url;
}

async function fetchStations() {
  return withRotatingRadioBrowserHost(async (baseUrl) => {
    const url = await buildStationsUrl({ baseUrl });

    let response;
    try {
      response = await fetchWithKeepAlive(url, {
        headers: buildDefaultHeaders(),
      });
    } catch (error) {
      throw new RadioBrowserRequestError(
        `Radio Browser stations request failed: ${error.message} for ${url.toString()}`,
      );
    }

    if (!response.ok) {
      throw new RadioBrowserRequestError(
        `Radio Browser stations request failed: ${response.status} for ${url.toString()}`,
      );
    }

    const rawStations = await response.json();
    if (!Array.isArray(rawStations)) {
      throw new Error("Unexpected stations payload from Radio Browser API");
    }

    return { rawStations, requestUrl: url.toString() };
  });
}

export async function fetchFromRadioBrowser({ redis } = {}) {
  const { rawStations, requestUrl } = await fetchStations();
  const requestUrls = [requestUrl];

  const stations = [];
  let filteredStations = 0;

  const maxStations =
    Number.isFinite(config.radioBrowser.limit) && config.radioBrowser.limit > 0
      ? config.radioBrowser.limit
      : Number.POSITIVE_INFINITY;

  for (const station of rawStations) {
    if (stations.length >= maxStations) {
      break;
    }

    const normalized = normalizeStation(station);
    if (normalized) {
      stations.push(normalized);
    } else {
      filteredStations += 1;
    }
  }

  let validationDrops = 0;
  let finalStations = stations;
  if (config.streamValidation.enabled) {
    const { stations: validatedStations, dropped, reasons } =
      await validateStationStreams(stations, { redis });
    validationDrops = dropped;
    finalStations = validatedStations;
    if (validationDrops > 0) {
      logger.info("stream.validation", { dropped: validationDrops, reasons });
    }
  }

  if (finalStations.length === 0) {
    throw new Error("Radio Browser API returned no stations");
  }

  if (filteredStations > 0 || validationDrops > 0) {
    logger.info("stations.filtered", {
      droppedNormalizing: filteredStations,
      droppedValidation: validationDrops,
    });
  }

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    source: requestUrl,
    requests: requestUrls,
    total: finalStations.length,
    stations: finalStations,
  };

  const countryGroups = buildCountryGroups(finalStations);

  const fingerprint = buildStationsFingerprint(finalStations);

  return { payload, countryGroups, fingerprint };
}

async function buildStationClickUrl(stationUuid, { baseUrl }) {
  const basePath = config.radioBrowser.stationClickPath.replace(/\/$/, "");
  return buildRadioBrowserUrl(`${basePath}/${encodeURIComponent(stationUuid)}`, { baseUrl });
}

export async function notifyStationClick(stationUuid) {
  if (!stationUuid || stationUuid.trim().length === 0) {
    throw new Error("A station UUID is required to record a click.");
  }

  return withRotatingRadioBrowserHost(async (baseUrl) => {
    const url = await buildStationClickUrl(stationUuid, { baseUrl });

    let response;
    try {
      response = await fetchWithKeepAlive(url, {
        headers: buildDefaultHeaders(),
      });
    } catch (error) {
      throw new RadioBrowserRequestError(
        `Radio Browser click request failed: ${error.message} for ${url.toString()}`,
      );
    }

    if (!response.ok) {
      throw new RadioBrowserRequestError(
        `Radio Browser click request failed: ${response.status} for ${url.toString()}`,
      );
    }

    const payload = await response.json();
    if (!payload || (payload.ok !== "true" && payload.ok !== true)) {
      throw new Error("Radio Browser did not confirm the click event.");
    }

    return payload;
  });
}
