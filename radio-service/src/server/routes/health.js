export function registerHealthRoutes(app, { ensureRedis, redis }) {
  app.get("/healthz", async (_request, reply) => {
    try {
      await ensureRedis();
      await redis.ping();
      reply.send({ status: "ok" });
    } catch (error) {
      reply.status(500).send({ status: "error", message: error.message });
    }
  });
}
