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
  <fieldset className="border border-terminal-green/40 rounded-md bg-black/70 p-4">
    <legend className="px-2 text-[0.6rem] uppercase tracking-[0.35em] text-terminal-green">
      Filters
    </legend>

    <label
      htmlFor="station-search"
      className="block text-[0.65rem] uppercase tracking-[0.25em] text-terminal-cyan"
    >
      Search
    </label>
    <input
      id="station-search"
      type="text"
      value={search}
      onChange={(event) => onSearchChange(event.target.value)}
      placeholder="Station, tag, or language"
      className="mt-2 w-full border border-terminal-green/40 bg-black px-3 py-2 font-mono text-terminal-white placeholder:text-terminal-white/40 focus:outline-none focus:ring-1 focus:ring-terminal-yellow"
    />

    <label
      htmlFor="station-country"
      className="mt-4 block text-[0.65rem] uppercase tracking-[0.25em] text-terminal-cyan"
    >
      Country
    </label>
    <select
      id="station-country"
      value={country}
      onChange={(event) => onCountryChange(event.target.value)}
      className="mt-2 w-full border border-terminal-green/40 bg-black px-3 py-2 font-mono text-terminal-white focus:outline-none focus:ring-1 focus:ring-terminal-yellow"
    >
      <option value="">All origins</option>
      {countries.map((item) => (
        <option key={item} value={item}>
          {item}
        </option>
      ))}
    </select>

    <label
      htmlFor="volume"
      className="mt-6 block text-[0.65rem] uppercase tracking-[0.25em] text-terminal-cyan"
    >
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
    <div className="mt-2 text-[0.6rem] text-terminal-white/70">
      Level: {Math.round(volume * 100)}%
    </div>
  </fieldset>
);

export default FilterPanel;
