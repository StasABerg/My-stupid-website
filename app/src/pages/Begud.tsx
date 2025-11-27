import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TerminalWindow, TerminalHeader, TerminalPrompt, TerminalCursor } from "@/components/SecureTerminal";

const insults = [
  "Push harder. Git Gud.",
  "Logs don't read themselves.",
  "If kubectl apply failed, so did you.",
  "Backups are for cowards who plan ahead.",
  "Alerts are love letters from production. Answer them.",
  "Latency is just procrastination measured in ms.",
];

const Begud = () => {
  const [index, setIndex] = useState(0);
  const displayMessage = useMemo(() => insults[index % insults.length], [index]);

  useEffect(() => {
    document.title = "Be Gud Training";
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((value) => (value + 1) % insults.length);
    }, 2800);
    return () => clearInterval(timer);
  }, []);

  return (
    <TerminalWindow aria-label="BeGud training terminal" className="bg-black">
      <TerminalHeader displayCwd="/begud" label="gitgud@ops:/begud — behavioral tuning" />
      <div className="flex-1 overflow-auto bg-gradient-to-b from-black via-[#050910] to-black p-4 sm:p-6 text-terminal-white font-mono">
        <TerminalPrompt command="watch -n2 /var/log/begud.log" />

        <div className="mt-3 grid gap-3 sm:grid-cols-2 text-[0.7rem] sm:text-xs text-terminal-white/80">
          <div className="rounded-md border border-terminal-green/30 bg-black/70 p-4 shadow-[0_0_40px_rgba(0,255,132,0.15)]">
            <p className="text-terminal-cyan pb-2">live feed</p>
            <div className="min-h-[3.5rem] text-terminal-yellow animate-pulse">{displayMessage}</div>
            <p className="mt-3 text-terminal-white/60">Tip: repetition is a feature, not a bug.</p>
          </div>

          <div className="rounded-md border border-terminal-green/30 bg-black/70 p-4 shadow-[0_0_40px_rgba(0,255,132,0.15)]">
            <p className="text-terminal-cyan pb-2">training checklist</p>
            <ul className="space-y-1 text-terminal-white/75 list-none pl-0">
              <li>[ ] acknowledge paging noises</li>
              <li>[ ] drink water between deploys</li>
              <li>[ ] pretend to enjoy postmortems</li>
              <li>[ ] rerun tests you forgot</li>
              <li>[ ] blame cache last</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 space-y-2 text-[0.7rem] sm:text-xs text-terminal-white/70">
          <TerminalPrompt command={'echo "discipline > motivation"'} />
          <p>neurons recalibrating<TerminalCursor className="ml-1" /></p>
        </div>

        <div className="mt-6 flex flex-wrap gap-4 text-[0.7rem] sm:text-xs">
          <Link
            to="/gitgud"
            className="rounded border border-terminal-green/50 px-3 py-2 text-terminal-cyan hover:bg-terminal-green/10 focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
          >
            cd /gitgud
          </Link>
          <Link
            to="/"
            className="rounded border border-terminal-green/50 px-3 py-2 text-terminal-yellow hover:bg-terminal-green/10 focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
          >
            cd ..
          </Link>
        </div>
      </div>
    </TerminalWindow>
  );
};

export default Begud;
