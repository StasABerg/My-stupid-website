import { Link } from "react-router-dom";
import { formatLsDate } from "@/lib/terminalFs";
import { TerminalWindow, TerminalHeader, TerminalPrompt } from "@/components/SecureTerminal";

const todayLabel = formatLsDate(new Date());

const Docs = () => (
  <div className="h-screen bg-black">
    <TerminalWindow aria-label="Docs directory">
      <TerminalHeader displayCwd="~/docs" />
      <div className="p-3 sm:p-6 font-mono text-xs sm:text-sm flex-1 overflow-y-auto space-y-4 text-terminal-white">
        <TerminalPrompt command="ls -la ./docs" />

        <div className="pl-2 sm:pl-4 space-y-2">
          <p className="whitespace-nowrap">
            <span className="hidden sm:inline text-terminal-white">-rw-r--r-- 1 user user 4096 {todayLabel} </span>
            <Link
              to="/swagger"
              className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
            >
              swagger
            </Link>
            <span className="text-terminal-green pl-2"># swagger directory</span>
          </p>
          <p className="whitespace-nowrap">
            <span className="hidden sm:inline text-terminal-white">-rw-r--r-- 1 user user 4096 {todayLabel} </span>
            <a
              href="/gateway/docs"
              className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
            >
              gateway.docs
            </a>
            <span className="text-terminal-green pl-2"># API Gateway swagger</span>
          </p>
          <p className="whitespace-nowrap">
            <span className="hidden sm:inline text-terminal-white">-rw-r--r-- 1 user user 4096 {todayLabel} </span>
            <a
              href="/radio/docs"
              className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
            >
              radio.docs
            </a>
            <span className="text-terminal-green pl-2"># Radio service swagger</span>
          </p>
          <p className="whitespace-nowrap">
            <span className="hidden sm:inline text-terminal-white">-rw-r--r-- 1 user user 4096 {todayLabel} </span>
            <a
              href="/terminal/docs"
              className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
            >
              terminal.docs
            </a>
            <span className="text-terminal-green pl-2"># Terminal service swagger</span>
          </p>
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

export default Docs;
