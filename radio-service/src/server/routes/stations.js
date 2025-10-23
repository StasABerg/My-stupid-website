import { ensureNormalizedStation } from "../../stations/normalize.js";
import { createServiceAuthMiddleware } from "../middleware/serviceAuth.js";

const MAX_GENRE_OPTIONS = 200;

function buildGenreList(stations, { limit = MAX_GENRE_OPTIONS } = {}) {
  const counts = new Map();

  for (const station of stations) {
    const tags = Array.isArray(station.tags) ? station.tags : [];
    for (const tag of tags) {
      const trimmed = tag?.toString().trim();
      if (!trimmed) {
        continue;
      }
      const normalized = trimmed.toLowerCase();
      if (!counts.has(normalized)) {
        counts.set(normalized, { label: trimmed, count: 0 });
      }
      counts.get(normalized).count += 1;
    }
  }

  const sorted = Array.from(counts.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });

  const limited =
    Number.isFinite(limit) && limit > 0
      ? sorted.slice(0, limit)
      : sorted;

  return limited.map((entry) => entry.label);
}

function buildStationsResponse({ stations, matches, totalMatches, meta, config }) {
  return {
    meta: {
      total: stations.length,
      filtered: matches.length,
      matches: totalMatches,
      hasMore: meta.hasMore,
      page: meta.page,
      limit: meta.limit,
      maxLimit: config.api.maxPageSize,
      requestedLimit: meta.requestedLimit,
      offset: meta.offset,
      cacheSource: meta.cacheSource,
      origin: meta.origin,
      updatedAt: meta.updatedAt,
      countries: meta.countries,
      genres: meta.genres,
    },
    items: matches,
  };
}

function stationMatchesFilters(station, { country, language, tag, search, genre }) {
  const normalized = ensureNormalizedStation(station);
  if (!normalized) {
    return false;
  }

  if (country) {
    if (normalized.country !== country && normalized.countryCode !== country) {
      return false;
    }
  }

  if (language && !normalized.languagesSet.has(language)) {
    return false;
  }

  if (tag && !normalized.tagsSet.has(tag)) {
    return false;
  }

  if (genre && !normalized.tagsSet.has(genre)) {
    return false;
  }

  if (search && !normalized.searchText.includes(search)) {
    return false;
  }

  return true;
}

function collectStations(stations, filters, { offset, limit }) {
  const matches = [];
  let totalMatches = 0;
  let hasMore = false;

  const effectiveLimit = Number.isFinite(limit) && limit > 0 ? limit : 0;
  const effectiveOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;

  for (const station of stations) {
    if (!stationMatchesFilters(station, filters)) {
      continue;
    }

    const matchIndex = totalMatches;
    totalMatches += 1;

    if (effectiveLimit > 0 && matchIndex >= effectiveOffset && matches.length < effectiveLimit) {
      matches.push(station);
      continue;
    }

    if (effectiveLimit === 0) {
      if (matchIndex >= effectiveOffset) {
        hasMore = true;
        break;
      }
      continue;
    }

    if (matchIndex >= effectiveOffset + effectiveLimit) {
      hasMore = true;
      break;
    }
  }

  return { matches, totalMatches, hasMore };
}

export function registerStationsRoutes(
  app,
  { config, ensureRedis, stationsLoader, updateStations, redis },
) {
  const requireServiceAuth = createServiceAuthMiddleware(config.serviceAuthToken);

  app.get("/stations", requireServiceAuth, async (req, res) => {
    try {
      await ensureRedis();
      const forceRefresh = req.query.refresh === "true";
      const rawLimit = req.query.limit?.toString().toLowerCase();
      const parsedLimit = Number.parseInt(rawLimit ?? "", 10);
      const limit =
        rawLimit === "all"
          ? config.api.maxPageSize
          : Number.isFinite(parsedLimit) && parsedLimit > 0
            ? Math.min(parsedLimit, config.api.maxPageSize)
            : config.api.defaultPageSize;
      const offsetParam = Number.parseInt(req.query.offset ?? "", 10);
      const pageParam = Number.parseInt(req.query.page ?? "", 10);
      const fallbackPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
      const offsetCandidate =
        Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : (fallbackPage - 1) * limit;
      const offset = Math.max(0, offsetCandidate);
      const page = limit > 0 ? Math.floor(offset / limit) + 1 : 1;

      const language = req.query.language?.toString().toLowerCase();
      const country = req.query.country?.toString().toLowerCase();
      const tag = req.query.tag?.toString().toLowerCase();
      const genre = req.query.genre?.toString().toLowerCase();
      const search = req.query.search?.toString().toLowerCase();

      const { payload, cacheSource } = await stationsLoader({ forceRefresh });
      const stations = Array.isArray(payload?.stations) ? payload.stations : [];

      const availableCountries = Array.from(
        new Set(
          stations
            .map((station) => station.country?.toString().trim() ?? "")
            .filter((value) => value.length > 0),
        ),
      ).sort((a, b) => a.localeCompare(b));

      const availableGenres = buildGenreList(stations);

      const { matches, totalMatches, hasMore } = collectStations(
        stations,
        { country, language, tag, search, genre },
        { offset, limit },
      );

      const response = buildStationsResponse({
        stations,
        matches,
        totalMatches,
        meta: {
          hasMore,
          page,
          limit,
          requestedLimit:
            rawLimit === "all"
              ? "all"
              : Number.isFinite(parsedLimit) && parsedLimit > 0
                ? parsedLimit
                : null,
          offset,
          cacheSource,
          origin: payload?.source ?? null,
          updatedAt: payload?.updatedAt,
          countries: availableCountries,
          genres: availableGenres,
        },
        config,
      });

      res.json(response);
    } catch (error) {
      console.error("stations-error", { message: error.message });
      res.status(500).json({ error: "Failed to load stations" });
    }
  });

  app.post("/stations/refresh", requireServiceAuth, async (_req, res) => {
    try {
      await ensureRedis();
      const { payload, cacheSource } = await updateStations(redis);
      res.json({
        meta: {
          total: payload.total,
          updatedAt: payload.updatedAt,
          cacheSource,
          origin: payload.source ?? null,
        },
      });
    } catch (error) {
      console.error("refresh-error", { message: error.message });
      res.status(500).json({ error: "Failed to refresh stations" });
    }
  });
}
