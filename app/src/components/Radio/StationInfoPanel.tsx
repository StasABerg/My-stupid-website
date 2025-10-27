import type { RadioStation } from "@/hooks/useRadioStations";

interface StationInfoPanelProps {
  station: RadioStation;
  frequencyLabel: string;
}

const StationInfoPanel = ({ station, frequencyLabel }: StationInfoPanelProps) => (
  <section className="border border-terminal-green/40 rounded-md bg-black/70 p-4">
    <header className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-terminal-yellow text-lg sm:text-xl font-semibold wrap-break-word">
        {station.name}
      </h2>
      <span className="text-terminal-green text-sm">{frequencyLabel}</span>
    </header>
    <dl className="mt-3 grid gap-2 text-[0.7rem] text-terminal-white/80 sm:grid-cols-2">
      <div>
        <dt className="text-terminal-cyan uppercase tracking-[0.2em] text-[0.6rem]">Origin</dt>
        <dd>
          {station.country ?? "Unknown"}
          {station.state ? ` · ${station.state}` : ""}
        </dd>
      </div>
      <div>
        <dt className="text-terminal-cyan uppercase tracking-[0.2em] text-[0.6rem]">Codec</dt>
        <dd>{station.codec ?? "Auto"}</dd>
      </div>
      <div>
        <dt className="text-terminal-cyan uppercase tracking-[0.2em] text-[0.6rem]">Bitrate</dt>
        <dd>{station.bitrate ? `${station.bitrate} kbps` : "Auto"}</dd>
      </div>
      <div>
        <dt className="text-terminal-cyan uppercase tracking-[0.2em] text-[0.6rem]">Status</dt>
        <dd>{station.isOnline ? "Online" : "Offline"}</dd>
      </div>
    </dl>
    <div className="mt-3 text-[0.65rem] text-terminal-white/70">
      <span className="text-terminal-cyan uppercase tracking-[0.2em] text-[0.55rem]">Tags:</span>{" "}
      {station.tags.length > 0 ? station.tags.slice(0, 6).join(", ") : "None"}
    </div>
  </section>
);

export default StationInfoPanel;
