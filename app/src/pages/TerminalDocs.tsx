import { Link } from "react-router-dom";
import { TerminalPrompt } from "@/components/SecureTerminal";

const TerminalDocs = () => (
  <div className="min-h-screen bg-slate-950 p-4 sm:p-8">
    <div className="mx-auto mb-4 max-w-5xl font-mono text-xs sm:text-sm">
      <TerminalPrompt
        user="sandbox"
        host="gitgud.qzz.io"
        path="~/swagger"
        command={(
          <Link
            to="/swagger"
            className="focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
          >
            cd ..
          </Link>
        )}
      />
    </div>
    <div className="mx-auto max-w-5xl rounded-lg bg-white p-4 shadow-lg">
      <iframe
        title="Terminal API documentation"
        src="/api/terminal/docs"
        className="h-[80vh] w-full border-0"
        loading="lazy"
      />
    </div>
  </div>
);

export default TerminalDocs;
