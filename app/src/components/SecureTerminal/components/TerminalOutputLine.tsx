interface TerminalOutputLineProps {
  line: string;
  isError: boolean;
}

function TerminalOutputLine({ line, isError }: TerminalOutputLineProps) {
  return (
    <p className={isError ? "text-terminal-red" : "text-terminal-white"}>
      {line}
    </p>
  );
}

export default TerminalOutputLine;
