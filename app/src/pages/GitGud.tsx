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

  const widthClass = useMemo(() => `w-pct-${clampPercent(progress)}`, [progress]);

  return (
    <TerminalWindow aria-label="GitGud training terminal" className="bg-black">
      <TerminalHeader displayCwd="/git/gud" label="gitgud@ops:/git/gud — training sequence" />
      <div className="flex-1 overflow-auto bg-gradient-to-b from-black via-[#050910] to-black p-4 sm:p-6 text-terminal-white font-mono">
        <TerminalPrompt command="git gud --run --mode=montage" />

        <div className="mt-3 space-y-3 text-xs sm:text-sm text-terminal-white/80">
          <p className="text-terminal-cyan">Status feed:</p>
          <div className="rounded-md border border-terminal-green/30 bg-black/70 p-4 shadow-[0_0_40px_rgba(0,255,132,0.15)]">
            <div className="flex items-center justify-between text-terminal-white/80">
              <span className="text-terminal-cyan">progress</span>
              <span className="text-terminal-yellow tracking-[0.2em] text-[0.7rem] sm:text-xs">
                {progress.toFixed(1)}%
              </span>
            </div>
            <div className="mt-3 h-4 w-full border border-terminal-green/40 bg-terminal-green/10 relative overflow-hidden">
              <div className={`h-full bg-terminal-green/80 transition-all duration-700 ${widthClass}`} />
            </div>
            <p className="mt-3 text-[0.7rem] sm:text-xs text-terminal-white/65">
              Compilation of life choices in progress… reaching 100% is intentionally impossible.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 text-[0.7rem] sm:text-xs">
            <div className="rounded border border-terminal-green/30 bg-black/70 px-3 py-2">
              <p className="text-terminal-cyan/90">stage</p>
              <p className="text-terminal-yellow">training_loop</p>
            </div>
            <div className="rounded border border-terminal-green/30 bg-black/70 px-3 py-2">
              <p className="text-terminal-cyan/90">mood</p>
              <p className="text-terminal-green">resigned optimism</p>
            </div>
            <div className="rounded border border-terminal-green/30 bg-black/70 px-3 py-2">
              <p className="text-terminal-cyan/90">operator</p>
              <p className="text-terminal-magenta">you</p>
            </div>
          </div>

          <TerminalPrompt command="tail -f /var/log/gitgud.log" className="mt-4" />
          <div className="space-y-1 text-[0.7rem] sm:text-xs text-terminal-white/75">
            <p>[ok] linked caffeine to build pipeline</p>
            <p>[warn] impostor syndrome rising; ignoring for now</p>
            <p>[info] rerouting patience to /dev/null</p>
          </div>

          <div className="mt-6 flex flex-wrap gap-4 text-[0.7rem] sm:text-xs">
            <Link
              to="/begud"
              className="rounded border border-terminal-green/50 px-3 py-2 text-terminal-cyan hover:bg-terminal-green/10 focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              continue to /begud
            </Link>
            <Link
              to="/"
              className="rounded border border-terminal-green/50 px-3 py-2 text-terminal-yellow hover:bg-terminal-green/10 focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              return to /home
            </Link>
          </div>

          <div className="mt-6 text-terminal-white/60 text-[0.7rem] sm:text-xs">
            <TerminalPrompt command="watch progress" className="mb-2" />
            <span>█ recalculating destiny <TerminalCursor className="ml-1" /></span>
          </div>
        </div>
      </div>
    </TerminalWindow>
  );
};

export default GitGud;
