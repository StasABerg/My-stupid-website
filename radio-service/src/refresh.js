import { validateConfig } from "./config/index.js";
import { updateStations } from "./service.js";
import { logger } from "./logger.js";
import { runMigrations } from "./db/postgres.js";
import Redis from "ioredis";

async function main() {
  validateConfig();
  await runMigrations();
  const redis = new Redis(process.env.REDIS_URL);
  try {
    const { payload } = await updateStations(redis);
    logger.info("refresh.completed", {
      total: payload.total,
      updatedAt: payload.updatedAt,
    });
  } finally {
    await redis.quit();
  }
}

main().catch((error) => {
  logger.error("refresh.failed", { error });
  process.exit(1);
});
