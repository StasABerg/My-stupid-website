
import { Link } from "react-router-dom";
import { TerminalWindow, TerminalHeader, TerminalPrompt } from "@/components/SecureTerminal";
import { HOW_TO_TOPICS } from "./topics";

const HowToIndex = () => (
  <div className="h-screen bg-black">
    <TerminalWindow>
      <TerminalHeader displayCwd="~/briefings" />
      <div className="p-4 sm:p-6 font-mono text-xs sm:text-sm text-terminal-white flex-1 overflow-y-auto space-y-4">
        <TerminalPrompt command="ls -la ./missions" />
        <div className="grid sm:grid-cols-2 gap-3">
          {HOW_TO_TOPICS.map((topic) => (
            <Link
              key={topic.slug}
              to={`/how-to/${topic.slug}`}
              className="border border-terminal-green/30 px-3 py-2 text-terminal-cyan hover:border-terminal-yellow/60 hover:text-terminal-yellow"
            >
              <span className="block text-terminal-yellow text-xs uppercase tracking-[0.2em]">{topic.title}</span>
              <span className="text-terminal-white/70 text-[0.65rem]">{topic.description}</span>
            </Link>
          ))}
        </div>
        <TerminalPrompt command="cd .." />
        <Link to="/" className="text-terminal-cyan hover:text-terminal-yellow underline">
          return /
        </Link>
      </div>
    </TerminalWindow>
  </div>
);

export default HowToIndex;
