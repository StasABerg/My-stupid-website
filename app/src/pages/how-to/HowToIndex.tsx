
import { Link } from "react-router-dom";
import { TerminalWindow, TerminalHeader, TerminalPrompt } from "@/components/SecureTerminal";
import { HOW_TO_TOPICS } from "./topics";
import { formatLsDate } from "@/lib/terminalFs";

const todayLabel = formatLsDate(new Date());

const HowToIndex = () => (
  <div className="h-screen bg-black">
    <TerminalWindow>
      <TerminalHeader displayCwd="~/briefings" />
      <div className="p-4 sm:p-6 font-mono text-xs sm:text-sm text-terminal-white flex-1 overflow-y-auto space-y-4">
        <TerminalPrompt path="~">
          <Link
            to="/"
            className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
          >
            cd ..
          </Link>
        </TerminalPrompt>
        <TerminalPrompt command="ls -la ./missions" />
        <div className="pl-2 sm:pl-4 space-y-2">
          {HOW_TO_TOPICS.map((topic) => (
            <p key={topic.slug} className="text-terminal-white whitespace-nowrap">
              <span className="hidden sm:inline">-rw-r--r-- 1 user user 4096 {todayLabel} </span>
              <Link
                to={`/how-to/${topic.slug}`}
                className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
              >
                {topic.title.toLowerCase().replace(/\s+/g, "-")}
              </Link>
              <span className="text-terminal-green pl-2"># {topic.description}</span>
            </p>
          ))}
        </div>
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

export default HowToIndex;
