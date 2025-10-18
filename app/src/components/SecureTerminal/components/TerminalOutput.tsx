import { forwardRef } from "react";
import TerminalBannerLine from "./TerminalBannerLine";
import TerminalHistoryEntry from "./TerminalHistoryEntry";

interface HistoryEntry {
  id: number;
  cwd: string;
  command: string;
  output: string[];
  isError: boolean;
}

interface TerminalOutputProps {
  bannerLines: string[];
  bannerColor: string;
  history: HistoryEntry[];
}

const TerminalOutput = forwardRef<HTMLDivElement, TerminalOutputProps>(
  ({ bannerLines, bannerColor, history }, ref) => {

    const bannerLineElements = bannerLines.map((line, index) => (
      <TerminalBannerLine
        line={line}
        color={bannerColor}
        key={`banner-${index}`}
      />
    ));

    const historyEntryElements = history.map((entry) => (
      <TerminalHistoryEntry key={entry.id} entry={entry} />
    ));

    return (
      <div ref={ref} className="h-[60vh] sm:h-[70vh] overflow-y-auto px-3 py-4 text-xs sm:text-sm text-terminal-white">
        {bannerLineElements}
        {historyEntryElements}
      </div>
    );
  }
);

TerminalOutput.displayName = "TerminalOutput";

export default TerminalOutput;
