import { config, validateConfig } from "../config/index.js";
import { loadStations, recordStationClick, updateStations } from "../service.js";
import { logger } from "../logger.js";
import { createApp } from "./app.js";
import { runMigrations } from "../db/postgres.js";

validateConfig();

const postgresUrl = new URL(config.postgres.connectionString);
logger.info("postgres.configuration", {
  host: postgresUrl.host,
  database: postgresUrl.pathname?.slice(1) ?? null,
  ssl: config.postgres.ssl ? true : false,
  maxConnections: config.postgres.maxConnections,
});

const app = createApp({
  loadStations,
  updateStations,
  recordStationClick,
});

async function start() {
  try {
    await runMigrations();
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
