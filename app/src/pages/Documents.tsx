import { Link } from "react-router-dom";

export default function Documents() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-2 sm:p-4 font-mono text-sm">
      <div className="w-full max-w-4xl border-2 border-terminal-green p-4">
        <div className="mb-2">
          <span className="text-terminal-green">user@terminal</span>
          <span className="text-terminal-white">:~/documents$ </span>
          <Link
            to="/"
            className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
          >
            cd ..
          </Link>
        </div>

        <p className="text-terminal-white whitespace-nowrap">
          -rw-r--r-- Github →{" "}
          <a
            href="https://github.com/StasABerg"
            target="_blank"
            rel="noopener noreferrer"
            className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
          >
            github.com/StasABerg
          </a>
        </p>

        <p className="text-terminal-white whitespace-nowrap">
          -rw-r--r-- LinkedIn →{" "}
          <a
            href="https://linkedin.com/in/stasaberg"
            target="_blank"
            rel="noopener noreferrer"
            className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
          >
            linkedin.com/in/stasaberg
          </a>
        </p>
      </div>
    </div>
  );
}
