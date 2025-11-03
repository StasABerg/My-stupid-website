import rateLimit from "@fastify/rate-limit";
import fastifyRedis from "@fastify/redis";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import underPressure from "@fastify/under-pressure";
import Fastify from "fastify";
import { config } from "../config/index.js";
import { createRateLimitOptions } from "./middleware/rateLimit.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerStationsRoutes } from "./routes/stations.js";
import { registerClickRoutes } from "./routes/click.js";
import { registerStreamRoutes } from "./routes/stream.js";
import { registerFavoritesRoutes } from "./routes/favorites.js";
import { registerOpenApiSchemas } from "./openapi.js";

function createStationsLoader({ redis, ensureRedis, loadStations }) {
  return async function stationsLoader({ forceRefresh = false } = {}) {
    await ensureRedis();
    const result = await loadStations(redis, { forceRefresh });
    return result;
  };
}

export function createApp(deps) {
  const { loadStations, updateStations, recordStationClick } = deps;
  const fastify = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 100 * 1024,
  });

  registerOpenApiSchemas(fastify);

  fastify.register(swagger, {
    openapi: {
      info: {
        title: "Radio Service API",
        description: "Endpoints for radio station discovery, favorites, and health checks.",
        version: "0.1.0",
      },
      tags: [
        { name: "Stations", description: "Station catalog and playback endpoints." },
        { name: "Favorites", description: "Manage per-session station favorites." },
        { name: "Health", description: "Operational health and status endpoints." },
      ],
      servers: [
        {
          url: "/api/radio",
          description: "External base path via gateway",
        },
      ],
    },
  });

  fastify.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
  });

  fastify.register(rateLimit, createRateLimitOptions());

  fastify.register(async (instance) => {
    await instance.register(fastifyRedis, {
      url: config.redisUrl,
      lazyConnect: true,
      closeClient: true,
      maxRetriesPerRequest: 2,
    });

    const redis = instance.redis;
    if (!redis) {
      throw new Error("Redis plugin not initialized");
    }

    if (typeof redis.on === "function") {
      redis.on("error", (error) => {
        instance.log.error({ error }, "redis.error");
      });
    }

    const ensureRedis = async () => {
      if (redis.status !== "ready") {
        await redis.connect();
      }
      return redis;
    };

    const stationsLoader = createStationsLoader({ redis, ensureRedis, loadStations });

    await instance.register(underPressure, {
      maxEventLoopDelay: 1000,
      healthCheckInterval: 30000,
      exposeStatusRoute: {
        url: "/internal/status",
        routeOpts: {
          logLevel: "warn",
          schema: {
            tags: ["Health"],
            summary: "Runtime metrics and pressure indicators.",
            description: "Provides memory usage, event loop delay, and health checks for infrastructure probes.",
          },
        },
      },
      healthCheck: async () => {
        await ensureRedis();
        await redis.ping();
        return { redis: "ok" };
      },
    });

    registerHealthRoutes(instance, { ensureRedis, redis });
    registerStationsRoutes(instance, {
      config,
      ensureRedis,
      stationsLoader,
      updateStations,
      redis,
    });
    registerClickRoutes(instance, {
      recordStationClick,
      config,
      ensureRedis,
      stationsLoader,
    });
    registerStreamRoutes(instance, {
      config,
      ensureRedis,
      stationsLoader,
    });
    registerFavoritesRoutes(instance, {
      ensureRedis,
      redis,
      stationsLoader,
    });
  });

  return fastify;
}
