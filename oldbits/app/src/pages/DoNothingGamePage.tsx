import { Link } from "react-router-dom";
import DoNothingGame from "@/components/DoNothingGame";
import { TerminalWindow, TerminalHeader, TerminalPrompt } from "@/components/SecureTerminal";

const DoNothingGamePage = () => {
  return (
    <div className="h-screen bg-black">
      <TerminalWindow>
        <TerminalHeader displayCwd="~/games/do-nothing" />
        
        <div className="p-3 sm:p-6 font-mono text-xs sm:text-sm flex-1 overflow-y-auto">
          <TerminalPrompt path="~/games">
            <Link
              to="/games"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ..
            </Link>
          </TerminalPrompt>
          <DoNothingGame
            backLink={
              <Link
                to="/games"
                className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
                aria-label="Go back to games directory"
              >
                cd ..
              </Link>
            }
          />
        </div>
      </TerminalWindow>
    </div>
  );
};

export default DoNothingGamePage;