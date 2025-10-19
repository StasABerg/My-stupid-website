import Redis from "ioredis";
import { config } from "./config.js";

export function createRedisClient() {
  const client = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });

  client.on("error", (error) => {
    console.error("redis-error", { message: error.message });
  });

  return client;
}
