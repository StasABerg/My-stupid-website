import { Link } from "react-router-dom";
import { TerminalWindow, TerminalHeader, TerminalPrompt, TerminalCursor } from "@/components/SecureTerminal";
import { formatLsDate } from "@/lib/date-format";

const todayLabel = formatLsDate(new Date());

const Tools = () => {
  return (
    <div className="h-screen bg-black">
      <TerminalWindow aria-label="Tools page">
        <TerminalHeader displayCwd="~/tools" />

        <div className="p-3 sm:p-6 font-mono text-xs sm:text-sm flex-1 overflow-y-auto space-y-4">
          <TerminalPrompt path="~">
            <Link
              to="/"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ..
            </Link>
          </TerminalPrompt>

          <TerminalPrompt command="ls -la ./tools" />

          <div className="pl-2 sm:pl-4 space-y-2">
            <p className="text-terminal-white whitespace-nowrap">
              <span className="hidden sm:inline">-rw-r--r-- 1 user user 4096 {todayLabel} </span>
              <Link
                to="/tools/web-to-markdown"
                className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
                aria-label="Convert a webpage to markdown"
              >
                web-to-markdown
              </Link>
              <span className="text-terminal-green pl-2"># Fetch a URL and output markdown</span>
            </p>
            <p className="text-terminal-white whitespace-nowrap">
              <span className="hidden sm:inline">-rw-r--r-- 1 user user 4096 {todayLabel} </span>
              <Link
                to="/tools/image-to-ascii"
                className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
                aria-label="Convert an image to ASCII art"
              >
                image-to-ascii
              </Link>
              <span className="text-terminal-green pl-2"># Local-only ASCII conversion</span>
            </p>
          </div>

          <TerminalPrompt path="~/tools">
            <TerminalCursor />
          </TerminalPrompt>
        </div>
      </TerminalWindow>
    </div>
  );
};

export default Tools;

