interface FilterPanelProps {
  search: string;
  onSearchChange: (value: string) => void;
  country: string;
  onCountryChange: (value: string) => void;
  countries: string[];
  volume: number;
  onVolumeChange: (value: number) => void;
}

const FilterPanel = ({
  search,
  onSearchChange,
  country,
  onCountryChange,
  countries,
  volume,
  onVolumeChange,
}: FilterPanelProps) => (
  <div className="bg-black/70 border border-terminal-green/30 rounded-3xl p-5 shadow-lg">
    <label htmlFor="station-search" className="block text-xs uppercase tracking-[0.3em] text-terminal-cyan">
      Search
    </label>
    <input
      id="station-search"
      type="text"
      value={search}
      onChange={(event) => onSearchChange(event.target.value)}
      placeholder="Station, tag, or language"
      className="mt-2 w-full rounded-lg border border-terminal-green/30 bg-black/60 px-3 py-2 text-terminal-white focus:outline-none focus:ring-2 focus:ring-terminal-green"
    />

    <label htmlFor="station-country" className="mt-4 block text-xs uppercase tracking-[0.3em] text-terminal-cyan">
      Country
    </label>
    <select
      id="station-country"
      value={country}
      onChange={(event) => onCountryChange(event.target.value)}
      className="mt-2 w-full rounded-lg border border-terminal-green/30 bg-black/60 px-3 py-2 text-terminal-white focus:outline-none focus:ring-2 focus:ring-terminal-green"
    >
      <option value="">All origins</option>
      {countries.map((item) => (
        <option key={item} value={item}>
          {item}
        </option>
      ))}
    </select>

    <label htmlFor="volume" className="mt-6 block text-xs uppercase tracking-[0.3em] text-terminal-cyan">
      Volume
    </label>
    <input
      id="volume"
      type="range"
      min={0}
      max={100}
      value={Math.round(volume * 100)}
      onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
      className="mt-2 w-full accent-terminal-yellow"
    />
  </div>
);

export default FilterPanel;
