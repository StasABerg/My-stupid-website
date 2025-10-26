import { useInfiniteQuery } from "@tanstack/react-query";

import { authorizedFetch } from "@/lib/gateway-session";

const DEFAULT_LIMIT = Number.parseInt(
  import.meta.env.VITE_RADIO_DEFAULT_LIMIT ?? "200",
  10,
);

const resolveRadioApiBase = () => {
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "/api/radio";
  }
  return "/api/radio";
};

const radioBaseEnv =
  import.meta.env.VITE_RADIO_API_BASE_URL ??
  import.meta.env.VITE_RADIO_API_BASE ??
  resolveRadioApiBase();

export const RADIO_API_BASE = radioBaseEnv.replace(/\/$/, "");

export type RadioStation = {
  id: string;
  name: string;
  streamUrl: string;
  homepage: string | null;
  favicon: string | null;
  country: string | null;
  countryCode: string | null;
  state: string | null;
  languages: string[];
  tags: string[];
  bitrate: number | null;
  codec: string | null;
  hls: boolean;
  isOnline: boolean;
  clickCount: number;
};

export type StationsResponse = {
  meta: {
    total: number;
    filtered: number;
    matches: number;
    hasMore: boolean;
    page: number;
    limit: number;
    maxLimit: number;
    requestedLimit: number | "all" | null;
    offset: number;
    cacheSource: string;
    updatedAt?: string;
    countries?: string[];
    genres?: string[];
    origin?: string | null;
  };
  items: RadioStation[];
};

export type StationFilters = {
  country?: string;
  language?: string;
  tag?: string;
  genre?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

async function fetchStations(filters: StationFilters): Promise<StationsResponse> {
  const params = new URLSearchParams();
  const limit = filters.limit ?? DEFAULT_LIMIT;
  if (limit > 0) params.set("limit", String(limit));
  if (filters.country) params.set("country", filters.country);
  if (filters.language) params.set("language", filters.language);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.genre) params.set("genre", filters.genre);
  if (filters.search) params.set("search", filters.search);
  if (filters.offset && filters.offset > 0) params.set("offset", String(filters.offset));

  const response = await authorizedFetch(`${RADIO_API_BASE}/stations?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to load stations: ${response.status}`);
  }
  return response.json();
}

export function useRadioStations(filters: StationFilters) {
  return useInfiniteQuery({
    queryKey: ["radio-stations", filters],
    queryFn: ({ pageParam = 0 }) =>
      fetchStations({ ...filters, offset: typeof pageParam === "number" ? pageParam : 0 }),
    staleTime: 1000 * 60 * 5,
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (!lastPage.meta.hasMore) {
        return undefined;
      }
      const nextOffset = lastPage.meta.offset + lastPage.meta.limit;
      return Number.isFinite(nextOffset) ? nextOffset : undefined;
    },
  });
}
