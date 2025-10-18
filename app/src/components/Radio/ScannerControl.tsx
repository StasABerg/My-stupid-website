interface ScannerControlProps {
  value: number;
  max: number;
  onChange: (value: number) => void;
  minLabel: string;
  maxLabel: string;
}

const ScannerControl = ({ value, max, onChange, minLabel, maxLabel }: ScannerControlProps) => (
  <div className="bg-[#050505] border border-terminal-green/30 rounded-3xl px-4 sm:px-8 py-5">
    <label className="block text-terminal-cyan text-xs uppercase tracking-[0.3em]">
      Station Scanner
    </label>
    <input
      type="range"
      min={0}
      max={Math.max(max, 0)}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="w-full mt-4 accent-terminal-green"
    />
    <div className="mt-3 flex justify-between text-[0.6rem] text-terminal-white/60">
      <span>{minLabel}</span>
      <span>{maxLabel}</span>
    </div>
  </div>
);

export default ScannerControl;
