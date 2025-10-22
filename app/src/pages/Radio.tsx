import Hls from "hls.js";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FilterPanel,
  PresetButtons,
  RadioHeader,
  ScannerControl,
  StationInfoPanel,
  StatusFooter,
} from "@/components/Radio";
import { TerminalHeader, TerminalPrompt, TerminalWindow } from "@/components/SecureTerminal";
import { RADIO_API_BASE, useRadioStations, type RadioStation } from "@/hooks/useRadioStations";

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
  coordinates: null,
  bitrate: null,
  codec: null,
  hls: false,
  isOnline: false,
  lastCheckedAt: null,
  lastChangedAt: null,
  clickCount: 0,
  clickTrend: 0,
  votes: 0,
};

const MAX_VISIBLE = 120;

const Radio = () => {
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [volume, setVolume] = useState(0.65);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const { data, isLoading, isError } = useRadioStations({
    search: search.trim() || undefined,
    country: country || undefined,
    limit: 400,
  });

  const stations = useMemo(() => data?.items ?? [], [data]);
  const displayStations = stations.slice(0, MAX_VISIBLE);

  const boundedSelectedIndex =
    displayStations.length === 0
      ? 0
      : Math.min(selectedIndex, displayStations.length - 1);

  const activeStation = displayStations[boundedSelectedIndex] ?? fallbackStation;
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
    const fromMeta = data?.meta.countries;
    if (Array.isArray(fromMeta) && fromMeta.length > 0) {
      return fromMeta;
    }

    const seen = new Set<string>();
    const options = stations
      .map((station) => station.country)
      .filter((value): value is string => Boolean(value));

    return options.filter((entry) => {
      const lower = entry.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
  }, [data?.meta.countries, stations]);

  const handleStationChange = (index: number) => {
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

    fetch(url, { method: "POST", signal: controller.signal }).catch(() => {
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

  const stationListCommand = `radio stations --limit ${Math.max(
    0,
    Math.min(displayStations.length, MAX_VISIBLE),
  )}`;

  const updatedAtValue = data?.meta.updatedAt;
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
                frequencyLabel={`${formatFrequency(boundedSelectedIndex)} FM`}
              />

              <TerminalPrompt path="~/radio" command="radio scanner --interactive" />
              <ScannerControl
                value={boundedSelectedIndex}
                max={Math.max(displayStations.length - 1, 0)}
                onChange={handleStationChange}
                minLabel={`${formatFrequency(0)} FM`}
                maxLabel={maxFrequencyLabel}
              />

              <TerminalPrompt path="~/radio" command="radio presets --list" />
              <PresetButtons
                stations={displayStations}
                selectedIndex={boundedSelectedIndex}
                onSelect={handleStationChange}
                colors={presetColors}
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
                  <ol className="max-h-[45vh] sm:max-h-[55vh] lg:max-h-[65vh] overflow-y-auto divide-y divide-terminal-green/20">
                    {displayStations.map((station, index) => {
                      const isSelected = index === boundedSelectedIndex;
                      return (
                        <li key={station.id}>
                          <button
                            type="button"
                            onClick={() => handleStationChange(index)}
                            className={`flex w-full flex-col gap-2 px-3 py-2 text-left transition focus:outline-none focus:ring-1 focus:ring-terminal-yellow sm:flex-row sm:items-center ${
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
                            <span className="flex-1 whitespace-normal break-words text-[0.75rem] sm:min-w-0 sm:text-sm sm:truncate">
                              {station.name}
                            </span>
                            <span className="hidden text-[0.7rem] text-terminal-cyan md:block">
                              {station.country ?? "Unknown"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          </div>

          <StatusFooter
            isLoading={isLoading}
            isError={isError}
            visibleCount={displayStations.length}
            totalCount={data?.meta.total}
            cacheSource={data?.meta.cacheSource}
            updatedAt={updatedAtDisplay}
            origin={data?.meta.origin}
          />
        </div>
      </TerminalWindow>
      <audio ref={audioRef} hidden autoPlay controls />
    </div>
  );
};

export default Radio;
