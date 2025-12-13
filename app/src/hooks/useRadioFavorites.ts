import { useCallback, useEffect, useMemo, useState } from "react";

import { authorizedFetch } from "@/lib/gateway-session";
import { getFavoritesSessionId } from "@/lib/favorites-session";
import { RADIO_API_BASE, type RadioStation } from "./useRadioStations";

type FavoritesResponse = {
  items: RadioStation[];
  meta: {
    maxSlots: number;
  };
};

const DEFAULT_MAX_SLOTS = 6;
const FAVORITES_ENDPOINT = `${RADIO_API_BASE}/favorites`;
const FAVORITES_SESSION_HEADER = "X-Favorites-Session";
const STALE_TIME = 30 * 1000; // 30 seconds

function withFavoritesSession(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers ?? {});
  headers.set(FAVORITES_SESSION_HEADER, getFavoritesSessionId());
  return {
    ...init,
    headers,
  };
}

function normalizeFavoritesResponse(payload: unknown): FavoritesResponse {
  const value = typeof payload === "object" && payload !== null ? payload : {};
  const items = Array.isArray((value as { items?: unknown }).items)
    ? ((value as { items?: RadioStation[] }).items ?? [])
    : [];

  let maxSlots = DEFAULT_MAX_SLOTS;
  const metaCandidate = (value as { meta?: { maxSlots?: unknown } }).meta;
  if (
    metaCandidate &&
    typeof metaCandidate === "object" &&
    metaCandidate !== null &&
    Number.isFinite((metaCandidate as { maxSlots?: number }).maxSlots)
  ) {
    const parsed = Number((metaCandidate as { maxSlots?: number }).maxSlots);
    if (Number.isFinite(parsed) && parsed > 0) {
      maxSlots = Math.min(parsed, 12);
    }
  }

  return {
    items,
    meta: {
      maxSlots,
    },
  };
}

async function parseFavoritesResponse(response: Response): Promise<FavoritesResponse> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      (payload && typeof (payload as { error?: unknown }).error === "string"
        ? ((payload as { error?: string }).error as string)
        : null) ?? `Request failed with status ${response.status}`;
    const error = new Error(message);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return normalizeFavoritesResponse(payload);
}

async function fetchFavorites(signal?: AbortSignal): Promise<FavoritesResponse> {
  const response = await authorizedFetch(
    FAVORITES_ENDPOINT,
    withFavoritesSession({ signal }),
  );
  return parseFavoritesResponse(response);
}

export function useRadioFavorites() {
  const [data, setData] = useState<FavoritesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastFetched, setLastFetched] = useState<number>(0);

  // Fetch favorites
  const fetchData = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await fetchFavorites(signal);
      if (!signal?.aborted) {
        setData(result);
        setLastFetched(Date.now());
        setError(null);
      }
    } catch (err) {
      if (!signal?.aborted) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    const controller = new AbortController();

    setIsLoading(true);
    fetchData(controller.signal).finally(() => {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    });

    return () => controller.abort();
  }, [fetchData]);

  // Refetch function (for manual refresh)
  const refetch = useCallback(async () => {
    setIsFetching(true);
    await fetchData();
    setIsFetching(false);
  }, [fetchData]);

  // Add favorite
  const addFavorite = useCallback(
    async (stationId: string, slot?: number) => {
      setIsSaving(true);
      setError(null);

      try {
        const url = `${FAVORITES_ENDPOINT}/${encodeURIComponent(stationId)}`;
        const init: RequestInit =
          typeof slot === "number"
            ? {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ slot }),
              }
            : { method: "PUT" };

        const response = await authorizedFetch(url, withFavoritesSession(init));
        const result = await parseFavoritesResponse(response);

        setData(result);
        setLastFetched(Date.now());
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  // Remove favorite
  const removeFavorite = useCallback(
    async (stationId: string) => {
      setIsSaving(true);
      setError(null);

      try {
        const url = `${FAVORITES_ENDPOINT}/${encodeURIComponent(stationId)}`;
        const response = await authorizedFetch(url, withFavoritesSession({ method: "DELETE" }));
        const result = await parseFavoritesResponse(response);

        setData(result);
        setLastFetched(Date.now());
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  // Toggle favorite
  const toggleFavorite = useCallback(
    async (stationId: string, options?: { slot?: number }) => {
      const isFavorite = data?.items.some((station) => station.id === stationId);

      if (isFavorite) {
        await removeFavorite(stationId);
      } else {
        await addFavorite(stationId, options?.slot);
      }
    },
    [data?.items, addFavorite, removeFavorite]
  );

  const favorites = useMemo(() => data?.items ?? [], [data?.items]);
  const maxSlots = data?.meta.maxSlots ?? DEFAULT_MAX_SLOTS;
  const favoriteIds = useMemo(() => new Set(favorites.map((station) => station.id)), [favorites]);

  return {
    favorites,
    favoriteIds,
    maxSlots,
    isLoading,
    isFetching,
    isSaving,
    error,
    refetch,
    addFavorite,
    removeFavorite,
    toggleFavorite,
  };
}
