import { createServiceAuthMiddleware } from "../middleware/serviceAuth.js";

export function registerClickRoutes(app, { recordStationClick, config }) {
  const requireServiceAuth = createServiceAuthMiddleware(config.serviceAuthToken);

  app.post("/stations/:stationId/click", requireServiceAuth, async (req, res) => {
    try {
      const stationId = req.params.stationId?.toString().trim() ?? "";
      if (!stationId) {
        res.status(400).json({ error: "Station identifier is required" });
        return;
      }
      await recordStationClick(stationId);
      res.status(202).json({ status: "ok" });
    } catch (error) {
      console.error("station-click-error", { message: error.message });
      res.status(500).json({ error: "Failed to record station click" });
    }
  });
}
