import { Link } from "react-router-dom";
import { TerminalWindow, TerminalHeader, TerminalPrompt } from "@/components/SecureTerminal";

const Motivation = () => {
  return (
    <TerminalWindow aria-label="motivation terminal" className="bg-black">
      <TerminalHeader displayCwd="/motivation?" label="gitgud@ops:/motivation? — morale sync" />
      <div className="flex-1 overflow-auto bg-gradient-to-b from-black via-[#050910] to-black p-4 sm:p-6 text-terminal-white font-mono">
        <TerminalPrompt command="ls ./motivation?" />
        <div className="mt-3 grid gap-4 sm:grid-cols-2 text-[0.8rem] sm:text-sm">
          <Link
            to="/gitgud"
            className="group rounded-md border border-terminal-green/40 bg-black/70 p-4 shadow-[0_0_30px_rgba(0,255,132,0.18)] transition hover:border-terminal-green/70 hover:bg-terminal-green/5 focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            aria-label="Open gitgud"
          >
            <div className="flex items-center justify-between">
              <span className="text-terminal-cyan">gitgud/</span>
              <span className="text-terminal-yellow text-[0.7rem] uppercase tracking-[0.2em] group-hover:text-terminal-green">
                enter
              </span>
            </div>
            <p className="mt-2 text-terminal-white/70 text-[0.75rem]">
              Run the impossible progress bar. Fails at 98% by design.
            </p>
          </Link>

          <Link
            to="/begud"
            className="group rounded-md border border-terminal-green/40 bg-black/70 p-4 shadow-[0_0_30px_rgba(0,255,132,0.18)] transition hover:border-terminal-green/70 hover:bg-terminal-green/5 focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            aria-label="Open begud"
          >
            <div className="flex items-center justify-between">
              <span className="text-terminal-cyan">begud/</span>
              <span className="text-terminal-yellow text-[0.7rem] uppercase tracking-[0.2em] group-hover:text-terminal-green">
                enter
              </span>
            </div>
            <p className="mt-2 text-terminal-white/70 text-[0.75rem]">
              Watch the rotating reminders; pretend they are positive reinforcement.
            </p>
          </Link>
        </div>

        <div className="mt-6 text-terminal-white/60 text-[0.75rem] sm:text-xs">
          <TerminalPrompt command="cat README.motivation" className="mb-2" />
          <p>Choose your poison. Both routes update morale by ±0.00%.</p>
        </div>
      </div>
    </TerminalWindow>
  );
};

export default Motivation;
