import { ensureNormalizedStation } from "../../stations/normalize.js";
import { ensureProcessedStations } from "../../stations/processedPayload.js";
import { parseStationsQuery } from "./stationsQuery.js";
import { projectStationForClient } from "./projectStation.js";

function buildStationsResponse({ totalStations, matches, totalMatches, meta, config }) {
  return {
    meta: {
      total: totalStations,
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
    items: matches.map(projectStationForClient),
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

function intersectCandidateLists(lists) {
  if (lists.length === 0) {
    return [];
  }

  const ordered = [...lists].sort((a, b) => a.length - b.length);
  const [first, ...rest] = ordered;
  if (rest.length === 0) {
    return first.slice();
  }

  const restSets = rest.map((list) => new Set(list));
  return first.filter((station) => restSets.every((set) => set.has(station)));
}

function filterBySearch(candidates, processed, search) {
  if (!search) {
    return candidates;
  }

  return candidates.filter((station) => {
    const index = processed.stationIndex.get(station);
    if (index === undefined) {
      return false;
    }
    const text = processed.searchTexts[index] ?? "";
    return text.includes(search);
  });
}

function collectStations(processed, filters, { offset, limit }) {
  const candidateLists = [];
  const { index } = processed;

  if (filters.country) {
    const matches = index.byCountry.get(filters.country);
    if (!matches) {
      return { matches: [], totalMatches: 0, hasMore: false };
    }
    candidateLists.push(matches);
  }

  if (filters.language) {
    const matches = index.byLanguage.get(filters.language);
    if (!matches) {
      return { matches: [], totalMatches: 0, hasMore: false };
    }
    candidateLists.push(matches);
  }

  if (filters.tag) {
    const matches = index.byTag.get(filters.tag);
    if (!matches) {
      return { matches: [], totalMatches: 0, hasMore: false };
    }
    candidateLists.push(matches);
  }

  if (filters.genre) {
    const matches = index.byTag.get(filters.genre);
    if (!matches) {
      return { matches: [], totalMatches: 0, hasMore: false };
    }
    candidateLists.push(matches);
  }

  let candidates;
  if (candidateLists.length === 0) {
    candidates = processed.stations;
  } else {
    candidates = intersectCandidateLists(candidateLists);
  }

  if (!candidates || candidates.length === 0) {
    return { matches: [], totalMatches: 0, hasMore: false };
  }

  let filtered = filterBySearch(candidates, processed, filters.search);

  if (filters.country || filters.language || filters.tag || filters.genre || filters.search) {
    filtered = filtered.filter((station) => stationMatchesFilters(station, filters));
  }

  const totalMatches = filtered.length;

  if (!Number.isFinite(limit) || limit <= 0) {
    const start = Math.min(offset, filtered.length);
    const matches = start > 0 ? filtered.slice(start) : filtered.slice();
    const hasMore = start > 0 && matches.length > 0;
    return { matches, totalMatches, hasMore };
  }

  const start = Math.min(offset, filtered.length);
  const end = Math.min(start + limit, filtered.length);
  const matches = filtered.slice(start, end);
  const hasMore = end < filtered.length;

  return { matches, totalMatches, hasMore };
}

export function registerStationsRoutes(
  app,
  { config, ensureRedis, stationsLoader, updateStations, redis },
) {
  app.get("/stations", async (req, res) => {
    try {
      await ensureRedis();
      const parsedQuery = parseStationsQuery(req.query, { config });
      if (!parsedQuery.ok) {
        res.status(400).json({
          error: "Invalid query parameters",
          details: parsedQuery.errors,
        });
        return;
      }

      const {
        value: {
          forceRefresh,
          pagination: { limit, offset, page, requestedLimit },
          filters: { country, language, tag, search, genre },
        },
      } = parsedQuery;

      const { payload, cacheSource } = await stationsLoader({ forceRefresh });
      const processed = await ensureProcessedStations(payload);
      const availableCountries = processed.countries;
      const availableGenres = processed.genres;

      const { matches, totalMatches, hasMore } = collectStations(
        processed,
        { country, language, tag, search, genre },
        { offset, limit },
      );

      const response = buildStationsResponse({
        totalStations: processed.stations.length,
        matches,
        totalMatches,
        meta: {
          hasMore,
          page,
          limit,
          requestedLimit,
          offset,
          cacheSource,
          origin: payload?.source ?? null,
          updatedAt: payload?.updatedAt,
          countries: availableCountries,
          genres: availableGenres,
        },
        config,
      });

      res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      res.json(response);
    } catch (error) {
      console.error("stations-error", { message: error.message });
      res.status(500).json({ error: "Failed to load stations" });
    }
  });

  function requireRefreshAuth(req, res, next) {
    const authorization = req.get("authorization") ?? "";
    const expected = `Bearer ${config.refreshToken}`;
    if (authorization !== expected) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  app.post("/stations/refresh", requireRefreshAuth, async (_req, res) => {
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
