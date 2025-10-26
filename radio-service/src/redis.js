if (!process.env.GLIDE_LOGGER_DIRECTORY) {
  process.env.GLIDE_LOGGER_DIRECTORY = "/tmp";
}
if (!process.env.GLIDE_LOGGER_SOCKET_PATH) {
  process.env.GLIDE_LOGGER_SOCKET_PATH = `/tmp/valkey-glide-${process.pid}.sock`;
}

const { GlideClient, Logger } = await import("@valkey/valkey-glide");

try {
  Logger.setLoggerConfig("OFF", undefined, {
    useSharedLogger: false,
    logToConsole: true,
  });
} catch (error) {
  try {
    Logger.init("OFF", undefined, {
      useSharedLogger: false,
      logToConsole: true,
    });
  } catch (innerError) {
    console.warn("valkey-logger-init-error", innerError.message || error.message);
  }
}

import { config } from "./config/index.js";

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
