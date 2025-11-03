import { logger } from "../../logger.js";
import { ensureNormalizedStation } from "../../stations/normalize.js";
import { ensureProcessedStations } from "../../stations/processedPayload.js";
import { parseStationsQuery } from "./stationsQuery.js";
import { projectStationForClient } from "./projectStation.js";
import { schemaRefs } from "../openapi.js";

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
  const stationsRouteSchema = {
    tags: ["Stations"],
    summary: "List radio stations",
    description:
      "Returns paginated radio stations with optional filters by country, language, tag, genre, or search term.",
    querystring: {
      $ref: schemaRefs.stationsQuerystring,
    },
    response: {
      200: {
        $ref: schemaRefs.stationListResponse,
      },
      400: {
        description: "Invalid query parameters supplied.",
        type: "object",
        additionalProperties: false,
        properties: {
          error: { type: "string" },
          details: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      500: {
        description: "Failed to load stations from cache or storage.",
        type: "object",
        additionalProperties: false,
        properties: {
          error: { type: "string" },
        },
      },
    },
  };

  app.get("/stations", { schema: stationsRouteSchema }, async (request, reply) => {
    try {
      await ensureRedis();
      const parsedQuery = parseStationsQuery(request.query, { config });
      if (!parsedQuery.ok) {
        reply.status(400).send({
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

      reply.header("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      reply.send(response);
    } catch (error) {
      logger.error("stations.load_error", {
        error,
        query: request.query,
      });
      reply.status(500).send({ error: "Failed to load stations" });
    }
  });

  async function requireRefreshAuth(request, reply) {
    const authorization = request.headers["authorization"] ?? "";
    const expected = `Bearer ${config.refreshToken}`;
    if (authorization !== expected) {
      reply.status(401).send({ error: "Unauthorized" });
      return;
    }
  }

  app.post(
    "/stations/refresh",
    { preHandler: requireRefreshAuth },
    async (_request, reply) => {
      try {
        await ensureRedis();
        const { payload, cacheSource } = await updateStations(redis);
        reply.send({
          meta: {
            total: payload.total,
            updatedAt: payload.updatedAt,
            cacheSource,
            origin: payload.source ?? null,
          },
        });
      } catch (error) {
        logger.error("stations.refresh_error", { error });
        reply.status(500).send({ error: "Failed to refresh stations" });
      }
    },
  );
}
