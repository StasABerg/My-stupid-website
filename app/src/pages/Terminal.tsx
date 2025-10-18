import { Link } from "react-router-dom";
import { SecureTerminal } from "@/components/SecureTerminal";

const Terminal = () => {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4 p-2 sm:p-6">
      <div className="w-full max-w-4xl text-center font-mono text-xs sm:text-sm text-terminal-white">
        <p className="text-terminal-green">
          Commands run against a locked-down Kubernetes pod with whitelisted binaries and an ephemeral filesystem.
        </p>
        <p className="mt-1 text-terminal-cyan">
          Need to leave?{" "}
          <Link
            to="/"
            className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
          >
            cd ~
          </Link>
        </p>
      </div>
      <SecureTerminal />
    </div>
  );
};

export default Terminal;
