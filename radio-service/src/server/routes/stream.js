import { fetchWithKeepAlive } from "../../http/client.js";
import { createServiceAuthMiddleware } from "../middleware/serviceAuth.js";
import { pickForwardHeaders, rewritePlaylist, shouldTreatAsPlaylist } from "./utils.js";

async function findStationById(stationsLoader, stationId) {
  const { payload } = await stationsLoader();
  const stations = Array.isArray(payload?.stations) ? payload.stations : [];
  const station = stations.find((item) => item.id === stationId);
  return station ? { station, payload } : { station: null, payload };
}

export function registerStreamRoutes(app, { config, ensureRedis, stationsLoader }) {
  const requireServiceAuth = createServiceAuthMiddleware(config.serviceAuthToken);

  app.get("/stations/:stationId/stream", requireServiceAuth, async (req, res) => {
    try {
      await ensureRedis();
      const stationId = req.params.stationId?.trim();
      if (!stationId) {
        res.status(400).json({ error: "Station identifier is required." });
        return;
      }

      const { station } = await findStationById(stationsLoader, stationId);
      if (!station || !station.streamUrl) {
        res.status(404).json({ error: "Station not found." });
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.streamProxy.timeoutMs);
      let upstream;
      try {
        upstream = await fetchWithKeepAlive(station.streamUrl, {
          method: "GET",
          headers: pickForwardHeaders(req, ["user-agent", "accept"]),
          signal: controller.signal,
        });
      } catch (error) {
        const status = error.name === "AbortError" ? 504 : 502;
        res.status(status).json({ error: "Failed to reach stream URL." });
        return;
      } finally {
        clearTimeout(timeout);
      }

      if (!upstream.ok) {
        res.status(upstream.status).json({ error: `Upstream returned ${upstream.status}` });
        return;
      }

      const contentType = upstream.headers.get("content-type") ?? "";
      if (!shouldTreatAsPlaylist(station.streamUrl, contentType)) {
        res.status(upstream.status);
        res.setHeader("Content-Type", contentType || "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        for await (const chunk of upstream.body ?? []) {
          res.write(chunk);
        }
        res.end();
        return;
      }

      const text = await upstream.text();
      const rewritten = rewritePlaylist(station.streamUrl, text);
      res.status(200);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-store");
      res.send(rewritten);
    } catch (error) {
      console.error("stream-playlist-error", { message: error.message });
      res.status(500).json({ error: "Failed to load stream playlist." });
    }
  });

  app.get("/stations/:stationId/stream/segment", requireServiceAuth, async (req, res) => {
    try {
      await ensureRedis();
      const stationId = req.params.stationId?.trim();
      if (!stationId) {
        res.status(400).json({ error: "Station identifier is required." });
        return;
      }
      const sourceParam = req.query.source;
      if (!sourceParam || typeof sourceParam !== "string") {
        res.status(400).json({ error: "A source query parameter is required." });
        return;
      }

      let targetUrl;
      try {
        targetUrl = new URL(decodeURIComponent(sourceParam));
      } catch (_error) {
        res.status(400).json({ error: "Invalid segment URL provided." });
        return;
      }

      const { station } = await findStationById(stationsLoader, stationId);
      if (!station || !station.streamUrl) {
        res.status(404).json({ error: "Station not found." });
        return;
      }

      const streamOrigin = (() => {
        try {
          return new URL(station.streamUrl).origin;
        } catch {
          return null;
        }
      })();
      if (!streamOrigin || targetUrl.origin !== streamOrigin) {
        res.status(403).json({ error: "Segment URL is not permitted." });
        return;
      }
      if (targetUrl.protocol !== "https:") {
        res.status(403).json({ error: "Stream segments must use HTTPS." });
        return;
      }

      const headers = pickForwardHeaders(req, ["range", "accept", "user-agent"]);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.streamProxy.timeoutMs);

      let upstream;
      try {
        upstream = await fetchWithKeepAlive(targetUrl, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
      } catch (error) {
        const status = error.name === "AbortError" ? 504 : 502;
        res.status(status).json({ error: "Failed to retrieve stream segment." });
        return;
      } finally {
        clearTimeout(timeout);
      }

      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (!/^transfer-encoding$/i.test(key)) {
          res.setHeader(key, value);
        }
      });
      res.setHeader("Cache-Control", "no-store");
      for await (const chunk of upstream.body ?? []) {
        res.write(chunk);
      }
      res.end();
    } catch (error) {
      console.error("stream-segment-error", { message: error.message });
      res.status(500).json({ error: "Failed to proxy stream segment." });
    }
  });
}
