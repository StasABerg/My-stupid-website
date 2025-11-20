import { Link } from "react-router-dom";
import { TerminalWindow, TerminalHeader, TerminalPrompt } from "@/components/SecureTerminal";

const Motivation = () => {
  return (
    <div className="h-screen bg-black">
      <TerminalWindow aria-label="motivation terminal">
        <TerminalHeader displayCwd="~/motivation?" />
        <div className="p-4 sm:p-6 font-mono text-xs sm:text-sm text-terminal-white flex-1 overflow-y-auto space-y-4">
          <TerminalPrompt command="ls -la ./motivation?" />
          <div className="grid sm:grid-cols-2 gap-3">
            <Link
              to="/gitgud"
              className="border border-terminal-green/40 bg-black/60 px-3 py-2 text-terminal-cyan hover:border-terminal-yellow/60 hover:text-terminal-yellow focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
              aria-label="Open gitgud"
            >
              <span className="block text-terminal-yellow text-xs uppercase tracking-[0.2em]">gitgud/</span>
              <span className="text-terminal-white/70 text-[0.65rem]">
                Run the impossible progress bar. Fails at 98% by design.
              </span>
            </Link>

            <Link
              to="/begud"
              className="border border-terminal-green/40 bg-black/60 px-3 py-2 text-terminal-cyan hover:border-terminal-yellow/60 hover:text-terminal-yellow focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
              aria-label="Open begud"
            >
              <span className="block text-terminal-yellow text-xs uppercase tracking-[0.2em]">begud/</span>
              <span className="text-terminal-white/70 text-[0.65rem]">
                Watch the rotating reminders; pretend they are positive reinforcement.
              </span>
            </Link>
          </div>

          <TerminalPrompt command={<Link to="/" className="text-terminal-yellow hover:underline">cd ..</Link>} />
        </div>
      </TerminalWindow>
    </div>
  );
};

export default Motivation;
