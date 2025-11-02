import { logger } from "../../logger.js";

export function registerClickRoutes(app, { recordStationClick }) {
  app.post("/stations/:stationId/click", async (request, reply) => {
    try {
      const stationId = request.params.stationId?.toString().trim() ?? "";
      if (!stationId) {
        reply.status(400).send({ error: "Station identifier is required" });
        return;
      }
      await recordStationClick(stationId);
      reply.status(202).send({ status: "ok" });
    } catch (error) {
      logger.error("stations.click_error", { stationId: request.params.stationId ?? null, error });
      reply.status(500).send({ error: "Failed to record station click" });
    }
  });
}
