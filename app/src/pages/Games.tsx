import { Link } from "react-router-dom";

export default function Games() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-2 sm:p-4 font-mono text-sm">
      <div className="w-full max-w-4xl border-2 border-terminal-green p-4">
        <div className="mb-2">
          <span className="text-terminal-green">user@terminal</span>
          <span className="text-terminal-white">:~/games$ </span>
          <Link
            to="/"
            className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
          >
            cd ..
          </Link>
        </div>

        <p className="text-terminal-white">
          -rwxr-xr-x{" "}
          <Link
            to="/games/do-nothing"
            className="text-terminal-green hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-green"
          >
            do-nothing
          </Link>
        </p>
      </div>
    </div>
  );
}
