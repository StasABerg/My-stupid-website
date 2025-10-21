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
