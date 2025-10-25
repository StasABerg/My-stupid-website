import { ensureNormalizedStation } from "./normalize.js";

export const MAX_GENRE_OPTIONS = 200;

function addToMap(map, key, value) {
  if (!key) {
    return;
  }
  if (!map.has(key)) {
    map.set(key, [value]);
    return;
  }
  map.get(key).push(value);
}

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

  const limited = Number.isFinite(limit) && limit > 0 ? sorted.slice(0, limit) : sorted;
  return limited.map((entry) => entry.label);
}

function mapToRecord(map) {
  const record = Object.create(null);
  for (const [key, values] of map.entries()) {
    record[key] = values;
  }
  return record;
}

export function computeStationsMetadata(stations) {
  const countries = new Set();
  const byCountry = new Map();
  const byLanguage = new Map();
  const byTag = new Map();

  const searchTexts = new Array(stations.length);

  stations.forEach((station, index) => {
    const normalized = ensureNormalizedStation(station);
    if (!normalized) {
      searchTexts[index] = "";
      return;
    }

    if (typeof station.country === "string" && station.country.trim().length > 0) {
      countries.add(station.country.trim());
    }

    addToMap(byCountry, normalized.country, index);
    addToMap(byCountry, normalized.countryCode, index);

    for (const language of normalized.languagesSet) {
      addToMap(byLanguage, language, index);
    }

    for (const tag of normalized.tagsSet) {
      addToMap(byTag, tag, index);
    }

    searchTexts[index] = normalized.searchText;
  });

  return {
    countries: Array.from(countries).sort((a, b) => a.localeCompare(b)),
    genres: buildGenreList(stations),
    byCountry: mapToRecord(byCountry),
    byLanguage: mapToRecord(byLanguage),
    byTag: mapToRecord(byTag),
    searchTexts,
  };
}
