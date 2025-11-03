import { fetchWithKeepAlive } from "../../http/client.js";
import { logger } from "../../logger.js";
import { pickForwardHeaders, rewritePlaylist, shouldTreatAsPlaylist } from "./utils.js";

async function findStationById(stationsLoader, stationId) {
  const { payload } = await stationsLoader();
  const stations = Array.isArray(payload?.stations) ? payload.stations : [];
  const station = stations.find((item) => item.id === stationId);
  return station ? { station, payload } : { station: null, payload };
}

export function registerStreamRoutes(app, { config, ensureRedis, stationsLoader }) {
  const streamRouteBaseSchema = {
    tags: ["Stations"],
    hide: true,
  };

  app.get("/stations/:stationId/stream", { schema: streamRouteBaseSchema }, async (request, reply) => {
    try {
      await ensureRedis();
      const stationId = request.params.stationId?.trim();
      if (!stationId) {
        reply.status(400).send({ error: "Station identifier is required." });
        return;
      }

      const { station } = await findStationById(stationsLoader, stationId);
      if (!station || !station.streamUrl) {
        reply.status(404).send({ error: "Station not found." });
        return;
      }

      const csrfToken =
        typeof request.query.csrfToken === "string" && request.query.csrfToken.trim().length > 0
          ? request.query.csrfToken.trim()
          : null;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.streamProxy.timeoutMs);
      let upstream;
      try {
        upstream = await fetchWithKeepAlive(station.streamUrl, {
          method: "GET",
          headers: pickForwardHeaders(request, ["user-agent", "accept"]),
          signal: controller.signal,
        });
      } catch (error) {
        const status = error.name === "AbortError" ? 504 : 502;
        reply.status(status).send({ error: "Failed to reach stream URL." });
        return;
      } finally {
        clearTimeout(timeout);
      }

      if (!upstream.ok) {
        reply.status(upstream.status).send({ error: `Upstream returned ${upstream.status}` });
        return;
      }

      const contentType = upstream.headers.get("content-type") ?? "";
      if (!shouldTreatAsPlaylist(station.streamUrl, contentType)) {
        reply.hijack();
        reply.raw.statusCode = upstream.status;
        reply.raw.setHeader("Content-Type", contentType || "application/octet-stream");
        reply.raw.setHeader("Cache-Control", "no-store");
        for await (const chunk of upstream.body ?? []) {
          reply.raw.write(chunk);
        }
        reply.raw.end();
        return;
      }

      const text = await upstream.text();
      const rewritten = rewritePlaylist(station.streamUrl, text, {
        extraParams: csrfToken ? { csrfToken } : undefined,
      });
      reply
        .status(200)
        .header("Content-Type", "application/vnd.apple.mpegurl")
        .header("Cache-Control", "no-store")
        .send(rewritten);
    } catch (error) {
      logger.error("stream.playlist_error", { stationId: request.params.stationId ?? null, error });
      reply.status(500).send({ error: "Failed to load stream playlist." });
    }
  });

  app.get(
    "/stations/:stationId/stream/segment",
    { schema: streamRouteBaseSchema },
    async (request, reply) => {
    try {
      await ensureRedis();
      const stationId = request.params.stationId?.trim();
      if (!stationId) {
        reply.status(400).send({ error: "Station identifier is required." });
        return;
      }
      const sourceParam = request.query.source;
      if (!sourceParam || typeof sourceParam !== "string") {
        reply.status(400).send({ error: "A source query parameter is required." });
        return;
      }

      let targetUrl;
      try {
        targetUrl = new URL(decodeURIComponent(sourceParam));
      } catch (_error) {
        reply.status(400).send({ error: "Invalid segment URL provided." });
        return;
      }

      const { station } = await findStationById(stationsLoader, stationId);
      if (!station || !station.streamUrl) {
        reply.status(404).send({ error: "Station not found." });
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
        reply.status(403).send({ error: "Segment URL is not permitted." });
        return;
      }
      if (targetUrl.protocol !== "https:") {
        reply.status(403).send({ error: "Stream segments must use HTTPS." });
        return;
      }

      const headers = pickForwardHeaders(request, ["range", "accept", "user-agent"]);
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
        reply.status(status).send({ error: "Failed to retrieve stream segment." });
        return;
      } finally {
        clearTimeout(timeout);
      }

      reply.hijack();
      reply.raw.statusCode = upstream.status;

      upstream.headers.forEach((value, key) => {
        if (!/^transfer-encoding$/i.test(key)) {
          reply.raw.setHeader(key, value);
        }
      });
      reply.raw.setHeader("Cache-Control", "no-store");
      for await (const chunk of upstream.body ?? []) {
        reply.raw.write(chunk);
      }
      reply.raw.end();
    } catch (error) {
      logger.error("stream.segment_error", {
        stationId: request.params.stationId ?? null,
        source: request.query.source ?? null,
        error,
      });
      reply.status(500).send({ error: "Failed to proxy stream segment." });
    }
    },
  );
}
