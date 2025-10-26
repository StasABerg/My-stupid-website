import { GlideClient } from "@valkey/valkey-glide";
import { config } from "./config/index.js";

export function createRedisClient() {
  const useTls = config.redisUrl.startsWith("rediss://");
  const client = new GlideClient(config.redisUrl, {
    tls: useTls
      ? {
          rejectUnauthorized: config.allowInsecureTransports !== true,
        }
      : undefined,
  });

  client.on("error", (error) => {
    console.error("redis-error", { message: error.message });
  });

  return client;
}
