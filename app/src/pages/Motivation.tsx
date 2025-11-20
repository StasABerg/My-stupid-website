import { Link } from "react-router-dom";
import { TerminalWindow, TerminalHeader, TerminalPrompt } from "@/components/SecureTerminal";
import { formatLsDate } from "@/lib/terminalFs";

const todayLabel = formatLsDate(new Date());

const Motivation = () => {
  return (
    <div className="h-screen bg-black">
      <TerminalWindow aria-label="motivation terminal">
        <TerminalHeader displayCwd="~/motivation?" />
        <div className="p-4 sm:p-6 font-mono text-xs sm:text-sm text-terminal-white flex-1 overflow-y-auto space-y-4">
          <TerminalPrompt command="ls -la ./motivation?" />
          <div className="pl-2 sm:pl-4 space-y-2">
            <p className="text-terminal-white whitespace-nowrap">
              <span className="hidden sm:inline">-rw-r--r-- 1 user user 4096 {todayLabel} </span>
              <Link
                to="/gitgud"
                className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
                aria-label="Open gitgud"
              >
                gitgud
              </Link>
              <span className="text-terminal-green pl-2"># Run the impossible progress bar</span>
            </p>
            <p className="text-terminal-white whitespace-nowrap">
              <span className="hidden sm:inline">-rw-r--r-- 1 user user 4096 {todayLabel} </span>
              <Link
                to="/begud"
                className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
                aria-label="Open begud"
              >
                begud
              </Link>
              <span className="text-terminal-green pl-2"># Rotate reminders; pretend it helps</span>
            </p>
          </div>

          <TerminalPrompt command="cat README.motivation" className="mb-2" />
          <p className="text-terminal-white/70 text-[0.75rem] sm:text-xs">
            Choose your poison. Both routes update morale by ±0.00%.
          </p>

          <TerminalPrompt
            command={
              <Link to="/" className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow">
                cd ..
              </Link>
            }
          />
        </div>
      </TerminalWindow>
    </div>
  );
};

export default Motivation;
