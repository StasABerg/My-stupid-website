import TerminalOutputLine from "./TerminalOutputLine";

interface HistoryEntry {
  id: number;
  cwd: string;
  command: string;
  output: string[];
  isError: boolean;
  promptLabel: string;
}

interface TerminalHistoryEntryProps {
  entry: HistoryEntry;
}

function TerminalHistoryEntry({ entry }: TerminalHistoryEntryProps) {

  const outputLineElements = entry.output.length ? entry.output.map((line, index) => (
    <TerminalOutputLine
      key={`${entry.id}-${index}`}
      line={line}
      isError={entry.isError}
    />
  )) : <p className="text-terminal-white">&nbsp;</p>;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-x-1">
        <span className="text-terminal-cyan">{entry.promptLabel}</span>
        <span className="text-terminal-white">$</span>
        <span className="text-terminal-yellow">{entry.command}</span>
      </div>
      <div className="mt-1 space-y-1">
        {outputLineElements}
      </div>
    </div>
  );
}

export default TerminalHistoryEntry;
