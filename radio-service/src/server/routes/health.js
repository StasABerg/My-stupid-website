const healthCheckSchema = {
  tags: ["Health"],
  summary: "Service health check",
  description: "Confirms Redis connectivity and general service readiness.",
  response: {
    200: {
      description: "Service is healthy.",
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["ok"] },
      },
    },
    500: {
      description: "Service is unhealthy.",
      type: "object",
      additionalProperties: true,
      properties: {
        status: { type: "string" },
        message: { type: "string" },
      },
    },
  },
};

export function registerHealthRoutes(app, { ensureRedis, redis }) {
  app.get("/healthz", { schema: healthCheckSchema }, async (_request, reply) => {
    try {
      await ensureRedis();
      await redis.ping();
      reply.send({ status: "ok" });
    } catch (error) {
      reply.status(500).send({ status: "error", message: error.message });
    }
  });
}
