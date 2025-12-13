import { formatLsDate } from "@/lib/terminalFs";
import { Link } from "react-router-dom";

const todayLabel = formatLsDate(new Date());
import { TerminalWindow, TerminalHeader, TerminalPrompt, TerminalCursor } from "@/components/SecureTerminal";

const Documents = () => {
  return (
    <div className="h-screen bg-black">
      <TerminalWindow aria-label="Documents page">
        <TerminalHeader displayCwd="~/documents" />
        
        <div className="p-3 sm:p-6 font-mono text-xs sm:text-sm flex-1 overflow-y-auto">
          <TerminalPrompt path="~">
            <Link
              to="/"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ..
            </Link>
          </TerminalPrompt>
          <TerminalPrompt path="~/documents" command="ls -la" />

          <div className="mb-4 pl-2 sm:pl-4">
            <nav aria-label="Document links" role="navigation">
              <p className="text-terminal-white whitespace-nowrap">
                <span className="hidden sm:inline">-rw-r--r-- 1 user user 1024 {todayLabel} </span>
                <a 
                  href="https://forgejo.gitgud.zip/stasaberg/My-stupid-website" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
                  aria-label="Visit GitHub profile"
                >
                  Github
                </a>
              </p>
              <p className="text-terminal-white whitespace-nowrap">
                <span className="hidden sm:inline">-rw-r--r-- 1 user user 1024 {todayLabel} </span>
                <a 
                  href="https://linkedin.com/in/stasaberg" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
                  aria-label="Visit LinkedIn profile"
                >
                  Linkedin
                </a>
              </p>
            </nav>
          </div>

          <TerminalPrompt path="~/documents">
            <Link 
              to="/"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
              aria-label="Go back to home directory"
            >
              cd ..
            </Link>
          </TerminalPrompt>

          <TerminalPrompt path="~/documents">
            <TerminalCursor />
          </TerminalPrompt>
        </div>
      </TerminalWindow>
    </div>
  );
};

export default Documents;
