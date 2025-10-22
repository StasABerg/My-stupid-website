import { validateConfig } from "./config/index.js";
import { createRedisClient } from "./redis.js";
import { updateStations } from "./service.js";

async function main() {
  validateConfig();
  const redis = createRedisClient();
  await redis.connect();
  const { payload } = await updateStations(redis);
  console.log(
    JSON.stringify({
      message: "Stations refreshed",
      total: payload.total,
      updatedAt: payload.updatedAt,
    }),
  );
  await redis.quit();
}

main().catch((error) => {
  console.error("refresh-failed", error);
  process.exit(1);
});
