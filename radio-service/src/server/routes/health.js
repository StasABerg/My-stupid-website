export function registerHealthRoutes(app, { ensureRedis, redis }) {
  app.get("/healthz", async (_req, res) => {
    try {
      await ensureRedis();
      await redis.ping();
      res.json({ status: "ok" });
    } catch (error) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });
}
