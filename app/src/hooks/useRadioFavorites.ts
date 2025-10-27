import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authorizedFetch } from "@/lib/gateway-session";
import { RADIO_API_BASE, type RadioStation } from "./useRadioStations";

type FavoritesResponse = {
  items: RadioStation[];
  meta: {
    maxSlots: number;
  };
};

type FavoritesQueryData = FavoritesResponse;

const FAVORITES_QUERY_KEY = ["radio", "favorites"];
const DEFAULT_MAX_SLOTS = 6;
const FAVORITES_ENDPOINT = `${RADIO_API_BASE}/favorites`;

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

async function fetchFavorites(): Promise<FavoritesResponse> {
  const response = await authorizedFetch(FAVORITES_ENDPOINT);
  return parseFavoritesResponse(response);
}

export function useRadioFavorites() {
  const queryClient = useQueryClient();

  const favoritesQuery = useQuery<FavoritesQueryData>({
    queryKey: FAVORITES_QUERY_KEY,
    queryFn: fetchFavorites,
    staleTime: 1000 * 30,
  });

  const setFavoritesCache = useCallback(
    (data: FavoritesResponse) => {
      queryClient.setQueryData(FAVORITES_QUERY_KEY, data);
    },
    [queryClient],
  );

  const addFavoriteMutation = useMutation<
    FavoritesResponse,
    Error,
    { stationId: string; slot?: number }
  >({
    mutationFn: async ({ stationId, slot }) => {
      const url = `${FAVORITES_ENDPOINT}/${encodeURIComponent(stationId)}`;
      const init: RequestInit =
        typeof slot === "number"
          ? {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slot }),
            }
          : { method: "PUT" };

      const response = await authorizedFetch(url, init);
      return parseFavoritesResponse(response);
    },
    onSuccess: setFavoritesCache,
  });

  const removeFavoriteMutation = useMutation<FavoritesResponse, Error, { stationId: string }>({
    mutationFn: async ({ stationId }) => {
      const url = `${FAVORITES_ENDPOINT}/${encodeURIComponent(stationId)}`;
      const response = await authorizedFetch(url, { method: "DELETE" });
      return parseFavoritesResponse(response);
    },
    onSuccess: setFavoritesCache,
  });

  const favorites = useMemo(
    () => favoritesQuery.data?.items ?? [],
    [favoritesQuery.data?.items],
  );
  const maxSlots = favoritesQuery.data?.meta.maxSlots ?? DEFAULT_MAX_SLOTS;

  const favoriteIds = useMemo(() => new Set(favorites.map((station) => station.id)), [favorites]);

  const addFavorite = useCallback(
    async (stationId: string, slot?: number) => addFavoriteMutation.mutateAsync({ stationId, slot }),
    [addFavoriteMutation],
  );

  const removeFavorite = useCallback(
    async (stationId: string) => removeFavoriteMutation.mutateAsync({ stationId }),
    [removeFavoriteMutation],
  );

  const toggleFavorite = useCallback(
    async (stationId: string, options?: { slot?: number }) => {
      if (favoriteIds.has(stationId)) {
        await removeFavoriteMutation.mutateAsync({ stationId });
      } else {
        await addFavoriteMutation.mutateAsync({ stationId, slot: options?.slot });
      }
    },
    [addFavoriteMutation, favoriteIds, removeFavoriteMutation],
  );

  const isSaving = addFavoriteMutation.isPending || removeFavoriteMutation.isPending;
  const error = favoritesQuery.error ?? addFavoriteMutation.error ?? removeFavoriteMutation.error ?? null;

  return {
    favorites,
    favoriteIds,
    maxSlots,
    isLoading: favoritesQuery.isLoading,
    isFetching: favoritesQuery.isFetching,
    isSaving,
    error,
    refetch: favoritesQuery.refetch,
    addFavorite,
    removeFavorite,
    toggleFavorite,
  };
}
