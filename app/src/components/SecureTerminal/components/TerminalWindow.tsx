import { ReactNode } from "react";

interface TerminalWindowProps {
  children: ReactNode;
  className?: string;
  role?: string;
  "aria-label"?: string;
}

function TerminalWindow({ 
  children, 
  className = "", 
  role = "main", 
  "aria-label": ariaLabel = "Terminal interface" 
}: TerminalWindowProps) {
  return (
    <div 
      className={`w-full h-screen bg-black border-2 border-terminal-green shadow-[0_0_30px_rgba(0,255,0,0.3)] rounded-none flex flex-col ${className}`}
      role={role}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

export default TerminalWindow;
