import Redis from "ioredis";
import { config } from "./config/index.js";
import { logger } from "./logger.js";

export function createRedisClient() {
  const client = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });

  client.on("error", (error) => {
    logger.error("redis.error", { error });
  });
  return client;
}
