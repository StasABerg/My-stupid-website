import type { RadioStation } from "@/hooks/useRadioStations";

interface StationInfoPanelProps {
  station: RadioStation;
  frequencyLabel: string;
}

const StationInfoPanel = ({ station, frequencyLabel }: StationInfoPanelProps) => (
  <div className="bg-black/80 border border-terminal-green/40 rounded-xl px-5 py-4 shadow-inner">
    <div className="flex items-baseline justify-between">
      <h2 className="text-terminal-green text-xl font-semibold">{station.name}</h2>
      <span className="text-terminal-yellow text-sm">{frequencyLabel}</span>
    </div>
    <div className="mt-2 grid gap-2 text-xs text-terminal-white/80 sm:grid-cols-2">
      <div>
        <span className="uppercase text-terminal-cyan/80">Origin</span>
        <p>
          {station.country ?? "Unknown"}
          {station.state ? ` · ${station.state}` : ""}
        </p>
      </div>
      <div>
        <span className="uppercase text-terminal-cyan/80">Bitrate</span>
        <p>{station.bitrate ? `${station.bitrate} kbps` : "Auto"}</p>
      </div>
    </div>
  </div>
);

export default StationInfoPanel;
