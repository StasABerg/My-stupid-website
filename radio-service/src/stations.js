import { z } from "zod";
import { config } from "./config.js";
import {
  buildRadioBrowserUrl,
  getRadioBrowserBaseUrl,
  rotateRadioBrowserBaseUrl,
} from "./radioBrowser.js";
import { fetchStationsFromS3, writeStationsByCountryToS3, writeStationsToS3 } from "./s3.js";

const stationSchema = z.object({
  stationuuid: z.string(),
  name: z.string().min(1),
  url: z.string().url().or(z.string().min(1)),
  url_resolved: z.string().optional(),
  homepage: z.string().nullable().optional(),
  favicon: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  countrycode: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  geo_lat: z.coerce.number().nullable().optional(),
  geo_long: z.coerce.number().nullable().optional(),
  bitrate: z.coerce.number().nullable().optional(),
  codec: z.string().nullable().optional(),
  lastcheckok: z.coerce.number().nullable().optional(),
  lastchecktime: z.string().nullable().optional(),
  lastchangetime: z.string().nullable().optional(),
  clickcount: z.coerce.number().nullable().optional(),
  clicktrend: z.coerce.number().nullable().optional(),
  votes: z.coerce.number().nullable().optional(),
  hls: z.coerce.number().nullable().optional(),
});

const countrySchema = z.object({
  name: z.string().min(1),
  iso_3166_1: z.string().nullable().optional(),
  stationcount: z.union([z.string(), z.number()]),
});

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

function normalizeList(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeStation(station) {
  const data = stationSchema.parse(station);

  return {
    id: data.stationuuid,
    name: data.name,
    streamUrl: data.url_resolved && data.url_resolved.length > 0 ? data.url_resolved : data.url,
    homepage: data.homepage ?? null,
    favicon: data.favicon ?? null,
    country: data.country ?? null,
    countryCode: data.countrycode?.toUpperCase() ?? null,
    state: data.state ?? null,
    languages: normalizeList(data.language),
    tags: normalizeList(data.tags),
    coordinates:
      typeof data.geo_lat === "number" && typeof data.geo_long === "number"
        ? { lat: data.geo_lat, lon: data.geo_long }
        : null,
    bitrate: typeof data.bitrate === "number" ? data.bitrate : null,
    codec: data.codec ?? null,
    hls: data.hls === 1,
    isOnline: data.lastcheckok === 1,
    lastCheckedAt: data.lastchecktime ?? null,
    lastChangedAt: data.lastchangetime ?? null,
    clickCount: typeof data.clickcount === "number" ? data.clickcount : 0,
    clickTrend: typeof data.clicktrend === "number" ? data.clicktrend : 0,
    votes: typeof data.votes === "number" ? data.votes : 0,
  };
}

function buildDefaultHeaders() {
  return {
    "User-Agent": config.radioBrowser.userAgent,
    Accept: "application/json",
  };
}

function normalizeCountry(country) {
  const data = countrySchema.parse(country);
  const count = Number.parseInt(String(data.stationcount ?? "0"), 10);
  return {
    name: data.name,
    code: data.iso_3166_1 ?? null,
    stationCount: Number.isFinite(count) && count > 0 ? count : 0,
  };
}

async function fetchCountries() {
  return withRotatingRadioBrowserHost(async (baseUrl) => {
    const url = await buildRadioBrowserUrl(config.radioBrowser.countriesPath, { baseUrl });

    let response;
    try {
      response = await fetch(url, {
        headers: buildDefaultHeaders(),
      });
    } catch (error) {
      throw new RadioBrowserRequestError(
        `Radio Browser countries request failed: ${error.message} for ${url.toString()}`,
      );
    }

    if (!response.ok) {
      throw new RadioBrowserRequestError(
        `Radio Browser countries request failed: ${response.status} for ${url.toString()}`,
      );
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("Unexpected countries payload from Radio Browser API");
    }

    return {
      countries: payload.map(normalizeCountry),
      requestUrl: url.toString(),
    };
  });
}

async function buildStationsByCountryUrl(countryName, { baseUrl }) {
  const basePath = config.radioBrowser.stationsByCountryPath.replace(/\/$/, "");
  return buildRadioBrowserUrl(`${basePath}/${encodeURIComponent(countryName)}`, { baseUrl });
}

async function fetchStationsForCountry(countryName) {
  return withRotatingRadioBrowserHost(async (baseUrl) => {
    const url = await buildStationsByCountryUrl(countryName, { baseUrl });
    url.searchParams.set("hidebroken", "true");
    url.searchParams.set("order", "clickcount");
    url.searchParams.set("reverse", "true");

    let response;
    try {
      response = await fetch(url, {
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

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildCountryGroups(stations) {
  const groups = new Map();

  for (const station of stations) {
    const countryCode = station.countryCode ?? null;
    const countryName = station.country ?? null;
    const baseKey = countryCode ? countryCode.toLowerCase() : slugify(countryName ?? "unknown");
    const key = baseKey.length > 0 ? baseKey : "unknown";

    if (!groups.has(key)) {
      groups.set(key, {
        code: countryCode,
        name: countryName,
        stations: [],
      });
    } else {
      const group = groups.get(key);
      if (!group.code && countryCode) {
        group.code = countryCode;
      }
      if (!group.name && countryName) {
        group.name = countryName;
      }
    }

    groups.get(key).stations.push(station);
  }

  return groups;
}

async function fetchFromRadioBrowser() {
  const { countries, requestUrl: countriesRequestUrl } = await fetchCountries();
  const sortedCountries = countries
    .filter((country) => country.stationCount > 0)
    .sort((a, b) => b.stationCount - a.stationCount);

  const stations = [];
  const requestUrls = [countriesRequestUrl];

  const maxStations =
    Number.isFinite(config.radioBrowser.limit) && config.radioBrowser.limit > 0
      ? config.radioBrowser.limit
      : Number.POSITIVE_INFINITY;
  const maxCountries =
    Number.isFinite(config.radioBrowser.maxPages) && config.radioBrowser.maxPages > 0
      ? config.radioBrowser.maxPages
      : Number.POSITIVE_INFINITY;
  const perCountryLimit =
    Number.isFinite(config.radioBrowser.pageSize) && config.radioBrowser.pageSize > 0
      ? Math.max(1, config.radioBrowser.pageSize)
      : Number.POSITIVE_INFINITY;

  let processedCountries = 0;

  for (const country of sortedCountries) {
    if (stations.length >= maxStations || processedCountries >= maxCountries) {
      break;
    }

    const { rawStations, requestUrl } = await fetchStationsForCountry(country.name);
    requestUrls.push(requestUrl);
    processedCountries += 1;

    const limitedStations =
      perCountryLimit === Number.POSITIVE_INFINITY
        ? rawStations
        : rawStations.slice(0, perCountryLimit);

    for (const station of limitedStations) {
      if (stations.length >= maxStations) {
        break;
      }
      stations.push(normalizeStation(station));
    }
  }

  if (stations.length === 0) {
    throw new Error("Radio Browser API returned no stations");
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    source: countriesRequestUrl,
    requests: requestUrls,
    total: stations.length,
    stations,
  };

  await writeStationsToS3(payload);
  await writeStationsByCountryToS3(payload, buildCountryGroups(stations));
  return payload;
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
      response = await fetch(url, {
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

export async function getStationsFromS3() {
  return fetchStationsFromS3();
}

export async function refreshStations() {
  return fetchFromRadioBrowser();
}
