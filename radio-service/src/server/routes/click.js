import { logger } from "../../logger.js";
import { schemaRefs } from "../openapi.js";

export function registerClickRoutes(app, { recordStationClick }) {
  const clickRouteSchema = {
    tags: ["Stations"],
    summary: "Record a station click",
    description: "Registers that a listener clicked on a given station. Used for analytics.",
    params: {
      $ref: schemaRefs.stationIdentifierParams,
    },
    response: {
      202: {
        description: "Click recorded successfully.",
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["ok"] },
        },
      },
      400: {
        description: "Invalid station identifier supplied.",
        type: "object",
        additionalProperties: false,
        properties: {
          error: { type: "string" },
        },
      },
      500: {
        description: "Server failed to record the click.",
        type: "object",
        additionalProperties: false,
        properties: {
          error: { type: "string" },
        },
      },
    },
  };

  app.post("/stations/:stationId/click", { schema: clickRouteSchema }, async (request, reply) => {
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
