import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { config } from "../config/index.js";
import { createRateLimitOptions } from "./middleware/rateLimit.js";
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

  const fastify = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 100 * 1024,
  });

  fastify.register(rateLimit, createRateLimitOptions());

  registerHealthRoutes(fastify, { ensureRedis, redis });
  registerStationsRoutes(fastify, {
    config,
    ensureRedis,
    stationsLoader,
    updateStations,
    redis,
  });
  registerClickRoutes(fastify, {
    recordStationClick,
    config,
    ensureRedis,
    stationsLoader,
  });
  registerStreamRoutes(fastify, {
    config,
    ensureRedis,
    stationsLoader,
  });
  registerFavoritesRoutes(fastify, {
    ensureRedis,
    redis,
    stationsLoader,
  });

  return fastify;
}
