import express from "express";
import rateLimit from "express-rate-limit";
import { config, validateConfig } from "./config.js";
import { createRedisClient } from "./redis.js";
import { loadStations, recordStationClick, updateStations } from "./service.js";

validateConfig();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

// Rate limiter: maximum of 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable the X-RateLimit-* headers
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
    const limit = Number.parseInt(req.query.limit ?? "0", 10);
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

    let filtered = stations;
    if (country) {
      filtered = filtered.filter((station) => {
        return (
          station.country?.toLowerCase() === country ||
          station.countryCode?.toLowerCase() === country
        );
      });
    }

    if (language) {
      filtered = filtered.filter((station) =>
        station.languages.some((item) => item.toLowerCase() === language),
      );
    }

    if (tag) {
      filtered = filtered.filter((station) =>
        station.tags.some((item) => item.toLowerCase() === tag),
      );
    }

    if (search) {
      filtered = filtered.filter((station) =>
        station.name.toLowerCase().includes(search) ||
        station.tags.some((item) => item.toLowerCase().includes(search)) ||
        station.languages.some((item) => item.toLowerCase().includes(search)),
      );
    }

    const sanitizedLimit = Number.isFinite(limit) && limit > 0 ? limit : filtered.length;
    const items = sanitizedLimit ? filtered.slice(0, sanitizedLimit) : filtered;

    res.json({
      meta: {
        total: stations.length,
        filtered: items.length,
        cacheSource,
        origin: payload?.source ?? null,
        updatedAt: payload?.updatedAt,
        countries: availableCountries,
      },
      items,
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
