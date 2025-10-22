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

function filterStations(stations, { country, language, tag, search, genre }) {
  return stations.filter((station) => {
    if (country) {
      const stationCountry = station.country?.toLowerCase();
      const stationCountryCode = station.countryCode?.toLowerCase();
      if (stationCountry !== country && stationCountryCode !== country) {
        return false;
      }
    }

    if (language) {
      const languages = Array.isArray(station.languages) ? station.languages : [];
      if (!languages.some((item) => item.toLowerCase() === language)) {
        return false;
      }
    }

    if (tag) {
      const tags = Array.isArray(station.tags) ? station.tags : [];
      if (!tags.some((item) => item.toLowerCase() === tag)) {
        return false;
      }
    }

    if (genre) {
      const tags = Array.isArray(station.tags) ? station.tags : [];
      if (!tags.some((item) => item.toLowerCase() === genre)) {
        return false;
      }
    }

    if (search) {
      const nameMatch = station.name?.toLowerCase().includes(search) ?? false;
      const tagMatch = (Array.isArray(station.tags) ? station.tags : []).some((item) =>
        item.toLowerCase().includes(search),
      );
      const languageMatch = (Array.isArray(station.languages) ? station.languages : []).some(
        (item) => item.toLowerCase().includes(search),
      );
      if (!nameMatch && !tagMatch && !languageMatch) {
        return false;
      }
    }

    return true;
  });
}

export function registerStationsRoutes(
  app,
  { config, ensureRedis, stationsLoader, updateStations, redis },
) {
  app.get("/stations", async (req, res) => {
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

      const filtered = filterStations(stations, {
        country,
        language,
        tag,
        search,
        genre,
      });

      const matches = [];
      let matchesSeen = 0;
      let hasMore = false;

      for (const station of filtered) {
        if (matchesSeen >= offset && matches.length < limit) {
          matches.push(station);
        } else if (matches.length >= limit && matchesSeen >= offset) {
          hasMore = true;
        }
        matchesSeen += 1;
      }

      const response = buildStationsResponse({
        stations,
        matches,
        totalMatches: matchesSeen,
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
