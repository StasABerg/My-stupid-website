import { Link } from "react-router-dom";
import { TerminalPrompt } from "@/components/SecureTerminal";

const RadioHeader = () => (
  <div className="space-y-2">
    <TerminalPrompt path="~">
      <Link
        to="/"
        className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
      >
        cd ..
      </Link>
    </TerminalPrompt>
    <TerminalPrompt path="~/radio" command="radio --help" />
    <div className="pl-6 text-terminal-white/80 space-y-1">
      <p>Use the controls below to search and tune into stations from the Gitgud directory.</p>
      <p>
        Adjust filters, choose presets, or scroll the list to lock onto a new frequency. Audio
        starts automatically when a station is active.
      </p>
    </div>
  </div>
);

export default RadioHeader;
