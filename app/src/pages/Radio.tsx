import { Heart } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useLocation } from "react-router-dom";
import {
  FilterPanel,
  PresetButtons,
  RadioHeader,
  ScannerControl,
  StationInfoPanel,
  StatusFooter,
} from "@/components/Radio";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/use-toast";
import { TerminalHeader, TerminalPrompt, TerminalWindow } from "@/components/SecureTerminal";
import { RADIO_API_BASE, useRadioStations, type RadioStation } from "@/hooks/useRadioStations";
import { useRadioFavorites } from "@/hooks/useRadioFavorites";
import { authorizedFetch, ensureGatewaySession } from "@/lib/gateway-session";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { logger } from "@/lib/logger";

type HlsModule = typeof import("hls.js/dist/hls.light.min.js");
type HlsConstructor = HlsModule["default"];
type HlsInstance = InstanceType<HlsConstructor>;

let hlsModulePromise: Promise<HlsModule> | null = null;

async function loadHlsModule(): Promise<HlsModule> {
  if (!hlsModulePromise) {
    hlsModulePromise = import("hls.js/dist/hls.light.min.js");
  }
  return hlsModulePromise;
}

const presetColors = [
  "text-terminal-green",
  "text-terminal-cyan",
  "text-terminal-magenta",
  "text-terminal-yellow",
  "text-terminal-red",
];

const formatFrequency = (index: number) => (87.5 + index * 0.2).toFixed(1);

const fallbackStation: RadioStation = {
  id: "static-noise",
  name: "Signal Lost",
  streamUrl: "",
  homepage: null,
  favicon: null,
  country: null,
  countryCode: null,
  state: null,
  languages: [],
  tags: [],
  bitrate: null,
  codec: null,
  hls: false,
  isOnline: false,
  clickCount: 0,
};

const MIDNIGHT_PRESETS: RadioStation[] = [
  {
    id: "midnight-rickroll",
    name: "????",
    streamUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&loop=1&playlist=dQw4w9WgXcQ",
    homepage: null,
    favicon: null,
    country: "Secret Broadcast",
    countryCode: null,
    state: null,
    languages: ["English"],
    tags: ["mystery", "midnight"],
    bitrate: 128,
    codec: "MP3",
    hls: false,
    isOnline: true,
    clickCount: 0,
  },
  {
    id: "midnight-lofi",
    name: "????",
    streamUrl: "https://www.youtube.com/embed/jfKfPfyJRdk?autoplay=1",
    homepage: null,
    favicon: null,
    country: "Secret Broadcast",
    countryCode: null,
    state: null,
    languages: ["Instrumental"],
    tags: ["secret", "night"],
    bitrate: 128,
    codec: "MP3",
    hls: false,
    isOnline: true,
    clickCount: 0,
  },
];

const isMidnightHour = () => new Date().getHours() === 0;
const randomMidnightStation = () =>
  MIDNIGHT_PRESETS[Math.floor(Math.random() * MIDNIGHT_PRESETS.length)];
const SECRET_BROADCAST_VIDEOS: Record<
  string,
  { embed: string; watch: string; label: string }
> = {
  "midnight-rickroll": {
    embed:
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&loop=1&playlist=dQw4w9WgXcQ&controls=0&modestbranding=1&rel=0",
    watch: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    label: "80s Eternal Rick Broadcast",
  },
  "midnight-lofi": {
    embed:
      "https://www.youtube-nocookie.com/embed/jfKfPfyJRdk?autoplay=1&controls=0&modestbranding=1&rel=0&enablejsapi=1",
    watch: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
    label: "Lofi Girl Control Tower",
  },
};

type StationOverride = {
  station: RadioStation;
  allowUnknown?: boolean;
};

type ShareableStation = Pick<
  RadioStation,
  | "id"
  | "name"
  | "streamUrl"
  | "homepage"
  | "favicon"
  | "country"
  | "countryCode"
  | "state"
  | "languages"
  | "tags"
  | "bitrate"
  | "codec"
  | "hls"
  | "isOnline"
  | "clickCount"
>;

type SharedStationPayload = {
  version: number;
  station: ShareableStation;
};

const SHARE_QUERY_PARAM = "share";
const SHARE_PAYLOAD_VERSION = 1;

const PAGE_SIZE = 40;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

const serializeStationForShare = (station: RadioStation): string => {
  const payload: SharedStationPayload = {
    version: SHARE_PAYLOAD_VERSION,
    station: {
      id: station.id,
      name: station.name,
      streamUrl: station.streamUrl,
      homepage: station.homepage,
      favicon: station.favicon,
      country: station.country,
      countryCode: station.countryCode,
      state: station.state,
      languages: Array.isArray(station.languages) ? station.languages : [],
      tags: Array.isArray(station.tags) ? station.tags : [],
      bitrate: station.bitrate,
      codec: station.codec,
      hls: Boolean(station.hls),
      isOnline: Boolean(station.isOnline),
      clickCount: station.clickCount,
    },
  };

  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
};

const deserializeSharedStation = (encoded: string): RadioStation | null => {
  if (!encoded) {
    return null;
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(encoded)))) as SharedStationPayload;
    if (!parsed || parsed.version !== SHARE_PAYLOAD_VERSION || !parsed.station?.id) {
      return null;
    }
    const station = parsed.station;
    if (!station.streamUrl) {
      return null;
    }

    return {
      ...fallbackStation,
      ...station,
      hls: Boolean(station.hls),
      isOnline: Boolean(station.isOnline),
      languages: Array.isArray(station.languages) ? station.languages : [],
      tags: Array.isArray(station.tags) ? station.tags : [],
      bitrate: typeof station.bitrate === "number" ? station.bitrate : null,
      codec: station.codec ?? null,
      homepage: station.homepage ?? null,
      favicon: station.favicon ?? null,
      country: station.country ?? null,
      countryCode: station.countryCode ?? null,
      state: station.state ?? null,
      clickCount: typeof station.clickCount === "number" ? station.clickCount : fallbackStation.clickCount,
    };
  } catch (error) {
    logger.warn("share.parse_failed", { error });
    return null;
  }
};

const Radio = () => {
  const location = useLocation();
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [genre, setGenre] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [presetStationOverride, setPresetStationOverride] = useState<StationOverride | null>(null);
  const [volume, setVolume] = useState(0.65);
  const [playbackKey, setPlaybackKey] = useState(0);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [midnightActive, setMidnightActive] = useState(() => isMidnightHour());
  const [mysteryStation, setMysteryStation] = useState<RadioStation>(() => randomMidnightStation());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<HlsInstance | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const loadMoreRef = useRef<HTMLLIElement | null>(null);
  const reconnectStateRef = useRef<{ attempts: number; timer: ReturnType<typeof setTimeout> | null }>({
    attempts: 0,
    timer: null,
  });
  const unmountedRef = useRef(false);
  const shareButtonRef = useRef<HTMLButtonElement | null>(null);
  const copyButtonRef = useRef<HTMLButtonElement | null>(null);

  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const lastShareParamRef = useRef<string | null>(null);
  const shareParam = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get(SHARE_QUERY_PARAM);
  }, [location.search]);
  useEffect(() => {
    const interval = setInterval(() => {
      const active = isMidnightHour();
      setMidnightActive((prev) => {
        if (!prev && active) {
          setMysteryStation(randomMidnightStation());
        }
        return active;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      country: country || undefined,
      genre: genre || undefined,
      limit: PAGE_SIZE,
    }),
    [debouncedSearch, country, genre],
  );

  const {
    data,
    isLoading,
    isError,
    isFetching,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useRadioStations(filters);

  const {
    favorites,
    favoriteIds,
    maxSlots: maxFavoriteSlots,
    isLoading: favoritesLoading,
    isSaving: isSavingFavorite,
    toggleFavorite,
    removeFavorite,
  } = useRadioFavorites();

  const pages = useMemo(() => data?.pages ?? [], [data]);
  const displayStations = useMemo(
    () => pages.flatMap((pageData) => pageData.items),
    [pages],
  );
  const firstMeta = pages.length > 0 ? pages[0].meta : undefined;
  const lastMeta = pages.length > 0 ? pages[pages.length - 1].meta : undefined;

  const boundedSelectedIndex =
    displayStations.length === 0
      ? 0
      : Math.min(selectedIndex, displayStations.length - 1);

  const sanitizedPresetStationOverride = useMemo(() => {
    if (!presetStationOverride) {
      return null;
    }
    const { station, allowUnknown } = presetStationOverride;
    if (allowUnknown) {
      return station;
    }
    const existsInFavorites = favorites.some((favorite) => favorite.id === station.id);
    const existsInDirectory = displayStations.some((candidate) => candidate.id === station.id);
    return existsInFavorites || existsInDirectory ? station : null;
  }, [presetStationOverride, favorites, displayStations]);

  const activeDirectoryStation = displayStations[boundedSelectedIndex] ?? fallbackStation;
  const activeStation = sanitizedPresetStationOverride ?? activeDirectoryStation;
  const activeStationIndex = useMemo(
    () => displayStations.findIndex((station) => station.id === activeStation.id),
    [activeStation.id, displayStations],
  );
  const frequencyLabel =
    activeStationIndex !== -1 ? `${formatFrequency(activeStationIndex)} FM` : "Preset";
  const [resolvedStreamUrl, setResolvedStreamUrl] = useState<string | null>(null);
  const shareLink = useMemo(() => {
    if (typeof window === "undefined" || typeof window.btoa !== "function") {
      return null;
    }
    if (!activeStation.id || !activeStation.streamUrl) {
      return null;
    }
    try {
      const encodedStation = serializeStationForShare(activeStation);
      return `${window.location.origin}/radio?${SHARE_QUERY_PARAM}=${encodeURIComponent(encodedStation)}`;
    } catch (error) {
      logger.warn("share.link_build_failed", {
        stationId: activeStation.id,
        error,
      });
      return null;
    }
  }, [activeStation]);

  useEffect(() => {
    let cancelled = false;
    async function resolveStreamUrl() {
      if (SECRET_BROADCAST_VIDEOS[activeStation.id ?? ""]) {
        if (!cancelled) {
          setResolvedStreamUrl(null);
        }
        return;
      }
      if (!activeStation.id || !activeStation.streamUrl) {
        if (!cancelled) {
          setResolvedStreamUrl(null);
        }
        return;
      }

      const encodedId = encodeURIComponent(activeStation.id);
      let streamPath = `${RADIO_API_BASE}/stations/${encodedId}/stream`;

      try {
        const session = await ensureGatewaySession();
        if (session.token && session.token.length > 0) {
          const params = new URLSearchParams();
          params.set("csrfToken", session.token);
          if (session.proof && session.proof.length > 0) {
            params.set("csrfProof", session.proof);
          }
          streamPath = `${streamPath}?${params.toString()}`;
        }
      } catch {
        // ignore token resolution errors; fall back to unsigned streamPath
      }

      if (!cancelled) {
        setResolvedStreamUrl(streamPath);
      }
    }

    resolveStreamUrl();

    return () => {
      cancelled = true;
    };
  }, [activeStation.hls, activeStation.id, activeStation.streamUrl]);

  const uniqueCountries = useMemo(() => {
    const fromMeta = firstMeta?.countries;
    if (Array.isArray(fromMeta) && fromMeta.length > 0) {
      return fromMeta;
    }

    const seen = new Set<string>();
    const options = displayStations
      .map((station) => station.country)
      .filter((value): value is string => Boolean(value));

    return options.filter((entry) => {
      const lower = entry.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
  }, [displayStations, firstMeta?.countries]);

  const uniqueGenres = useMemo(() => {
    const fromMeta = firstMeta?.genres;
    if (Array.isArray(fromMeta) && fromMeta.length > 0) {
      return [...fromMeta].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
    }

    const seen = new Map<string, string>();
    for (const station of displayStations) {
      const tags = Array.isArray(station.tags) ? station.tags : [];
      for (const tag of tags) {
        const trimmed = tag.trim();
        if (!trimmed) continue;
        const lower = trimmed.toLowerCase();
        if (!seen.has(lower)) {
          seen.set(lower, trimmed);
        }
      }
    }

    return Array.from(seen.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [displayStations, firstMeta?.genres]);

  const copyShareLink = useCallback(
    async (reason: "auto" | "manual") => {
      if (!shareLink) {
        return;
      }
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        toast({
          title: "Copy unavailable",
          description: "Clipboard access is blocked in this browser.",
          variant: "destructive",
        });
        return;
      }
      try {
        await navigator.clipboard.writeText(shareLink);
        toast({
          title: "Copied to clipboard",
          description: reason === "auto" ? "Share link ready to paste." : "Share link copied again.",
        });
      } catch (error) {
        toast({
          title: "Copy failed",
          description: error instanceof Error ? error.message : "Unable to copy the share link.",
          variant: "destructive",
        });
      }
    },
    [shareLink],
  );

  useEffect(() => {
    if (!shareParam) {
      if (lastShareParamRef.current) {
        lastShareParamRef.current = null;
      }
      return;
    }
    if (lastShareParamRef.current === shareParam) {
      return;
    }
    lastShareParamRef.current = shareParam;
    const sharedStation = deserializeSharedStation(shareParam);
    if (!sharedStation) {
      toast({
        title: "Invalid share link",
        description: "We couldn't load the station that was shared.",
        variant: "destructive",
      });
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing share links requires overriding the current station.
    setPresetStationOverride({ station: sharedStation, allowUnknown: true });
    setSelectedIndex(0);
  }, [shareParam]);

  useEffect(() => {
    if (!shareDialogOpen) {
      return;
    }
    void copyShareLink("auto");
  }, [shareDialogOpen, copyShareLink]);

  useEffect(() => {
    if (!shareDialogOpen) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "d" && !event.shiftKey) {
        event.preventDefault();
        setShareDialogOpen(false);
        return;
      }
      if (key === "c" && event.shiftKey) {
        event.preventDefault();
        void copyShareLink("manual");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
    };
  }, [shareDialogOpen, copyShareLink]);

  const handleStationChange = (index: number) => {
    if (index < 0 || index >= displayStations.length) {
      return;
    }
    setPresetStationOverride(null);
    setSelectedIndex(index);
  };

  const handleVolumeChange = (value: number) => {
    setVolume(value);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setSelectedIndex(0);
  };

  const handleCountryChange = (value: string) => {
    setCountry(value);
    setSelectedIndex(0);
  };

  const handleGenreChange = (value: string) => {
    setGenre(value);
    setSelectedIndex(0);
  };

  const handlePresetSelect = (stationId: string) => {
    const presetStation =
      favorites.find((station) => station.id === stationId) ??
      displayStations.find((station) => station.id === stationId);
    if (!presetStation) {
      toast({
        title: "Preset unavailable",
        description: "That station is no longer available in the directory.",
        variant: "destructive",
      });
      setPresetStationOverride(null);
      return;
    }

    const indexInDirectory = displayStations.findIndex((station) => station.id === stationId);
    if (indexInDirectory !== -1) {
      setPresetStationOverride(null);
      handleStationChange(indexInDirectory);
      return;
    }

    setPresetStationOverride({ station: presetStation });
  };

  const handleShareButtonClick = () => {
    if (!shareLink) {
      toast({
        title: "Share unavailable",
        description: "Pick a station with a playable stream before sharing.",
        variant: "destructive",
      });
      return;
    }
    shareButtonRef.current?.blur();
    setShareDialogOpen(true);
  };

  const handleShareDialogCopy = () => {
    void copyShareLink("manual");
  };

  const handleShareDialogClose = () => {
    setShareDialogOpen(false);
  };

  const handleMidnightPresetSelect = () => {
    setPresetStationOverride({ station: mysteryStation, allowUnknown: true });
    const secretVideo = SECRET_BROADCAST_VIDEOS[mysteryStation.id ?? ""];
    toast({
      title: "Secret broadcast tuned",
      description: "Enjoy the midnight signal.",
    });
  };

  const handleFavoriteToggle = async (station: RadioStation) => {
    if (!favoriteIds.has(station.id) && favorites.length >= maxFavoriteSlots) {
      toast({
        title: "All presets in use",
        description: "Remove a favorite before adding a new one.",
        variant: "destructive",
      });
      return;
    }

    try {
      await toggleFavorite(station.id);
      if (sanitizedPresetStationOverride?.id === station.id && favoriteIds.has(station.id)) {
        setPresetStationOverride(null);
      }
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 409) {
        toast({
          title: "All presets in use",
          description: "Remove a favorite before adding a new one.",
          variant: "destructive",
        });
        return;
      }
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Unable to update favorites.";
      toast({
        title: "Preset update failed",
        description: message,
        variant: "destructive",
      });
    }
  };

  const handlePresetRemove = async (stationId: string) => {
    try {
      await removeFavorite(stationId);
      if (sanitizedPresetStationOverride?.id === stationId) {
        setPresetStationOverride(null);
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Unable to update favorites.";
      toast({
        title: "Preset update failed",
        description: message,
        variant: "destructive",
      });
    }
  };

  const handleDirectoryKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleStationChange(index);
    }
  };

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const sentinel = loadMoreRef.current;
    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
          }
        }
      },
      {
        root: listRef.current ?? null,
        rootMargin: "0px 0px 160px 0px",
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [displayStations.length, fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  const clearReconnectTimer = useCallback(() => {
    const state = reconnectStateRef.current;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }, []);

  const resetReconnectAttempts = useCallback(() => {
    const state = reconnectStateRef.current;
    state.attempts = 0;
    clearReconnectTimer();
  }, [clearReconnectTimer]);

  const schedulePlaybackRetry = useCallback(
    (reason: string, { immediate = false }: { immediate?: boolean } = {}) => {
      if (!resolvedStreamUrl) {
        return;
      }

      const state = reconnectStateRef.current;
      if (state.attempts >= MAX_RECONNECT_ATTEMPTS) {
        logger.warn("playback.reconnect_limit_reached", {
          reason,
          attempts: state.attempts,
          maxAttempts: MAX_RECONNECT_ATTEMPTS,
        });
        return;
      }

      state.attempts += 1;
      clearReconnectTimer();

      const delay = immediate
        ? 0
        : Math.min(
            RECONNECT_MAX_DELAY_MS,
            RECONNECT_BASE_DELAY_MS * Math.pow(2, state.attempts - 1),
          );

      state.timer = setTimeout(() => {
        if (unmountedRef.current) {
          return;
        }
        setPlaybackKey((value) => value + 1);
      }, delay);
    },
    [clearReconnectTimer, resolvedStreamUrl],
  );

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      clearReconnectTimer();
    };
  }, [clearReconnectTimer]);

  useEffect(() => {
    if (!resolvedStreamUrl) {
      resetReconnectAttempts();
    }
  }, [resolvedStreamUrl, resetReconnectAttempts]);

  useEffect(() => {
    resetReconnectAttempts();
  }, [activeStation.id, resetReconnectAttempts]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) {
      return;
    }

    const recoverableEvents: Array<keyof HTMLMediaElementEventMap> = [
      "error",
      "stalled",
      "emptied",
      "abort",
    ];
    const resumeEvents: Array<keyof HTMLMediaElementEventMap> = ["playing", "canplay"];

    const handleRecoverable = (event: Event) => {
      schedulePlaybackRetry(event.type, { immediate: event.type === "error" });
    };

    const handleResume = () => {
      resetReconnectAttempts();
    };

    for (const eventType of recoverableEvents) {
      element.addEventListener(eventType, handleRecoverable);
    }
    for (const eventType of resumeEvents) {
      element.addEventListener(eventType, handleResume);
    }

    return () => {
      for (const eventType of recoverableEvents) {
        element.removeEventListener(eventType, handleRecoverable);
      }
      for (const eventType of resumeEvents) {
        element.removeEventListener(eventType, handleResume);
      }
    };
  }, [schedulePlaybackRetry, resetReconnectAttempts]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) {
      return;
    }

    const destroyHls = () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };

    if (!resolvedStreamUrl) {
      destroyHls();
      element.pause();
      element.removeAttribute("src");
      element.load();
      return () => {};
    }

    if (activeStation.hls) {
      let cancelled = false;
      let cleanup: (() => void) | undefined;

      const setup = async () => {
        try {
          const { default: Hls } = await loadHlsModule();
          if (cancelled) {
            return;
          }

          if (Hls.isSupported()) {
            destroyHls();
            const hls = new Hls({ enableWorker: true });
            hlsRef.current = hls;

            const handleMediaAttached = () => {
              element
                .play()
                .catch(() => {
                  /* ignore autoplay blockers */
                });
            };

            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal) {
                hls.destroy();
                hlsRef.current = null;
                const reason =
                  typeof data.type === "string" ? `hls-${data.type.toLowerCase()}` : "hls-fatal";
                schedulePlaybackRetry(reason, { immediate: data.type === Hls.ErrorTypes.MEDIA_ERROR });
              }
            });

            hls.on(Hls.Events.MEDIA_ATTACHED, handleMediaAttached);
            hls.loadSource(resolvedStreamUrl);
            hls.attachMedia(element);

            cleanup = () => {
              hls.off(Hls.Events.MEDIA_ATTACHED, handleMediaAttached);
              destroyHls();
            };
            return;
          }

          if (element.canPlayType("application/vnd.apple.mpegurl")) {
            destroyHls();
            element.src = resolvedStreamUrl;
            element
              .play()
              .catch(() => {
                /* ignore autoplay blockers */
              });
            cleanup = () => {
              element.pause();
            };
            return;
          }

          destroyHls();
          logger.warn("playback.hls_unsupported", {
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          });
          element.pause();
          element.removeAttribute("src");
          element.load();
        } catch (error) {
          logger.error("playback.hls_module_failed", { error });
        }
      };

      setup();

      return () => {
        cancelled = true;
        if (cleanup) {
          cleanup();
        } else {
          destroyHls();
        }
      };
    }

    destroyHls();
    element.pause();
    element.removeAttribute("src");
    element.load();
    element.src = resolvedStreamUrl;
    element
      .play()
      .catch(() => {
        /* ignore autoplay blockers */
      });

    return () => {
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [activeStation.hls, playbackKey, resolvedStreamUrl, schedulePlaybackRetry]);

  useEffect(() => {
    if (!activeStation.id || !activeStation.streamUrl) {
      return;
    }
    if (SECRET_BROADCAST_VIDEOS[activeStation.id ?? ""]) {
      return;
    }

    const controller = new AbortController();
    const url = `${RADIO_API_BASE}/stations/${encodeURIComponent(activeStation.id)}/click`;

    authorizedFetch(url, { method: "POST", signal: controller.signal }).catch(() => {
      /* ignore click tracking errors */
    });

    return () => {
      controller.abort();
    };
  }, [activeStation.id, activeStation.streamUrl]);

  const maxFrequencyLabel =
    displayStations.length > 0
      ? `${formatFrequency(displayStations.length - 1)} FM`
      : `${formatFrequency(0)} FM`;

  const nextOffset = lastMeta
    ? lastMeta.offset + lastMeta.limit
    : displayStations.length;
  const stationListCommandBase = `radio stations --limit ${PAGE_SIZE}`;
  const stationListCommand =
    nextOffset > 0
      ? `${stationListCommandBase} --offset ${nextOffset}`
      : stationListCommandBase;

  const updatedAtValue = firstMeta?.updatedAt;

  const directoryStatus = (() => {
    if (displayStations.length === 0) {
      return isFetching ? "Scanning…" : "No results";
    }
    if (isFetchingNextPage) {
      return "Loading more stations…";
    }
    if (hasNextPage) {
      return "Scroll to load more stations";
    }
    return "All stations loaded";
  })();
  let updatedAtDisplay: string | undefined;
  if (updatedAtValue) {
    const parsed = new Date(updatedAtValue);
    updatedAtDisplay = Number.isNaN(parsed.getTime())
      ? updatedAtValue
      : parsed.toLocaleString();
  }

  return (
    <div className="min-h-screen bg-black text-terminal-white px-2 sm:px-0">
      <TerminalWindow
        aria-label="Gitgud radio control center"
        className="min-h-screen w-full"
      >
        <TerminalHeader displayCwd="~/radio" />
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 font-mono text-xs sm:text-sm space-y-6">
          <RadioHeader />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-4">
              <TerminalPrompt path="~/radio" command="radio status" />
              <StationInfoPanel
                station={activeStation}
                frequencyLabel={frequencyLabel}
                onShare={handleShareButtonClick}
                shareDisabled={!shareLink}
                shareButtonRef={shareButtonRef}
              />
              {SECRET_BROADCAST_VIDEOS[activeStation.id ?? ""] ? (
                <div className="border border-terminal-green/40 rounded-md bg-black/80 p-3 space-y-2">
                  <p className="text-terminal-cyan text-xs uppercase tracking-[0.3em]">
                    Secret Broadcast
                  </p>
                  <div className="relative w-full pt-[56.25%]">
                    <iframe
                      title="Secret Broadcast Feed"
                      src={SECRET_BROADCAST_VIDEOS[activeStation.id ?? ""].embed}
                      allow="autoplay; encrypted-media"
                      allowFullScreen
                      className="absolute inset-0 h-full w-full border border-terminal-green/30"
                    />
                  </div>
                  <p className="text-terminal-white/60 text-[0.65rem]">
                    {SECRET_BROADCAST_VIDEOS[activeStation.id ?? ""].label}
                  </p>
                </div>
              ) : null}

              <TerminalPrompt path="~/radio" command="radio scanner --interactive" />
              <ScannerControl
                value={activeStationIndex !== -1 ? activeStationIndex : boundedSelectedIndex}
                max={Math.max(displayStations.length - 1, 0)}
                onChange={handleStationChange}
                minLabel={`${formatFrequency(0)} FM`}
                maxLabel={maxFrequencyLabel}
              />

              <TerminalPrompt path="~/radio" command="radio presets --list" />
              <PresetButtons
                favorites={favorites}
                selectedStationId={activeStation.id ?? null}
                onSelect={handlePresetSelect}
                onRemove={handlePresetRemove}
                colors={presetColors}
                maxSlots={maxFavoriteSlots}
                isLoading={favoritesLoading}
              />
              {midnightActive ? (
                <>
                  <TerminalPrompt path="~/radio" command="radio midnight --tune" />
                  <div className="border border-terminal-green/50 rounded-md bg-black/80 p-4 space-y-2">
                    <p className="text-terminal-cyan text-xs uppercase tracking-[0.3em]">
                      Secret Broadcast
                    </p>
                    <p className="text-terminal-white/80 text-sm">
                      A mysterious preset labeled {mysteryStation.name} is available until the clock strikes 01:00.
                    </p>
                    <button
                      type="button"
                      onClick={handleMidnightPresetSelect}
                      className="w-full border border-terminal-yellow/60 px-3 py-2 font-mono text-xs uppercase tracking-[0.2em] text-terminal-yellow hover:bg-terminal-yellow/10 focus:outline-none focus:ring-1 focus:ring-terminal-yellow"
                    >
                      Summon Broadcast
                    </button>
                  </div>
                </>
              ) : null}
            </div>

            <div className="space-y-4">
              <TerminalPrompt path="~/radio" command="radio filters" />
              <FilterPanel
                search={search}
                onSearchChange={handleSearchChange}
                country={country}
                onCountryChange={handleCountryChange}
                countries={uniqueCountries}
                genre={genre}
                onGenreChange={handleGenreChange}
                genres={uniqueGenres}
                volume={volume}
                onVolumeChange={handleVolumeChange}
              />

              <TerminalPrompt path="~/radio" command={stationListCommand} />
              <div className="border border-terminal-green/40 rounded-md bg-black/70">
                <header className="border-b border-terminal-green/30 px-3 py-2 text-[0.65rem] uppercase tracking-[0.25em] text-terminal-cyan">
                  Station Directory
                </header>
                {displayStations.length === 0 ? (
                  <p className="px-3 py-4 text-terminal-white/60 text-[0.6rem]">
                    No stations found. Adjust filters or refresh the cache.
                  </p>
                ) : (
                  <ol
                    ref={listRef}
                    className="max-h-[45vh] sm:max-h-[55vh] lg:max-h-[65vh] overflow-y-auto divide-y divide-terminal-green/20"
                  >
                    {displayStations.map((station, index) => {
                      const isSelected = station.id === activeStation.id;
                      const isFavorite = favoriteIds.has(station.id);
                      return (
                        <li key={station.id}>
                          <div
                            role="button"
                            tabIndex={0}
                            aria-pressed={isSelected}
                            onClick={() => handleStationChange(index)}
                            onKeyDown={(event) => handleDirectoryKeyDown(event, index)}
                            className={`flex w-full flex-col items-start gap-2 px-3 py-2 text-left transition focus:outline-none focus:ring-1 focus:ring-terminal-yellow sm:flex-row sm:items-center ${
                              isSelected
                                ? "bg-terminal-green/20 text-terminal-yellow"
                                : "text-terminal-white hover:bg-terminal-green/10"
                            }`}
                          >
                            <span className="text-terminal-cyan sm:w-4 sm:text-base">
                              {isSelected ? ">" : ""}
                            </span>
                            <span className="text-terminal-green text-[0.7rem] sm:w-20 sm:text-sm">
                              {`${formatFrequency(index)} FM`}
                            </span>
                            <button
                              type="button"
                              aria-label={
                                isFavorite
                                  ? `Remove ${station.name} from presets`
                                  : `Add ${station.name} to presets`
                              }
                              aria-pressed={isFavorite}
                              onClick={(event) => {
                                event.stopPropagation();
                                event.preventDefault();
                                void handleFavoriteToggle(station);
                              }}
                              disabled={isSavingFavorite}
                              className={`rounded-full border border-terminal-green/30 p-1 transition focus:outline-none focus:ring-1 focus:ring-terminal-yellow ${
                                isFavorite
                                  ? "text-terminal-red"
                                  : "text-terminal-white/70 hover:text-terminal-yellow"
                              } ${isSavingFavorite ? "opacity-60" : ""}`}
                            >
                              <Heart
                                className="h-3.5 w-3.5"
                                fill={isFavorite ? "currentColor" : "none"}
                                aria-hidden="true"
                              />
                            </button>
                            <span className="flex-1 whitespace-normal wrap-break-word text-[0.75rem] sm:min-w-0 sm:text-sm sm:truncate">
                              {station.name}
                            </span>
                            <span className="hidden text-[0.7rem] text-terminal-cyan md:block">
                              {station.country ?? "Unknown"}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                    <li
                      ref={loadMoreRef}
                      className="px-3 py-3 text-center text-[0.6rem] uppercase tracking-[0.2em] text-terminal-cyan/80"
                    >
                      {directoryStatus}
                    </li>
                  </ol>
                )}
              </div>
            </div>
          </div>

          <StatusFooter
            isLoading={isLoading && displayStations.length === 0}
            isError={isError}
            visibleCount={displayStations.length}
            totalCount={
              firstMeta?.matches ??
              firstMeta?.filtered ??
              firstMeta?.total ??
              displayStations.length
            }
            cacheSource={lastMeta?.cacheSource ?? firstMeta?.cacheSource}
            updatedAt={updatedAtDisplay}
            origin={firstMeta?.origin}
          />
        </div>
      </TerminalWindow>
      <audio ref={audioRef} hidden autoPlay controls />
      <AlertDialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <AlertDialogContent
          className="border border-terminal-green/50 bg-[#050505] text-terminal-white"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            copyButtonRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            shareButtonRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-terminal-yellow text-base uppercase tracking-[0.2em]">
              Share Station
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-terminal-white/70">
              The link below opens radio and starts playing this station immediately. It was copied to your clipboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded border border-terminal-green/40 bg-black/70 p-3 font-mono text-xs text-terminal-green break-all">
            {shareLink ?? "No station selected."}
          </div>
          <div className="flex flex-wrap gap-3 text-[0.7rem] text-terminal-cyan">
            <button
              type="button"
              ref={copyButtonRef}
              onClick={handleShareDialogCopy}
              disabled={!shareLink}
              className={`inline-flex flex-1 min-w-[9rem] items-center justify-center gap-2 rounded border border-terminal-cyan/60 px-3 py-1.5 uppercase tracking-[0.2em] transition focus:outline-none focus:ring-1 focus:ring-terminal-yellow ${
                shareLink ? "hover:bg-terminal-cyan/10" : "cursor-not-allowed opacity-50"
              }`}
            >
              <span className="rounded border border-terminal-cyan/60 bg-terminal-cyan/10 px-1 py-0.5 font-mono text-[0.65rem]">
                Ctrl + Shift + C
              </span>
              Copy
            </button>
            <button
              type="button"
              data-dialog-focus-scope="true"
              onClick={handleShareDialogClose}
              className="inline-flex flex-1 min-w-[9rem] items-center justify-center gap-2 rounded border border-terminal-red/60 px-3 py-1.5 uppercase tracking-[0.2em] text-terminal-white transition hover:bg-terminal-red/10 focus:outline-none focus:ring-1 focus:ring-terminal-yellow"
            >
              <span className="rounded border border-terminal-red/60 bg-terminal-red/10 px-1 py-0.5 font-mono text-[0.65rem]">
                Ctrl + D
              </span>
              Close
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Radio;
