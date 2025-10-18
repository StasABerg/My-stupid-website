import { z } from "zod";
import { config } from "./config.js";
import { fetchStationsFromS3, writeStationsToS3 } from "./s3.js";

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

async function fetchFromRadioBrowser() {
  const url = new URL(config.radioBrowser.stationsPath, config.radioBrowser.baseUrl);
  url.searchParams.set("hidebroken", "true");
  url.searchParams.set("order", "clickcount");
  url.searchParams.set("reverse", "true");
  if (config.radioBrowser.limit) {
    url.searchParams.set("limit", String(config.radioBrowser.limit));
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Radio Browser request failed: ${response.status}`);
  }
  const rawStations = await response.json();
  if (!Array.isArray(rawStations)) {
    throw new Error("Unexpected payload from Radio Browser API");
  }

  const stations = rawStations.map(normalizeStation);
  const payload = {
    updatedAt: new Date().toISOString(),
    source: url.toString(),
    total: stations.length,
    stations,
  };

  await writeStationsToS3(payload);
  return payload;
}

export async function getStationsFromS3() {
  return fetchStationsFromS3();
}

export async function refreshStations() {
  return fetchFromRadioBrowser();
}
