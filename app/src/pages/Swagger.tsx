import { Link } from "react-router-dom";
import { TerminalWindow, TerminalHeader, TerminalPrompt } from "@/components/SecureTerminal";
import { formatLsDate } from "@/lib/terminalFs";

const swaggerEntries = [
  {
    label: "radio-api",
    path: "/radio/docs",
    description: "Swagger UI for the Radio service",
    available: true,
  },
  {
    label: "terminal-api",
    path: "/terminal/docs",
    description: "Swagger UI for the Terminal service",
    available: true,
  },
  {
    label: "gateway-api",
    path: "/gateway/docs",
    description: "Swagger UI for the API Gateway",
    available: true,
  },
];

const todayLabel = formatLsDate(new Date());

const SwaggerDirectory = () => (
  <div className="min-h-screen bg-black text-terminal-white">
    <TerminalWindow>
      <TerminalHeader displayCwd="~/swagger" />
      <div className="flex flex-1 flex-col overflow-y-auto p-3 font-mono text-xs sm:p-6 sm:text-sm">
        <TerminalPrompt
          user="sandbox"
          host="gitgud.qzz.io"
          path="~/swagger"
          command={(
            <Link
              to="/"
              className="focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
            >
              cd ..
            </Link>
          )}
        />

        <TerminalPrompt command="ls -la" />
        <div className="mt-2 space-y-2 pl-2 sm:pl-4">
          {swaggerEntries.map((entry) => (
            <div key={entry.label} className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
              <span className="hidden sm:inline text-terminal-cyan">-rw-r--r-- 1 user user 4096 {todayLabel}</span>
              {entry.available ? (
                <Link
                  to={entry.path}
                  className="text-terminal-magenta hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
                >
                  {entry.label}
                </Link>
              ) : (
                <span className="text-terminal-yellow">{entry.label}</span>
              )}
              <span className="text-terminal-green sm:text-terminal-white"># {entry.description}</span>
            </div>
          ))}
        </div>
      </div>
    </TerminalWindow>
  </div>
);

export default SwaggerDirectory;
