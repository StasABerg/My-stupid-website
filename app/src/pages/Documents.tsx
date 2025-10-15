import { Link } from "react-router-dom";

const Documents = () => {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-2 sm:p-4">
      <div 
        className="w-full max-w-4xl bg-black border-2 border-terminal-green shadow-[0_0_30px_rgba(0,255,0,0.3)] rounded-none"
        role="main"
        aria-label="Documents page"
      >
        <div className="border-b-2 border-terminal-green p-2 bg-black">
          <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
            <span className="text-terminal-red" aria-hidden="true">●</span>
            <span className="text-terminal-yellow" aria-hidden="true">●</span>
            <span className="text-terminal-green" aria-hidden="true">●</span>
            <span className="text-terminal-cyan ml-2 sm:ml-4 truncate">terminal@gitgud.qzz.io:~/documents</span>
          </div>
        </div>
        
        <div className="p-3 sm:p-6 font-mono text-xs sm:text-sm">
          <div className="mb-2">
            <span className="text-terminal-green">user@terminal</span>
            <span className="text-terminal-white">:</span>
            <span className="text-terminal-cyan">~/documents</span>
            <span className="text-terminal-white">$ </span>
            <span className="text-terminal-yellow">ls -la</span>
          </div>

          <div className="mb-4 pl-2 sm:pl-4">
            <nav aria-label="Document links" role="navigation">
              <p className="text-terminal-white whitespace-nowrap">
                <span className="hidden sm:inline">-rw-r--r-- 1 user user 1024 Oct 13 2025 </span>
                <a 
                  href="https://github.com/StasABerg" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
                  aria-label="Visit GitHub profile"
                >
                  Github
                </a>
              </p>
              <p className="text-terminal-white whitespace-nowrap">
                <span className="hidden sm:inline">-rw-r--r-- 1 user user 1024 Oct 13 2025 </span>
                <a 
                  href="https://linkedin.com/in/stasaberg" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-terminal-cyan hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-cyan"
                  aria-label="Visit LinkedIn profile"
                >
                  Linkedin
                </a>
              </p>
            </nav>
          </div>

          <div className="mb-4">
            <span className="text-terminal-green">user@terminal</span>
            <span className="text-terminal-white">:</span>
            <span className="text-terminal-cyan">~/documents</span>
            <span className="text-terminal-white">$ </span>
            <Link 
              to="/"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
              aria-label="Go back to home directory"
            >
              cd ..
            </Link>
          </div>

          <div className="flex items-center">
            <span className="text-terminal-green">user@terminal</span>
            <span className="text-terminal-white">:</span>
            <span className="text-terminal-cyan">~/documents</span>
            <span className="text-terminal-white">$ </span>
            <span className="text-terminal-white cursor-blink">█</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Documents;