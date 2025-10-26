import { createClient } from "@valkey/valkey-glide";
import { config } from "./config/index.js";

export function createRedisClient() {
  const client = createClient({
    url: config.redisUrl,
    lazyConnect: true,
    socket: {
      tls: config.redisUrl.startsWith("rediss://"),
      rejectUnauthorized: config.allowInsecureTransports !== true,
    },
  });

  client.on("error", (error) => {
    console.error("redis-error", { message: error.message });
  });

  return client;
}
