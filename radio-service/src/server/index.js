import { config, validateConfig } from "../config/index.js";
import { createRedisClient } from "../redis.js";
import { loadStations, recordStationClick, updateStations } from "../service.js";
import { logger } from "../logger.js";
import { createApp } from "./app.js";

validateConfig();

const redis = createRedisClient();

logger.info("s3.configuration", {
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  signingRegion: config.s3.signingRegion,
  signingService: config.s3.signingService,
  bucket: config.s3.bucket,
});

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

async function start() {
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    logger.info("server.started", { port: config.port });
  } catch (error) {
    logger.error("server.start_failed", { error });
    process.exit(1);
  }
}

start();

async function shutdown(signal) {
  logger.info("server.shutdown_requested", { signal });
  try {
    await app.close();
  } catch (error) {
    logger.warn("server.close_failed", { error });
  }
  try {
    await redis.quit();
    logger.info("redis.connection_closed", {});
  } catch (error) {
    logger.warn("redis.quit_failed", { error });
    redis.disconnect();
  } finally {
    logger.info("server.shutdown_complete", { signal });
    process.exit(0);
  }
}

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((error) => {
    logger.error("shutdown.unhandled_error", { error });
    process.exit(1);
  });
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((error) => {
    logger.error("shutdown.unhandled_error", { error });
    process.exit(1);
  });
});
