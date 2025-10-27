import { logger } from "../../logger.js";

export function registerClickRoutes(app, { recordStationClick }) {
  app.post("/stations/:stationId/click", async (req, res) => {
    try {
      const stationId = req.params.stationId?.toString().trim() ?? "";
      if (!stationId) {
        res.status(400).json({ error: "Station identifier is required" });
        return;
      }
      await recordStationClick(stationId);
      res.status(202).json({ status: "ok" });
    } catch (error) {
      logger.error("stations.click_error", { stationId: req.params.stationId ?? null, error });
      res.status(500).json({ error: "Failed to record station click" });
    }
  });
}
