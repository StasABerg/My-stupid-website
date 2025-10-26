import express from "express";
import { config } from "../config/index.js";
import { createRateLimiter } from "./middleware/rateLimit.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerStationsRoutes } from "./routes/stations.js";
import { registerClickRoutes } from "./routes/click.js";
import { registerStreamRoutes } from "./routes/stream.js";
import { registerFavoritesRoutes } from "./routes/favorites.js";

function createStationsLoader({ redis, ensureRedis, loadStations }) {
  return async function stationsLoader({ forceRefresh = false } = {}) {
    await ensureRedis();
    const result = await loadStations(redis, { forceRefresh });
    return result;
  };
}

export function createApp(deps) {
  const { redis, ensureRedis, loadStations, updateStations, recordStationClick } = deps;
  const stationsLoader = createStationsLoader({ redis, ensureRedis, loadStations });

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(express.json({ limit: "100kb" }));
  app.use(createRateLimiter());

  registerHealthRoutes(app, { ensureRedis, redis });
  registerStationsRoutes(app, {
    config,
    ensureRedis,
    stationsLoader,
    updateStations,
    redis,
  });
  registerClickRoutes(app, {
    recordStationClick,
    config,
    ensureRedis,
    stationsLoader,
  });
  registerStreamRoutes(app, {
    config,
    ensureRedis,
    stationsLoader,
  });
  registerFavoritesRoutes(app, {
    ensureRedis,
    redis,
    stationsLoader,
  });

  return app;
}
