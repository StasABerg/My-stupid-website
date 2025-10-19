import type { RadioStation } from "@/hooks/useRadioStations";

interface PresetButtonsProps {
  stations: RadioStation[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  colors: string[];
}

const PresetButtons = ({ stations, selectedIndex, onSelect, colors }: PresetButtonsProps) => (
  <section className="border border-terminal-green/40 rounded-md bg-black/70 p-4">
    <header className="text-[0.65rem] uppercase tracking-[0.25em] text-terminal-cyan">
      Preset Slots
    </header>
    <div className="mt-3 grid grid-cols-2 gap-3">
      {stations.slice(0, 6).map((station, index) => {
        const isSelected = selectedIndex === index;
        return (
          <button
            key={station.id}
            type="button"
            onClick={() => onSelect(index)}
            className={`flex items-center gap-2 border border-terminal-green/30 px-3 py-2 text-left font-mono text-[0.65rem] transition focus:outline-none focus:ring-1 focus:ring-terminal-yellow ${
              isSelected
                ? `${colors[index % colors.length]} border-terminal-yellow/60 bg-terminal-yellow/10`
                : "text-terminal-white hover:border-terminal-yellow/40"
            }`}
          >
            <span className="text-terminal-cyan">[{index + 1}]</span>
            <span className="truncate">{station.name.slice(0, 24)}</span>
          </button>
        );
      })}
      {stations.length === 0 && (
        <p className="col-span-2 text-[0.6rem] text-terminal-white/60">
          Load stations to populate presets.
        </p>
      )}
    </div>
  </section>
);

export default PresetButtons;
