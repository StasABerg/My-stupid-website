import { formatLsDate } from "@/lib/terminalFs";
import { Link } from "react-router-dom";

const todayLabel = formatLsDate(new Date());
import { TerminalWindow, TerminalHeader, TerminalPrompt, TerminalCursor } from "@/components/SecureTerminal";

const Games = () => {
  return (
    <div className="h-screen bg-black">
      <TerminalWindow aria-label="Games page">
        <TerminalHeader displayCwd="~/games" />
        
        <div className="p-3 sm:p-6 font-mono text-xs sm:text-sm flex-1 overflow-y-auto">
          <TerminalPrompt path="~">
            <Link
              to="/"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ..
            </Link>
          </TerminalPrompt>
          <TerminalPrompt path="~/games" command="ls -la" />

          <div className="mb-4 pl-2 sm:pl-4">
            <nav aria-label="Games list" role="navigation">
              <p className="text-terminal-white whitespace-nowrap">
                <span className="hidden sm:inline">-rwxr-xr-x 1 user user 2048 {todayLabel} </span>
                <Link 
                  to="/games/do-nothing"
                  className="text-terminal-green hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-green"
                  aria-label="Launch do-nothing game"
                >
                  do-nothing
                </Link>
              </p>
            </nav>
          </div>

          <TerminalPrompt path="~/games">
            <Link 
              to="/"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
              aria-label="Go back to home directory"
            >
              cd ..
            </Link>
          </TerminalPrompt>

          <TerminalPrompt path="~/games">
            <TerminalCursor />
          </TerminalPrompt>
        </div>
      </TerminalWindow>
    </div>
  );
};

export default Games;
