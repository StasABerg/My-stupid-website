import valkeyGlide from "@valkey/valkey-glide";
import { config } from "./config/index.js";

const createClient =
  typeof valkeyGlide === "function"
    ? valkeyGlide
    : typeof valkeyGlide?.createClient === "function"
      ? valkeyGlide.createClient
      : null;

if (!createClient) {
  throw new Error("Unable to resolve createClient from @valkey/valkey-glide");
}

export function createRedisClient() {
  const useTls = config.redisUrl.startsWith("rediss://");
  const client = createClient({
    url: config.redisUrl,
    socket: useTls
      ? {
          tls: true,
          rejectUnauthorized: config.allowInsecureTransports !== true,
        }
      : undefined,
  });

  client.on("error", (error) => {
    console.error("redis-error", { message: error.message });
  });

  return client;
}
