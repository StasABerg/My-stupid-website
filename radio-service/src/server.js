import express from "express";
import rateLimit from "express-rate-limit";
import { config, validateConfig } from "./config.js";
import { createRedisClient } from "./redis.js";
import { loadStations, recordStationClick, updateStations } from "./service.js";

validateConfig();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", config.trustProxy);
app.use(express.json({ limit: "100kb" }));

// Rate limiter: maximum of 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable the X-RateLimit-* headers
  skip: (req) => req.path === "/healthz",
});
app.use(limiter);

const redis = createRedisClient();

async function ensureRedis() {
  if (redis.status !== "ready") {
    await redis.connect();
  }
}

async function getStationsPayload(redisClient) {
  const { payload } = await loadStations(redisClient, { forceRefresh: false });
  return payload;
}

async function findStationById(redisClient, stationId) {
  const payload = await getStationsPayload(redisClient);
  const stations = Array.isArray(payload?.stations) ? payload.stations : [];
  const station = stations.find((item) => item.id === stationId);
  return station ? { station, payload } : { station: null, payload };
}

function shouldTreatAsPlaylist(streamUrl, contentType) {
  if (contentType) {
    const lowerType = contentType.toLowerCase();
    if (lowerType.includes("application/vnd.apple.mpegurl") || lowerType.includes("application/x-mpegurl")) {
      return true;
    }
  }
  try {
    const parsed = new URL(streamUrl);
    return /\.m3u8($|\?)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function rewritePlaylist(streamUrl, playlist) {
  const baseUrl = new URL(streamUrl);
  const lines = playlist.split(/\r?\n/);
  const proxiedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      return line;
    }
    try {
      const absolute = new URL(trimmed, baseUrl).toString();
      const encoded = encodeURIComponent(absolute);
      return `segment?source=${encoded}`;
    } catch (_error) {
      return line;
    }
  });
  return proxiedLines.join("\n");
}

function pickForwardHeaders(req, allowList) {
  const headers = {};
  for (const name of allowList) {
    const value = req.headers[name.toLowerCase()];
    if (typeof value === "string" && value.trim().length > 0) {
      headers[name] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      headers[name] = value.join(", ");
    }
  }
  return headers;
}

app.get("/healthz", async (_req, res) => {
  try {
    await ensureRedis();
    await redis.ping();
    res.json({ status: "ok" });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.get("/stations", async (req, res) => {
  try {
    await ensureRedis();
    const forceRefresh = req.query.refresh === "true";
    const rawLimit = req.query.limit?.toString().toLowerCase();
    const parsedLimit = Number.parseInt(rawLimit ?? "", 10);
    const limit =
      rawLimit === "all"
        ? config.api.maxPageSize
        : Number.isFinite(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, config.api.maxPageSize)
          : config.api.defaultPageSize;
    const offsetParam = Number.parseInt(req.query.offset ?? "", 10);
    const pageParam = Number.parseInt(req.query.page ?? "", 10);
    const fallbackPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
    const offsetCandidate =
      Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : (fallbackPage - 1) * limit;
    const offset = Math.max(0, offsetCandidate);
    const page = limit > 0 ? Math.floor(offset / limit) + 1 : 1;

    const language = req.query.language?.toString().toLowerCase();
    const country = req.query.country?.toString().toLowerCase();
    const tag = req.query.tag?.toString().toLowerCase();
    const search = req.query.search?.toString().toLowerCase();

    const { payload, cacheSource } = await loadStations(redis, { forceRefresh });
    const stations = Array.isArray(payload?.stations) ? payload.stations : [];

    const availableCountries = Array.from(
      new Set(
        stations
          .map((station) => station.country?.toString().trim() ?? "")
          .filter((value) => value.length > 0),
      ),
    ).sort((a, b) => a.localeCompare(b));

    const matches = [];
    let matchesSeen = 0;
    let hasMore = false;

    const matchesFilters = (station) => {
      if (country) {
        const stationCountry = station.country?.toLowerCase();
        const stationCountryCode = station.countryCode?.toLowerCase();
        if (stationCountry !== country && stationCountryCode !== country) {
          return false;
        }
      }

      if (language) {
        const languages = Array.isArray(station.languages) ? station.languages : [];
        if (!languages.some((item) => item.toLowerCase() === language)) {
          return false;
        }
      }

      if (tag) {
        const tags = Array.isArray(station.tags) ? station.tags : [];
        if (!tags.some((item) => item.toLowerCase() === tag)) {
          return false;
        }
      }

      if (search) {
        const nameMatch = station.name?.toLowerCase().includes(search) ?? false;
        const tagMatch = (Array.isArray(station.tags) ? station.tags : []).some((item) =>
          item.toLowerCase().includes(search),
        );
        const languageMatch = (Array.isArray(station.languages) ? station.languages : []).some(
          (item) => item.toLowerCase().includes(search),
        );
        if (!nameMatch && !tagMatch && !languageMatch) {
          return false;
        }
      }

      return true;
    };

    for (const station of stations) {
      if (!matchesFilters(station)) {
        continue;
      }

      if (matchesSeen >= offset && matches.length < limit) {
        matches.push(station);
      } else if (matches.length >= limit && matchesSeen >= offset) {
        hasMore = true;
      }

      matchesSeen += 1;
    }

    const totalMatches = matchesSeen;

    res.json({
      meta: {
        total: stations.length,
        filtered: matches.length,
        matches: totalMatches,
        hasMore,
        page,
        limit,
        maxLimit: config.api.maxPageSize,
        requestedLimit:
          rawLimit === "all"
            ? "all"
            : Number.isFinite(parsedLimit) && parsedLimit > 0
              ? parsedLimit
              : null,
        offset,
        cacheSource,
        origin: payload?.source ?? null,
        updatedAt: payload?.updatedAt,
        countries: availableCountries,
      },
      items: matches,
    });
  } catch (error) {
    console.error("stations-error", { message: error.message });
    res.status(500).json({ error: "Failed to load stations" });
  }
});

function requireRefreshAuth(req, res, next) {
  const authorization = req.get("authorization") ?? "";
  const expected = `Bearer ${config.refreshToken}`;
  if (authorization !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.post("/stations/refresh", requireRefreshAuth, async (_req, res) => {
  try {
    await ensureRedis();
    const { payload, cacheSource } = await updateStations(redis);
    res.json({
      meta: {
        total: payload.total,
        updatedAt: payload.updatedAt,
        cacheSource,
        origin: payload.source ?? null,
      },
    });
  } catch (error) {
    console.error("refresh-error", { message: error.message });
    res.status(500).json({ error: "Failed to refresh stations" });
  }
});

app.post("/stations/:stationId/click", async (req, res) => {
  try {
    const stationId = req.params.stationId?.toString().trim() ?? "";
    if (!stationId) {
      res.status(400).json({ error: "Station identifier is required" });
      return;
    }
    await recordStationClick(stationId);
    res.status(202).json({ status: "ok" });
  } catch (error) {
    console.error("station-click-error", { message: error.message });
    res.status(500).json({ error: "Failed to record station click" });
  }
});

app.get("/stations/:stationId/stream", async (req, res) => {
  try {
    await ensureRedis();
    const stationId = req.params.stationId?.trim();
    if (!stationId) {
      res.status(400).json({ error: "Station identifier is required." });
      return;
    }

    const { station } = await findStationById(redis, stationId);
    if (!station) {
      res.status(404).json({ error: "Station not found." });
      return;
    }

    const streamUrl = station.streamUrl;
    if (!streamUrl) {
      res.status(404).json({ error: "Station does not have a stream URL." });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.streamProxy.timeoutMs);
    let upstream;
    try {
      upstream = await fetch(streamUrl, {
        method: "GET",
        headers: pickForwardHeaders(req, ["user-agent", "accept"]),
        signal: controller.signal,
      });
    } catch (error) {
      const status = error.name === "AbortError" ? 504 : 502;
      res.status(status).json({ error: "Failed to reach stream URL." });
      return;
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Upstream returned ${upstream.status}` });
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!shouldTreatAsPlaylist(streamUrl, contentType)) {
      res.status(upstream.status);
      res.setHeader("Content-Type", contentType || "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      for await (const chunk of upstream.body ?? []) {
        res.write(chunk);
      }
      res.end();
      return;
    }

    const text = await upstream.text();
    const rewritten = rewritePlaylist(streamUrl, text);
    res.status(200);
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store");
    res.send(rewritten);
  } catch (error) {
    console.error("stream-playlist-error", { message: error.message });
    res.status(500).json({ error: "Failed to load stream playlist." });
  }
});

app.get("/stations/:stationId/stream/segment", async (req, res) => {
  try {
    await ensureRedis();
    const stationId = req.params.stationId?.trim();
    if (!stationId) {
      res.status(400).json({ error: "Station identifier is required." });
      return;
    }
    const sourceParam = req.query.source;
    if (!sourceParam || typeof sourceParam !== "string") {
      res.status(400).json({ error: "A source query parameter is required." });
      return;
    }
    let targetUrl;
    try {
      targetUrl = new URL(decodeURIComponent(sourceParam));
    } catch (_error) {
      res.status(400).json({ error: "Invalid segment URL provided." });
      return;
    }

    const { station } = await findStationById(redis, stationId);
    if (!station || !station.streamUrl) {
      res.status(404).json({ error: "Station not found." });
      return;
    }

    const streamOrigin = (() => {
      try {
        return new URL(station.streamUrl).origin;
      } catch {
        return null;
      }
    })();
    if (!streamOrigin || targetUrl.origin !== streamOrigin) {
      res.status(403).json({ error: "Segment URL is not permitted." });
      return;
    }

    const headers = pickForwardHeaders(req, ["range", "accept", "user-agent"]);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.streamProxy.timeoutMs);

    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      const status = error.name === "AbortError" ? 504 : 502;
      res.status(status).json({ error: "Failed to retrieve stream segment." });
      return;
    } finally {
      clearTimeout(timeout);
    }

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!/^transfer-encoding$/i.test(key)) {
        res.setHeader(key, value);
      }
    });
    res.setHeader("Cache-Control", "no-store");
    for await (const chunk of upstream.body ?? []) {
      res.write(chunk);
    }
    res.end();
  } catch (error) {
    console.error("stream-segment-error", { message: error.message });
    res.status(500).json({ error: "Failed to proxy stream segment." });
  }
});

const server = app.listen(config.port, () => {
  console.log(`radio-service listening on ${config.port}`);
});

function shutdown() {
  server.close(() => {
    redis.quit().finally(() => {
      process.exit(0);
    });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
