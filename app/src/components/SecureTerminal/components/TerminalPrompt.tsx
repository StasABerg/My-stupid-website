import { ReactNode } from "react";

interface TerminalPromptProps {
  user?: string;
  host?: string;
  path?: string;
  command?: string;
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
    <div className={`mb-2 break-words ${className}`}>
      <span className="text-terminal-green">{user}@{host}</span>
      <span className="text-terminal-white">:</span>
      <span className="text-terminal-cyan">{path}</span>
      <span className="text-terminal-white">$ </span>
      {command && <span className="text-terminal-yellow">{command}</span>}
      {children}
    </div>
  );
}

export default TerminalPrompt;
