import { projectStationForClient } from "./projectStation.js";

const SESSION_TOKEN_PATTERN = /^[a-f0-9]{16,}$/i;
const STATION_ID_PATTERN = /^[A-Za-z0-9:_-]{3,128}$/;
const FAVORITES_KEY_PREFIX = "radio:favorites:";
const MAX_FAVORITES = 6;
const FAVORITES_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function extractSessionToken(req) {
  const rawHeader = req.get("x-gateway-session");
  if (!rawHeader || typeof rawHeader !== "string") {
    return { ok: false, status: 401, error: "Session token required" };
  }

  const trimmed = rawHeader.trim();
  if (!SESSION_TOKEN_PATTERN.test(trimmed)) {
    return { ok: false, status: 401, error: "Invalid session token" };
  }

  return { ok: true, value: trimmed.toLowerCase() };
}

function sanitizeStationId(stationId) {
  if (typeof stationId !== "string") {
    return null;
  }
  const trimmed = stationId.trim();
  if (!STATION_ID_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function buildFavoritesKey(sessionToken) {
  return `${FAVORITES_KEY_PREFIX}${sessionToken}`;
}

function dedupeAndClamp(ids) {
  const seen = new Set();
  const result = [];
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!STATION_ID_PATTERN.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= MAX_FAVORITES) {
      break;
    }
  }
  return result;
}

async function readFavorites(redis, key) {
  try {
    const raw = await redis.get(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return dedupeAndClamp(parsed);
  } catch {
    return [];
  }
}

async function writeFavorites(redis, key, stationIds) {
  const payload = JSON.stringify(dedupeAndClamp(stationIds));
  await redis.set(key, payload, "EX", FAVORITES_TTL_SECONDS);
}

function resolveStationsById(payload) {
  const map = new Map();
  const stations = Array.isArray(payload?.stations) ? payload.stations : [];
  for (const station of stations) {
    if (station?.id) {
      map.set(station.id, station);
    }
  }
  return map;
}

async function respondWithFavorites(res, redis, key, favorites, stationsLoader) {
  const { payload } = await stationsLoader();
  const stationsById = resolveStationsById(payload);

  const validFavorites = [];
  for (const id of favorites) {
    const station = stationsById.get(id);
    if (!station) {
      continue;
    }
    validFavorites.push(id);
  }

  if (validFavorites.length !== favorites.length) {
    await writeFavorites(redis, key, validFavorites);
  }

  const items = validFavorites
    .map((id) => stationsById.get(id))
    .filter(Boolean)
    .map(projectStationForClient);

  res.json({
    meta: {
      maxSlots: MAX_FAVORITES,
    },
    items,
  });
}

export function registerFavoritesRoutes(app, { ensureRedis, redis, stationsLoader }) {
  app.get("/favorites", async (req, res) => {
    const session = extractSessionToken(req);
    if (!session.ok) {
      res.status(session.status).json({ error: session.error });
      return;
    }

    try {
      await ensureRedis();
      const key = buildFavoritesKey(session.value);
      const favorites = await readFavorites(redis, key);
      await respondWithFavorites(res, redis, key, favorites, stationsLoader);
    } catch (error) {
      console.error("favorites-read-error", { message: error.message });
      res.status(500).json({ error: "Failed to load favorites" });
    }
  });

  app.put("/favorites/:stationId", async (req, res) => {
    const session = extractSessionToken(req);
    if (!session.ok) {
      res.status(session.status).json({ error: session.error });
      return;
    }

    const sanitizedStationId = sanitizeStationId(req.params.stationId);
    if (!sanitizedStationId) {
      res.status(400).json({ error: "Invalid station identifier" });
      return;
    }

    let requestedSlot = null;
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "slot")) {
      const slotValue = req.body.slot;
      if (
        Number.isInteger(slotValue) &&
        slotValue >= 0 &&
        slotValue < MAX_FAVORITES
      ) {
        requestedSlot = slotValue;
      } else {
        res.status(400).json({ error: "Invalid slot index" });
        return;
      }
    }

    try {
      await ensureRedis();
      const key = buildFavoritesKey(session.value);
      const favorites = await readFavorites(redis, key);

      if (favorites.includes(sanitizedStationId) && requestedSlot === null) {
        await respondWithFavorites(res, redis, key, favorites, stationsLoader);
        return;
      }

      const { payload } = await stationsLoader();
      const stationsById = resolveStationsById(payload);
      if (!stationsById.has(sanitizedStationId)) {
        res.status(404).json({ error: "Station not found" });
        return;
      }

      let nextFavorites = favorites.slice();

      if (requestedSlot !== null) {
        while (nextFavorites.length <= requestedSlot) {
          nextFavorites.push(null);
        }
        nextFavorites[requestedSlot] = sanitizedStationId;
      } else if (nextFavorites.length >= MAX_FAVORITES) {
        res.status(409).json({ error: "All favorite slots are already filled" });
        return;
      } else {
        nextFavorites.push(sanitizedStationId);
      }

      nextFavorites = dedupeAndClamp(nextFavorites);
      await writeFavorites(redis, key, nextFavorites);
      await respondWithFavorites(res, redis, key, nextFavorites, stationsLoader);
    } catch (error) {
      console.error("favorites-save-error", { message: error.message });
      res.status(500).json({ error: "Failed to save favorite" });
    }
  });

  app.delete("/favorites/:stationId", async (req, res) => {
    const session = extractSessionToken(req);
    if (!session.ok) {
      res.status(session.status).json({ error: session.error });
      return;
    }

    const sanitizedStationId = sanitizeStationId(req.params.stationId);
    if (!sanitizedStationId) {
      res.status(400).json({ error: "Invalid station identifier" });
      return;
    }

    try {
      await ensureRedis();
      const key = buildFavoritesKey(session.value);
      const favorites = await readFavorites(redis, key);
      const nextFavorites = favorites.filter((id) => id !== sanitizedStationId);
      if (nextFavorites.length !== favorites.length) {
        await writeFavorites(redis, key, nextFavorites);
      }
      await respondWithFavorites(res, redis, key, nextFavorites, stationsLoader);
    } catch (error) {
      console.error("favorites-delete-error", { message: error.message });
      res.status(500).json({ error: "Failed to remove favorite" });
    }
  });
}
