import Hls from "hls.js";
import { Heart } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  FilterPanel,
  PresetButtons,
  RadioHeader,
  ScannerControl,
  StationInfoPanel,
  StatusFooter,
} from "@/components/Radio";
import { toast } from "@/components/ui/use-toast";
import { TerminalHeader, TerminalPrompt, TerminalWindow } from "@/components/SecureTerminal";
import { RADIO_API_BASE, useRadioStations, type RadioStation } from "@/hooks/useRadioStations";
import { useRadioFavorites } from "@/hooks/useRadioFavorites";
import { authorizedFetch } from "@/lib/gateway-session";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

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

const PAGE_SIZE = 40;

const Radio = () => {
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [genre, setGenre] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [presetStationOverride, setPresetStationOverride] = useState<RadioStation | null>(null);
  const [volume, setVolume] = useState(0.65);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const loadMoreRef = useRef<HTMLLIElement | null>(null);

  const debouncedSearch = useDebouncedValue(search.trim(), 300);

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

  const activeDirectoryStation = displayStations[boundedSelectedIndex] ?? fallbackStation;
  const activeStation = presetStationOverride ?? activeDirectoryStation;
  const activeStationIndex = useMemo(
    () => displayStations.findIndex((station) => station.id === activeStation.id),
    [activeStation.id, displayStations],
  );
  const frequencyLabel =
    activeStationIndex !== -1 ? `${formatFrequency(activeStationIndex)} FM` : "Preset";
  const proxiedStreamUrl = useMemo(() => {
    if (!activeStation.id || !activeStation.streamUrl) {
      return null;
    }
    if (activeStation.hls) {
      const encodedId = encodeURIComponent(activeStation.id);
      return `${RADIO_API_BASE}/stations/${encodedId}/stream`;
    }
    return activeStation.streamUrl;
  }, [activeStation]);

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

  useEffect(() => {
    if (!presetStationOverride) {
      return;
    }
    const existsInFavorites = favorites.some(
      (station) => station.id === presetStationOverride.id,
    );
    const existsInDirectory = displayStations.some(
      (station) => station.id === presetStationOverride.id,
    );
    if (!existsInFavorites && !existsInDirectory) {
      setPresetStationOverride(null);
    }
  }, [displayStations, favorites, presetStationOverride]);

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

    setPresetStationOverride(presetStation);
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
      if (presetStationOverride?.id === station.id && favoriteIds.has(station.id)) {
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
      if (presetStationOverride?.id === stationId) {
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

  const handleDirectoryKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
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

    if (!proxiedStreamUrl) {
      destroyHls();
      element.pause();
      element.removeAttribute("src");
      element.load();
      return () => {};
    }

    if (activeStation.hls) {
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
          }
        });

        hls.on(Hls.Events.MEDIA_ATTACHED, handleMediaAttached);
        hls.loadSource(proxiedStreamUrl);
        hls.attachMedia(element);

        return () => {
          hls.off(Hls.Events.MEDIA_ATTACHED, handleMediaAttached);
          destroyHls();
        };
      }

      if (element.canPlayType("application/vnd.apple.mpegurl")) {
        destroyHls();
        element.src = proxiedStreamUrl;
        element
          .play()
          .catch(() => {
            /* ignore autoplay blockers */
          });
        return () => {
          element.pause();
        };
      }

      destroyHls();
      console.warn("HLS playback is not supported in this browser.");
      element.pause();
      element.removeAttribute("src");
      element.load();
      return () => {};
    }

    destroyHls();
    element.src = proxiedStreamUrl;
    element
      .play()
      .catch(() => {
        /* ignore autoplay blockers */
      });

    return () => {
      element.pause();
    };
  }, [activeStation.hls, proxiedStreamUrl]);

  useEffect(() => {
    if (!activeStation.id || !activeStation.streamUrl) {
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
              />

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
    </div>
  );
};

export default Radio;
