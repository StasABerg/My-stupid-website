import { config, validateConfig } from "../config/index.js";
import { createRedisClient } from "../redis.js";
import { loadStations, recordStationClick, updateStations } from "../service.js";
import { logger } from "../logger.js";
import { createApp } from "./app.js";

validateConfig();

const redis = createRedisClient();

async function ensureRedis() {
  if (redis.status !== "ready") {
    await redis.connect();
  }
}

const app = createApp({
  config,
  redis,
  ensureRedis,
  loadStations,
  updateStations,
  recordStationClick,
});

const server = app.listen(config.port, () => {
  logger.info("server.started", { port: config.port });
});

function shutdown(signal) {
  logger.info("server.shutdown_requested", { signal });
  server.close(() => {
    redis
      .quit()
      .then(() => {
        logger.info("redis.connection_closed", {});
      })
      .catch((error) => {
        logger.warn("redis.quit_failed", { error });
        redis.disconnect();
      })
      .finally(() => {
        logger.info("server.shutdown_complete", { signal });
        process.exit(0);
      });
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
