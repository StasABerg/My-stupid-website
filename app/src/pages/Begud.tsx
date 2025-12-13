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
    <div className="h-screen bg-black">
      <TerminalWindow aria-label="BeGud training terminal">
        <TerminalHeader displayCwd="~/begud" />
        <div className="flex-1 overflow-auto p-4 sm:p-6 text-terminal-white font-mono text-xs sm:text-sm space-y-4">
          <TerminalPrompt path="~">
            <Link
              to="/"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ..
            </Link>
          </TerminalPrompt>
          <TerminalPrompt command="watch -n2 /var/log/begud.log" />

          <div className="space-y-2 text-terminal-white/80">
            <p className="text-terminal-cyan">live feed</p>
            <p className="text-terminal-yellow">{displayMessage}</p>
            <p className="text-terminal-white/60">Tip: repetition is a feature, not a bug.</p>
          </div>

          <div className="space-y-1 text-terminal-white/75">
            <p className="text-terminal-cyan">training checklist</p>
            <ul className="space-y-1 list-none pl-0">
              <li>[ ] acknowledge paging noises</li>
              <li>[ ] drink water between deploys</li>
              <li>[ ] pretend to enjoy postmortems</li>
              <li>[ ] rerun tests you forgot</li>
              <li>[ ] blame cache last</li>
            </ul>
          </div>

          <div className="space-y-2 text-terminal-white/70">
            <TerminalPrompt command={'echo "discipline > motivation"'} />
            <p>neurons recalibrating<TerminalCursor className="ml-1" /></p>
          </div>

          <TerminalPrompt path="~/begud">
            <Link
              to="/gitgud"
              className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
            >
              cd /gitgud
            </Link>
          </TerminalPrompt>

          <TerminalPrompt path="~/begud">
            <Link
              to="/"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ..
            </Link>
          </TerminalPrompt>
          <TerminalPrompt path="~/begud">
            <TerminalCursor />
          </TerminalPrompt>
        </div>
      </TerminalWindow>
    </div>
  );
};

export default Begud;
