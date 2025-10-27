import { validateConfig } from "./config/index.js";
import { createRedisClient } from "./redis.js";
import { updateStations } from "./service.js";
import { logger } from "./logger.js";

async function main() {
  validateConfig();
  const redis = createRedisClient();
  await redis.connect();
  const { payload } = await updateStations(redis);
  logger.info("refresh.completed", {
    total: payload.total,
    updatedAt: payload.updatedAt,
  });
  await redis.quit();
}

main().catch((error) => {
  logger.error("refresh.failed", { error });
  process.exit(1);
});
