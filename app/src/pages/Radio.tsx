import { useEffect, useMemo, useRef, useState } from "react";
import {
  FilterPanel,
  PresetButtons,
  RadioHeader,
  ScannerControl,
  StationInfoPanel,
  StatusFooter,
} from "@/components/Radio";
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

  const { data, isLoading, isError } = useRadioStations({
    search: search.trim() || undefined,
    country: country || undefined,
    limit: 400,
  });

  const stations = useMemo(() => data?.items ?? [], [data]);
  const displayStations = stations.slice(0, MAX_VISIBLE);

  const activeStation = displayStations[selectedIndex] ?? fallbackStation;

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
    if (!element) return;
    if (activeStation.streamUrl) {
      element.src = activeStation.streamUrl;
      element
        .play()
        .catch(() => {
          /* ignore autoplay blockers */
        });
    } else {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
  }, [activeStation]);

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

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-[#0b0b0b] to-black text-terminal-white flex flex-col items-center py-10">
      <div className="w-full max-w-5xl px-4">
        <RadioHeader />

        <section
          aria-label="Car radio player"
          className="mt-8 bg-gradient-to-br from-[#1b1b1b] via-[#111] to-black rounded-[2.5rem] border border-terminal-green/40 shadow-[0_0_40px_rgba(0,255,128,0.25)] p-6 sm:p-10"
        >
          <div className="grid gap-8 lg:grid-cols-[2fr_1fr] items-center">
            <div className="space-y-6">
              <StationInfoPanel
                station={activeStation}
                frequencyLabel={`${formatFrequency(selectedIndex)} FM`}
              />
              <ScannerControl
                value={selectedIndex}
                max={displayStations.length - 1}
                onChange={handleStationChange}
                minLabel={`${formatFrequency(0)} FM`}
                maxLabel={maxFrequencyLabel}
              />
            </div>

            <div className="space-y-6">
              <FilterPanel
                search={search}
                onSearchChange={handleSearchChange}
                country={country}
                onCountryChange={handleCountryChange}
                countries={uniqueCountries}
                volume={volume}
                onVolumeChange={handleVolumeChange}
              />

              <PresetButtons
                stations={displayStations}
                selectedIndex={selectedIndex}
                onSelect={handleStationChange}
                colors={presetColors}
              />
            </div>
          </div>

          <StatusFooter
            isLoading={isLoading}
            isError={isError}
            visibleCount={Math.min(displayStations.length, MAX_VISIBLE)}
            totalCount={data?.meta.total}
            cacheSource={data?.meta.cacheSource}
          />
        </section>
      </div>

      <audio ref={audioRef} hidden autoPlay controls />
    </div>
  );
};

export default Radio;
