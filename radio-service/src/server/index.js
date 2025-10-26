import { config, validateConfig } from "../config/index.js";
import { createRedisClient } from "../redis.js";
import { loadStations, recordStationClick, updateStations } from "../service.js";
import { createApp } from "./app.js";

validateConfig();

const redis = createRedisClient();

async function ensureRedis() {
  if (!redis.isReady) {
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
  console.log(`radio-service listening on ${config.port}`);
});

function shutdown() {
  server.close(() => {
    redis
      .quit()
      .catch(() => redis.disconnect?.())
      .finally(() => {
        process.exit(0);
      });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
