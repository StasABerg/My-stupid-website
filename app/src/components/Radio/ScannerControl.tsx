interface ScannerControlProps {
  value: number;
  max: number;
  onChange: (value: number) => void;
  minLabel: string;
  maxLabel: string;
}

const ScannerControl = ({ value, max, onChange, minLabel, maxLabel }: ScannerControlProps) => (
  <section className="border border-terminal-green/40 rounded-md bg-black/70 p-4">
    <header className="flex items-center justify-between text-[0.65rem] uppercase tracking-[0.25em] text-terminal-cyan">
      <span>Station Scanner</span>
      <span className="text-terminal-yellow">Index: {value}</span>
    </header>
    <input
      type="range"
      min={0}
      max={Math.max(max, 0)}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="mt-4 w-full accent-terminal-green"
    />
    <div className="mt-3 flex justify-between text-[0.6rem] text-terminal-white/70">
      <span>{minLabel}</span>
      <span>{maxLabel}</span>
    </div>
  </section>
);

export default ScannerControl;
