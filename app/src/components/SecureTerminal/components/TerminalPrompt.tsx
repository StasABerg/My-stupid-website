import { ReactNode } from "react";

import { ReactNode } from "react";

interface TerminalPromptProps {
  user?: string;
  host?: string;
  path?: string;
  command?: ReactNode;
  children?: ReactNode;
  className?: string;
}

function TerminalPrompt({ 
  user = "user", 
  host = "terminal", 
  path = "~", 
  command,
  children,
  className = ""
}: TerminalPromptProps) {
  return (
    <div className={`mb-2 wrap-break-word ${className}`}>
      <span className="text-terminal-green">{user}@{host}</span>
      <span className="text-terminal-white">:</span>
      <span className="text-terminal-cyan">{path}</span>
      <span className="text-terminal-white">$ </span>
      {command && (
        typeof command === "string" ? (
          <span className="text-terminal-yellow">{command}</span>
        ) : (
          <span className="text-terminal-yellow [&_a]:text-terminal-yellow [&_a:hover]:underline">
            {command}
          </span>
        )
      )}
      {children}
    </div>
  );
}

export default TerminalPrompt;
