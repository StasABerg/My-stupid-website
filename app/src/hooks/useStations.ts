import { useEffect, useMemo, useRef, useState } from "preact/hooks";

export type Station = {
  id: string;
  name: string;
  streamUrl: string;
  country?: string | null;
  tags?: string[] | null;
  favicon?: string | null;
  codec?: string | null;
  bitrate?: number | null;
  hls?: boolean;
};

export type StationsResult = {
  stations: Station[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

const FAVORITES_KEY = "gitgud-radio-favorites";

export const useFavorites = () => {
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(FAVORITES_KEY);
      if (!stored) return new Set();
      return new Set(JSON.parse(stored));
    } catch {
      return new Set();
    }
  });

  const toggle = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(next)));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return { favorites, toggle };
};

export const useStations = (apiBase: string): StationsResult => {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef<Station[] | null>(null);

  const fetchStations = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${apiBase}/stations?limit=200&order=clickcount&reverse=true`, {
        headers: { accept: "application/json" },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as Station[];
      cache.current = data;
      setStations(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      if (cache.current) setStations(cache.current);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStations();
  }, []);

  return useMemo(
    () => ({
      stations,
      loading,
      error,
      refresh: () => void fetchStations(),
    }),
    [stations, loading, error],
  );
};
