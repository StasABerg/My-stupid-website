import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TerminalWindow, TerminalHeader, TerminalPrompt, TerminalCursor } from "@/components/SecureTerminal";

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const GitGud = () => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    document.title = "Git Gud Sequence";
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((value) => {
        const next = value + Math.random() * 8;
        if (next > 98) {
          return 42;
        }
        return next;
      });
    }, 800);
    return () => clearInterval(interval);
  }, []);

  const textBar = useMemo(() => {
    const total = 36;
    const pct = clampPercent(progress);
    const filled = Math.max(0, Math.min(total, Math.round((pct / 100) * total)));
    return `[${"#".repeat(filled)}${".".repeat(total - filled)}] ${pct}%`;
  }, [progress]);

  return (
    <div className="h-screen bg-black">
      <TerminalWindow aria-label="GitGud training terminal">
        <TerminalHeader displayCwd="~/gitgud" />
        <div className="p-3 sm:p-6 font-mono text-xs sm:text-sm text-terminal-white flex-1 overflow-y-auto space-y-4">
          <TerminalPrompt command="git gud --run --mode=montage" />

          <div className="space-y-1">
            <p className="text-terminal-cyan">status feed</p>
            <p className="text-terminal-green">{textBar}</p>
            <p className="text-terminal-white/70">Compilation of life choices in progress… reaching 100% is intentionally impossible.</p>
            <p className="text-terminal-white/70">stage: training_loop · mood: resigned optimism · operator: you</p>
          </div>

          <TerminalPrompt command="tail -f /var/log/gitgud.log" />
          <div className="space-y-1 text-terminal-white/75">
            <p>[ok] linked caffeine to build pipeline</p>
            <p>[warn] impostor syndrome rising; ignoring for now</p>
            <p>[info] rerouting patience to /dev/null</p>
          </div>

          <div className="space-y-2">
            <TerminalPrompt command="watch progress" />
            <p className="text-terminal-white/60 text-[0.8rem]">
              █ recalculating destiny <TerminalCursor className="ml-1" />
            </p>
          </div>

          <div className="flex flex-wrap gap-4 pt-2">
            <Link
              to="/begud"
              className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
            >
              cd /begud
            </Link>
            <Link
              to="/"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ..
            </Link>
          </div>
        </div>
      </TerminalWindow>
    </div>
  );
};

export default GitGud;
