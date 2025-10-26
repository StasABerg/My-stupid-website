import type { RadioStation } from "@/hooks/useRadioStations";

interface PresetButtonsProps {
  favorites: RadioStation[];
  selectedStationId: string | null;
  onSelect: (stationId: string) => void;
  colors: string[];
  maxSlots: number;
  isLoading?: boolean;
}

const PresetButtons = ({
  favorites,
  selectedStationId,
  onSelect,
  colors,
  maxSlots,
  isLoading = false,
}: PresetButtonsProps) => {
  const slots = Array.from({ length: maxSlots }, (_, index) => favorites[index] ?? null);

  return (
    <section className="border border-terminal-green/40 rounded-md bg-black/70 p-4">
      <header className="flex items-center justify-between text-[0.65rem] uppercase tracking-[0.25em] text-terminal-cyan">
        <span>Preset Slots</span>
        <span className="text-terminal-white/60 normal-case tracking-normal">
          {favorites.length}/{maxSlots}
        </span>
      </header>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {slots.map((station, index) => {
          const colorClass = colors[index % colors.length];
          const isSelected = station ? station.id === selectedStationId : false;

          if (!station) {
            return (
              <div
                key={`empty-${index}`}
                className="flex items-center gap-2 border border-terminal-green/20 px-3 py-2 text-left font-mono text-[0.65rem] text-terminal-white/40"
              >
                <span className="text-terminal-cyan">[{index + 1}]</span>
                <span className="truncate italic">Empty slot</span>
              </div>
            );
          }

          return (
            <button
              key={station.id}
              type="button"
              onClick={() => onSelect(station.id)}
              className={`flex items-center gap-2 border border-terminal-green/30 px-3 py-2 text-left font-mono text-[0.65rem] transition focus:outline-none focus:ring-1 focus:ring-terminal-yellow ${
                isSelected
                  ? `${colorClass} border-terminal-yellow/60 bg-terminal-yellow/10`
                  : "text-terminal-white hover:border-terminal-yellow/40"
              }`}
            >
              <span className="text-terminal-cyan">[{index + 1}]</span>
              <span className="truncate">{station.name.slice(0, 24)}</span>
            </button>
          );
        })}
      </div>
      {!isLoading && favorites.length === 0 && (
        <p className="mt-3 text-[0.6rem] text-terminal-white/60">
          Use the heart icon in the directory to pin stations here.
        </p>
      )}
      {isLoading && (
        <p className="mt-3 text-[0.6rem] text-terminal-white/60">Loading favorites…</p>
      )}
    </section>
  );
};

export default PresetButtons;
