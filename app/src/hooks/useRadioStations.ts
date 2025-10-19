import { useQuery } from "@tanstack/react-query";

const DEFAULT_LIMIT = Number.parseInt(
  import.meta.env.VITE_RADIO_DEFAULT_LIMIT ?? "200",
  10,
);
export const RADIO_API_BASE =
  import.meta.env.VITE_RADIO_API_BASE_URL?.replace(/\/$/, "") ?? "/api/radio";

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
  coordinates: { lat: number; lon: number } | null;
  bitrate: number | null;
  codec: string | null;
  hls: boolean;
  isOnline: boolean;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  clickCount: number;
  clickTrend: number;
  votes: number;
};

export type StationsResponse = {
  meta: {
    total: number;
    filtered: number;
    cacheSource: string;
    updatedAt?: string;
    countries?: string[];
    origin?: string | null;
  };
  items: RadioStation[];
};

export type StationFilters = {
  country?: string;
  language?: string;
  tag?: string;
  search?: string;
  limit?: number;
};

async function fetchStations(filters: StationFilters): Promise<StationsResponse> {
  const params = new URLSearchParams();
  const limit = filters.limit ?? DEFAULT_LIMIT;
  if (limit > 0) params.set("limit", String(limit));
  if (filters.country) params.set("country", filters.country);
  if (filters.language) params.set("language", filters.language);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.search) params.set("search", filters.search);

  const response = await fetch(`${RADIO_API_BASE}/stations?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to load stations: ${response.status}`);
  }
  return response.json();
}

export function useRadioStations(filters: StationFilters) {
  return useQuery({
    queryKey: ["radio-stations", filters],
    queryFn: () => fetchStations(filters),
    staleTime: 1000 * 60 * 5,
  });
}
