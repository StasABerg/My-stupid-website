interface TerminalCursorProps {
  className?: string;
}

function TerminalCursor({ className = "" }: TerminalCursorProps) {
  return (
    <span className={`text-terminal-white cursor-blink ${className}`}>█</span>
  );
}

export default TerminalCursor;
