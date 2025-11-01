import { logger } from "../../logger.js";
import { projectStationForClient } from "./projectStation.js";

const SESSION_TOKEN_PATTERN = /^[a-f0-9]{16,}$/i;
const STATION_ID_PATTERN = /^[A-Za-z0-9:_-]{3,128}$/;
const FAVORITES_KEY_PREFIX = "radio:favorites:";
const FAVORITES_CLIENT_KEY_PREFIX = `${FAVORITES_KEY_PREFIX}client:`;
const MAX_FAVORITES = 6;
const FAVORITES_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const FAVORITES_STORAGE_VERSION = 2;
const FAVORITES_SESSION_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

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

function buildFavoritesKey(sessionToken, clientSessionId = null) {
  if (clientSessionId) {
    return `${FAVORITES_CLIENT_KEY_PREFIX}${clientSessionId}`;
  }
  return `${FAVORITES_KEY_PREFIX}${sessionToken}`;
}

function extractFavoritesSessionId(req) {
  const raw = req.get("x-favorites-session");
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!FAVORITES_SESSION_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizeStoredStationSnapshot(station) {
  if (!station || typeof station !== "object") {
    return null;
  }

  const { id, name, streamUrl } = station;
  if (typeof id !== "string" || typeof name !== "string" || typeof streamUrl !== "string") {
    return null;
  }

  const snapshot = {
    id,
    name,
    streamUrl,
    homepage: typeof station.homepage === "string" ? station.homepage : null,
    favicon: typeof station.favicon === "string" ? station.favicon : null,
    country: typeof station.country === "string" ? station.country : null,
    countryCode: typeof station.countryCode === "string" ? station.countryCode : null,
    state: typeof station.state === "string" ? station.state : null,
    languages: Array.isArray(station.languages)
      ? station.languages.filter((value) => typeof value === "string")
      : [],
    tags: Array.isArray(station.tags)
      ? station.tags.filter((value) => typeof value === "string")
      : [],
    bitrate: Number.isFinite(station.bitrate) ? station.bitrate : null,
    codec: typeof station.codec === "string" ? station.codec : null,
    hls: Boolean(station.hls),
    isOnline: Boolean(station.isOnline),
    clickCount: Number.isFinite(station.clickCount) ? station.clickCount : 0,
  };

  return snapshot;
}

function dedupeEntries(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const sanitizedId = sanitizeStationId(entry.id);
    if (!sanitizedId || seen.has(sanitizedId)) continue;
    seen.add(sanitizedId);
    result.push({
      id: sanitizedId,
      savedAt:
        typeof entry.savedAt === "number" && Number.isFinite(entry.savedAt) ? entry.savedAt : Date.now(),
      station: normalizeStoredStationSnapshot(entry.station) ?? null,
    });
    if (result.length >= MAX_FAVORITES) {
      break;
    }
  }
  return result;
}

function normalizeFavoriteEntriesFromRaw(raw) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw
      .map((id) => ({
        id,
        savedAt: Date.now(),
        station: null,
      }))
      .filter((entry) => typeof entry.id === "string");
  }
  if (typeof raw === "object") {
    if (Array.isArray(raw.entries)) {
      return raw.entries
        .map((entry) => ({
          id: entry?.id,
          savedAt: entry?.savedAt,
          station: entry?.station,
        }))
        .filter((entry) => typeof entry.id === "string");
    }
    if (Array.isArray(raw.items)) {
      return normalizeFavoriteEntriesFromRaw(raw.items);
    }
  }
  return [];
}

function hasSnapshotChanged(existing, projected) {
  if (!existing) {
    return true;
  }
  try {
    return JSON.stringify(existing) !== JSON.stringify(projected);
  } catch (_error) {
    return true;
  }
}

async function refreshFavoritesExpiry(redis, key) {
  try {
    await redis.expire(key, FAVORITES_TTL_SECONDS);
  } catch (_error) {
    // ignore expire failures
  }
}

async function readFavorites(redis, key) {
  try {
    const raw = await redis.get(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return dedupeEntries(normalizeFavoriteEntriesFromRaw(parsed));
  } catch {
    return [];
  }
}

async function writeFavorites(redis, key, favorites) {
  const payload = {
    version: FAVORITES_STORAGE_VERSION,
    entries: dedupeEntries(favorites).map((entry) => ({
      id: entry.id,
      savedAt: entry.savedAt,
      station: entry.station ?? null,
    })),
  };
  await redis.set(key, JSON.stringify(payload), "EX", FAVORITES_TTL_SECONDS);
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

async function respondWithFavorites(
  res,
  redis,
  key,
  favorites,
  stationsLoader,
  { stationsById: providedStationsById } = {},
) {
  const normalizedFavorites = dedupeEntries(favorites);

  let stationsById = providedStationsById ?? null;
  if (!stationsById) {
    const { payload } = await stationsLoader();
    stationsById = resolveStationsById(payload);
  }

  const nextFavorites = [];
  const items = [];
  let shouldPersist = false;

  for (const favorite of normalizedFavorites) {
    const station = stationsById.get(favorite.id);
    if (station) {
      const projected = projectStationForClient(station);
      items.push(projected);
      if (hasSnapshotChanged(favorite.station, projected)) {
        shouldPersist = true;
      }
      nextFavorites.push({
        id: favorite.id,
        savedAt: favorite.savedAt,
        station: projected,
      });
      continue;
    }

    if (favorite.station) {
      items.push(favorite.station);
    }
    nextFavorites.push(favorite);
  }

  if (shouldPersist || nextFavorites.length !== normalizedFavorites.length) {
    await writeFavorites(redis, key, nextFavorites);
  } else {
    await refreshFavoritesExpiry(redis, key);
  }

  res.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  res.json({
    meta: {
      maxSlots: MAX_FAVORITES,
    },
    items,
  });

  return nextFavorites;
}

export function registerFavoritesRoutes(app, { ensureRedis, redis, stationsLoader }) {
  app.get("/favorites", async (req, res) => {
    const session = extractSessionToken(req);
    if (!session.ok) {
      res.status(session.status).json({ error: session.error });
      return;
    }

    const favoritesSessionHeader = extractFavoritesSessionId(req);

    try {
      await ensureRedis();
      const key = buildFavoritesKey(session.value, favoritesSessionHeader);
      const favorites = await readFavorites(redis, key);
      await respondWithFavorites(res, redis, key, favorites, stationsLoader);
    } catch (error) {
      logger.error("favorites.read_error", { session: session.value, error });
      res.status(500).json({ error: "Failed to load favorites" });
    }
  });

  app.put("/favorites/:stationId", async (req, res) => {
    const session = extractSessionToken(req);
    if (!session.ok) {
      res.status(session.status).json({ error: session.error });
      return;
    }

    const favoritesSessionHeader = extractFavoritesSessionId(req);

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
      const key = buildFavoritesKey(session.value, favoritesSessionHeader);
      const favorites = await readFavorites(redis, key);
      const existingIndex = favorites.findIndex((entry) => entry.id === sanitizedStationId);

      const { payload } = await stationsLoader();
      const stationsById = resolveStationsById(payload);
      const stationRecord = stationsById.get(sanitizedStationId);
      if (!stationRecord) {
        res.status(404).json({ error: "Station not found" });
        return;
      }
      const projectedStation = projectStationForClient(stationRecord);
      const now = Date.now();

      if (existingIndex !== -1 && requestedSlot === null) {
        const updatedFavorites = favorites.slice();
        const current = updatedFavorites[existingIndex];
        if (hasSnapshotChanged(current.station, projectedStation)) {
          updatedFavorites[existingIndex] = {
            ...current,
            station: projectedStation,
            savedAt: now,
          };
          await writeFavorites(redis, key, updatedFavorites);
        } else {
          await refreshFavoritesExpiry(redis, key);
        }
        await respondWithFavorites(res, redis, key, updatedFavorites, stationsLoader, {
          stationsById,
        });
        return;
      }

      let nextFavorites = favorites.filter((entry) => entry.id !== sanitizedStationId);
      const newEntry = {
        id: sanitizedStationId,
        savedAt: now,
        station: projectedStation,
      };

      if (requestedSlot !== null) {
        const slot = Math.max(0, Math.min(requestedSlot, MAX_FAVORITES - 1));
        if (slot < nextFavorites.length) {
          nextFavorites[slot] = newEntry;
        } else {
          if (nextFavorites.length >= MAX_FAVORITES) {
            res.status(409).json({ error: "All favorite slots are already filled" });
            return;
          }
          nextFavorites.push(newEntry);
        }
      } else {
        if (nextFavorites.length >= MAX_FAVORITES) {
          res.status(409).json({ error: "All favorite slots are already filled" });
          return;
        }
        nextFavorites.push(newEntry);
      }

      nextFavorites = dedupeEntries(nextFavorites);

      await writeFavorites(redis, key, nextFavorites);
      await respondWithFavorites(res, redis, key, nextFavorites, stationsLoader, {
        stationsById,
      });
    } catch (error) {
      logger.error("favorites.save_error", {
        session: session.value,
        stationId: sanitizedStationId,
        error,
      });
      res.status(500).json({ error: "Failed to save favorite" });
    }
  });

  app.delete("/favorites/:stationId", async (req, res) => {
    const session = extractSessionToken(req);
    if (!session.ok) {
      res.status(session.status).json({ error: session.error });
      return;
    }

    const favoritesSessionHeader = extractFavoritesSessionId(req);

    const sanitizedStationId = sanitizeStationId(req.params.stationId);
    if (!sanitizedStationId) {
      res.status(400).json({ error: "Invalid station identifier" });
      return;
    }

    try {
      await ensureRedis();
      const key = buildFavoritesKey(session.value, favoritesSessionHeader);
      const favorites = await readFavorites(redis, key);
      const nextFavorites = favorites.filter((entry) => entry.id !== sanitizedStationId);
      if (nextFavorites.length !== favorites.length) {
        await writeFavorites(redis, key, nextFavorites);
      } else {
        await refreshFavoritesExpiry(redis, key);
      }
      await respondWithFavorites(res, redis, key, nextFavorites, stationsLoader);
    } catch (error) {
      logger.error("favorites.delete_error", {
        session: session.value,
        stationId: sanitizedStationId,
        error,
      });
      res.status(500).json({ error: "Failed to remove favorite" });
    }
  });
}
