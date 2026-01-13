import { Link } from "react-router-dom";
import { TerminalHeader, TerminalPrompt, TerminalWindow } from "@/components/SecureTerminal";
import { SwaggerEmbed } from "@/components/swagger";

const TerminalDocs = () => (
  <div className="h-screen bg-black text-terminal-white">
    <TerminalWindow aria-label="Terminal docs">
      <TerminalHeader displayCwd="~/swagger/terminal" />
      <div className="flex flex-1 flex-col overflow-y-auto p-3 font-mono text-xs sm:p-6 sm:text-sm space-y-4">
        <TerminalPrompt
          user="sandbox"
          host="gitgud.zip"
          path="~/swagger/terminal"
          command={(
            <Link
              to="/swagger"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
            >
              cd ..
            </Link>
          )}
        />
        <div className="border border-terminal-green/40 rounded-md bg-black/80 p-3">
          <SwaggerEmbed specUrl="/api/terminal/docs/json" className="min-h-[70vh]" />
        </div>
      </div>
    </TerminalWindow>
  </div>
);

export default TerminalDocs;
