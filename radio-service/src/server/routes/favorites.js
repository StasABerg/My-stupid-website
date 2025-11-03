import { logger } from "../../logger.js";
import { projectStationForClient } from "./projectStation.js";
import { schemaRefs } from "../openapi.js";

const SESSION_TOKEN_PATTERN = /^[a-f0-9]{16,}$/i;
const STATION_ID_PATTERN = /^[A-Za-z0-9:_-]{3,128}$/;
const FAVORITES_KEY_PREFIX = "radio:favorites:";
const FAVORITES_CLIENT_KEY_PREFIX = `${FAVORITES_KEY_PREFIX}client:`;
const MAX_FAVORITES = 6;
const FAVORITES_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const FAVORITES_STORAGE_VERSION = 2;
const FAVORITES_SESSION_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === "string") ?? null;
  }
  return typeof value === "string" ? value : null;
}

function extractSessionToken(request) {
  const rawHeader = normalizeHeaderValue(request.headers["x-gateway-session"]);
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

function extractFavoritesSessionId(request) {
  const raw = normalizeHeaderValue(request.headers["x-favorites-session"]);
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
  reply,
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

  reply.header("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  reply.send({
    meta: {
      maxSlots: MAX_FAVORITES,
    },
    items,
  });

  return nextFavorites;
}

export function registerFavoritesRoutes(app, { ensureRedis, redis, stationsLoader }) {
  const favoritesResponseRef = { $ref: schemaRefs.favoritesResponse };
  const standardErrorSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      error: { type: "string" },
    },
  };
  const unauthorizedSchema = {
    ...standardErrorSchema,
    description: "A valid session token was not provided.",
  };
  const getFavoritesSchema = {
    tags: ["Favorites"],
    summary: "Retrieve favorites for a client session",
    description: "Returns the current list of favorite stations stored for the provided session token.",
    response: {
      200: favoritesResponseRef,
      401: unauthorizedSchema,
      500: {
        ...standardErrorSchema,
        description: "The service failed to read favorites from Redis.",
      },
    },
  };

  const upsertFavoriteSchema = {
    tags: ["Favorites"],
    summary: "Add or update a favorite station",
    description:
      "Stores a station as a favorite for the session. Optionally accepts a slot index to control ordering.",
    params: {
      $ref: schemaRefs.stationIdentifierParams,
    },
    body: {
      $ref: schemaRefs.favoritesUpsertBody,
    },
    response: {
      200: favoritesResponseRef,
      400: {
        ...standardErrorSchema,
        description: "The request body or station identifier was invalid.",
      },
      401: unauthorizedSchema,
      404: {
        ...standardErrorSchema,
        description: "The requested station identifier was not found.",
      },
      409: {
        ...standardErrorSchema,
        description: "All favorite slots are filled and no replacement slot was provided.",
      },
      500: {
        ...standardErrorSchema,
        description: "An unexpected error occurred while saving favorites.",
      },
    },
  };

  const deleteFavoriteSchema = {
    tags: ["Favorites"],
    summary: "Remove a favorite station",
    params: {
      $ref: schemaRefs.stationIdentifierParams,
    },
    response: {
      200: favoritesResponseRef,
      400: {
        ...standardErrorSchema,
        description: "The station identifier was invalid.",
      },
      401: unauthorizedSchema,
      500: {
        ...standardErrorSchema,
        description: "The service failed to remove the favorite.",
      },
    },
  };

  app.get("/favorites", { schema: getFavoritesSchema }, async (request, reply) => {
    const session = extractSessionToken(request);
    if (!session.ok) {
      reply.status(session.status).send({ error: session.error });
      return;
    }

    const favoritesSessionHeader = extractFavoritesSessionId(request);

    try {
      await ensureRedis();
      const key = buildFavoritesKey(session.value, favoritesSessionHeader);
      const favorites = await readFavorites(redis, key);
      await respondWithFavorites(reply, redis, key, favorites, stationsLoader);
    } catch (error) {
      logger.error("favorites.read_error", { session: session.value, error });
      reply.status(500).send({ error: "Failed to load favorites" });
    }
  });

  app.put("/favorites/:stationId", { schema: upsertFavoriteSchema }, async (request, reply) => {
    const session = extractSessionToken(request);
    if (!session.ok) {
      reply.status(session.status).send({ error: session.error });
      return;
    }

    const favoritesSessionHeader = extractFavoritesSessionId(request);

    const sanitizedStationId = sanitizeStationId(request.params.stationId);
    if (!sanitizedStationId) {
      reply.status(400).send({ error: "Invalid station identifier" });
      return;
    }

    let requestedSlot = null;
    if (request.body && Object.prototype.hasOwnProperty.call(request.body, "slot")) {
      const slotValue = request.body.slot;
      if (
        Number.isInteger(slotValue) &&
        slotValue >= 0 &&
        slotValue < MAX_FAVORITES
      ) {
        requestedSlot = slotValue;
      } else {
        reply.status(400).send({ error: "Invalid slot index" });
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
        reply.status(404).send({ error: "Station not found" });
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
        await respondWithFavorites(reply, redis, key, updatedFavorites, stationsLoader, {
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
            reply.status(409).send({ error: "All favorite slots are already filled" });
            return;
          }
          nextFavorites.push(newEntry);
        }
      } else {
        if (nextFavorites.length >= MAX_FAVORITES) {
          reply.status(409).send({ error: "All favorite slots are already filled" });
          return;
        }
        nextFavorites.push(newEntry);
      }

      nextFavorites = dedupeEntries(nextFavorites);

      await writeFavorites(redis, key, nextFavorites);
      await respondWithFavorites(reply, redis, key, nextFavorites, stationsLoader, {
        stationsById,
      });
    } catch (error) {
      logger.error("favorites.save_error", {
        session: session.value,
        stationId: sanitizedStationId,
        error,
      });
      reply.status(500).send({ error: "Failed to save favorite" });
    }
  });

  app.delete("/favorites/:stationId", { schema: deleteFavoriteSchema }, async (request, reply) => {
    const session = extractSessionToken(request);
    if (!session.ok) {
      reply.status(session.status).send({ error: session.error });
      return;
    }

    const favoritesSessionHeader = extractFavoritesSessionId(request);

    const sanitizedStationId = sanitizeStationId(request.params.stationId);
    if (!sanitizedStationId) {
      reply.status(400).send({ error: "Invalid station identifier" });
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
      await respondWithFavorites(reply, redis, key, nextFavorites, stationsLoader);
    } catch (error) {
      logger.error("favorites.delete_error", {
        session: session.value,
        stationId: sanitizedStationId,
        error,
      });
      reply.status(500).send({ error: "Failed to remove favorite" });
    }
  });
}
