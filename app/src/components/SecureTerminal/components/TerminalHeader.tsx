interface TerminalHeaderProps {
  displayCwd: string;
}

function TerminalHeader({ displayCwd }: TerminalHeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b-2 border-terminal-green px-3 py-2 text-xs sm:text-sm text-terminal-white">
      <span className="text-terminal-red">●</span>
      <span className="text-terminal-yellow">●</span>
      <span className="text-terminal-green">●</span>
      <span className="ml-3 text-terminal-cyan truncate">
        sandbox@gitgud.qzz.io:{displayCwd} — isolated pod
      </span>
    </div>
  );
}

export default TerminalHeader;
