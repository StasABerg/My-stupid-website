import type { RadioStation } from "@/hooks/useRadioStations";

interface PresetButtonsProps {
  stations: RadioStation[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  colors: string[];
}

const PresetButtons = ({ stations, selectedIndex, onSelect, colors }: PresetButtonsProps) => (
  <div className="grid grid-cols-3 gap-3">
    {stations.slice(0, 6).map((station, index) => (
      <button
        key={station.id}
        type="button"
        onClick={() => onSelect(index)}
        className={`rounded-full border border-terminal-green/40 bg-black/70 px-4 py-3 text-xs font-semibold shadow-md transition hover:border-terminal-yellow/60 focus:outline-none focus:ring-2 focus:ring-terminal-yellow ${
          selectedIndex === index ? colors[index % colors.length] : "text-terminal-white"
        }`}
      >
        {station.name.slice(0, 18)}
      </button>
    ))}
  </div>
);

export default PresetButtons;
