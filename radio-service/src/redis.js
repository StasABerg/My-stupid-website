import { GlideClient, Logger } from "@valkey/valkey-glide";
import { config } from "./config/index.js";

try {
  Logger.setLoggerConfig("OFF", undefined, { useSharedLogger: false, logToConsole: false });
} catch (error) {
  try {
    Logger.init("OFF", undefined, { useSharedLogger: false, logToConsole: false });
  } catch (innerError) {
    console.warn("valkey-logger-init-error", innerError.message || error.message);
  }
}

function buildClientOptions() {
  const url = new URL(config.redisUrl);
  const port = url.port ? Number.parseInt(url.port, 10) : 6379;
  const addresses = [{ host: url.hostname, port }];
  const options = { addresses };

  if (url.username) {
    options.username = decodeURIComponent(url.username);
  }
  if (url.password) {
    options.password = decodeURIComponent(url.password);
  }
  if (url.pathname && url.pathname !== "/") {
    const db = Number.parseInt(url.pathname.slice(1), 10);
    if (Number.isFinite(db) && db >= 0) {
      options.database = db;
    }
  }
  if (url.protocol === "rediss:") {
    options.tls = {
      rejectUnauthorized: config.allowInsecureTransports !== true,
    };
  }

  return options;
}

export async function createRedisClient() {
  const client = await GlideClient.createClient(buildClientOptions());
  client.on("error", (error) => {
    console.error("redis-error", { message: error.message });
  });
  return client;
}
