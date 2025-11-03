interface TerminalHeaderProps {
  displayCwd: string;
  label?: string;
}

const DEFAULT_PREFIX = "sandbox@gitgud.qzz.io";

function TerminalHeader({ displayCwd, label }: TerminalHeaderProps) {
  const renderedLabel = label ?? `${DEFAULT_PREFIX}:${displayCwd} — isolated pod`;
  return (
    <div className="flex items-center gap-2 border-b-2 border-terminal-green px-3 py-2 text-xs sm:text-sm text-terminal-white">
      <span className="text-terminal-red">●</span>
      <span className="text-terminal-yellow">●</span>
      <span className="text-terminal-green">●</span>
      <span className="ml-3 flex-1 min-w-0 text-terminal-cyan truncate font-mono tracking-tight">
        {renderedLabel}
      </span>
    </div>
  );
}

export default TerminalHeader;
