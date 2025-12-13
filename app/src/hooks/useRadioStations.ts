import { useCallback, useEffect, useRef, useState } from "react";
import { authorizedFetch } from "@/lib/gateway-session";

const DEFAULT_LIMIT = Number.parseInt(
  import.meta.env.VITE_RADIO_DEFAULT_LIMIT ?? "40",
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

interface CacheEntry {
  data: StationsResponse;
  timestamp: number;
}

interface Page {
  data: StationsResponse;
  offset: number;
}

function buildCacheKey(filters: StationFilters, offset: number): string {
  const params = new URLSearchParams();
  const limit = filters.limit ?? DEFAULT_LIMIT;
  params.set("limit", String(limit > 0 ? limit : DEFAULT_LIMIT));
  params.set("offset", String(offset));
  if (filters.country) params.set("country", filters.country);
  if (filters.language) params.set("language", filters.language);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.genre) params.set("genre", filters.genre);
  if (filters.search) params.set("search", filters.search);
  return params.toString();
}

function buildUrl(filters: StationFilters, offset: number): string {
  const params = new URLSearchParams();
  const limit = filters.limit ?? DEFAULT_LIMIT;
  if (limit > 0) params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (filters.country) params.set("country", filters.country);
  if (filters.language) params.set("language", filters.language);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.genre) params.set("genre", filters.genre);
  if (filters.search) params.set("search", filters.search);
  return `${RADIO_API_BASE}/stations?${params.toString()}`;
}

const STALE_TIME = 5 * 60 * 1000; // 5 minutes
const REFETCH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 50;

export function useRadioStations(filters: StationFilters) {
  const [pages, setPages] = useState<Page[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const cache = useRef<Map<string, CacheEntry>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);
  const filtersRef = useRef(filters);

  // Update filters ref
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  // Fetch function with cache
  const fetchStations = useCallback(
    async (offset: number, signal?: AbortSignal): Promise<StationsResponse> => {
      const cacheKey = buildCacheKey(filters, offset);
      const cached = cache.current.get(cacheKey);

      // Return cached if fresh
      if (cached && Date.now() - cached.timestamp < STALE_TIME) {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        return cached.data;
      }

      const url = buildUrl(filters, offset);
      const response = await authorizedFetch(url, { signal });

      if (!response.ok) {
        throw new Error(`Failed to load stations: ${response.status}`);
      }

      const data: StationsResponse = await response.json();

      // Update cache
      cache.current.set(cacheKey, { data, timestamp: Date.now() });

      // Limit cache size to prevent unbounded growth
      if (cache.current.size > MAX_CACHE_ENTRIES) {
        const firstKey = cache.current.keys().next().value;
        if (firstKey) cache.current.delete(firstKey);
      }

      return data;
    },
    [filters]
  );

  // Initial fetch
  useEffect(() => {
    // Clear previous data when filters change
    setPages([]);
    setError(null);

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);

    fetchStations(0, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setPages([{ data, offset: 0 }]);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err);
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [fetchStations]);

  // Background refetch (every 5 minutes)
  useEffect(() => {
    if (pages.length === 0) return;

    const interval = setInterval(() => {
      setPages((currentPages) => {
        currentPages.forEach(({ offset }) => {
          fetchStations(offset).catch((err) => {
            console.error('Background refetch failed:', err);
          });
        });
        return currentPages;
      });
    }, REFETCH_INTERVAL);

    return () => clearInterval(interval);
  }, [fetchStations]); // Remove pages from deps

  // Fetch next page
  const fetchNextPage = useCallback(() => {
    if (isFetchingNextPage || isLoading) return;

    const lastPage = pages[pages.length - 1];
    if (!lastPage || !lastPage.data.meta.hasMore) return;

    const nextOffset = lastPage.data.meta.offset + lastPage.data.meta.limit;

    setIsFetchingNextPage(true);

    fetchStations(nextOffset)
      .then((data) => {
        setPages((prev) => [...prev, { data, offset: nextOffset }]);
        setIsFetchingNextPage(false);
      })
      .catch((err) => {
        setError(err);
        setIsFetchingNextPage(false);
      });
  }, [pages, isFetchingNextPage, isLoading, fetchStations]);

  // Flatten pages into single array
  const data = {
    pages: pages.map((p) => p.data),
    pageParams: pages.map((p) => p.offset),
  };

  const hasNextPage = pages.length > 0 && pages[pages.length - 1].data.meta.hasMore;

  return {
    data,
    isLoading,
    isFetchingNextPage,
    error,
    isError: error !== null,
    isFetching: isLoading || isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    refetch: () => {
      cache.current.clear();
      setPages([]);
      setError(null);

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsLoading(true);

      fetchStations(0, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) {
            setPages([{ data, offset: 0 }]);
            setIsLoading(false);
          }
        })
        .catch((err) => {
          if (!controller.signal.aborted) {
            setError(err);
            setIsLoading(false);
          }
        });
    },
  };
}
