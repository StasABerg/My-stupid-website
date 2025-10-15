import { Link } from "react-router-dom";

export default function Home() {
  const currentDir = "/home/user";

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-2 sm:p-4">
      <div
        className="w-full max-w-4xl bg-black border-2 border-terminal-green shadow-[0_0_30px_rgba(0,255,0,0.3)] rounded-none"
        role="main"
        aria-label="Terminal interface"
        id="main-content"
      >
        <div className="border-b-2 border-terminal-green p-2 bg-black">
          <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
            <span className="text-terminal-red" aria-hidden="true">●</span>
            <span className="text-terminal-yellow" aria-hidden="true">●</span>
            <span className="text-terminal-green" aria-hidden="true">●</span>
            <span className="text-terminal-cyan ml-2 sm:ml-4 truncate">
              terminal@gitgud.qzz.io:~
            </span>
          </div>
        </div>

        <div className="p-3 sm:p-6 font-mono text-xs sm:text-sm overflow-y-auto max-h-[85vh] sm:max-h-[80vh]">

          <pre
            className="hidden sm:block text-terminal-cyan mb-4 overflow-x-auto text-[0.5rem] sm:text-xs"
            aria-label="Gitgud Blog logo"
          >{`
          ██████╗ ██╗████████╗ ██████╗ ██╗   ██╗██████╗     ██████╗ ██╗      ██████╗  ██████╗ 
         ██╔════╝ ██║╚══██╔══╝██╔════╝ ██║   ██║██╔══██╗    ██╔══██╗██║     ██╔═══██╗██╔════╝ 
         ██║  ███╗██║   ██║   ██║  ███╗██║   ██║██║  ██║    ██████╔╝██║     ██║   ██║██║  ███╗
         ██║   ██║██║   ██║   ██║   ██║██║   ██║██║  ██║    ██╔══██╗██║     ██║   ██║██║   ██║
         ╚██████╔╝██║   ██║   ╚██████╔╝╚██████╔╝██████╔╝    ██████╔╝███████╗╚██████╔╝╚██████╔╝
          ╚═════╝ ╚═╝   ╚═╝    ╚═════╝  ╚═════╝ ╚═════╝     ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝ 
          `}</pre>

          <pre
            className="block sm:hidden text-terminal-cyan mb-4 text-[0.4rem]"
            aria-label="Gitgud folded logo"
          >{`
          ██████╗ ██╗████████╗ ██████╗ ██╗   ██╗██████╗  
         ██╔════╝ ██║╚══██╔══╝██╔════╝ ██║   ██║██╔══██╗ 
         ██║  ███╗██║   ██║   ██║  ███╗██║   ██║██║  ██║ 
         ██║   ██║██║   ██║   ██║   ██║██║   ██║██║  ██║ 
         ╚██████╔╝██║   ██║   ╚██████╔╝╚██████╔╝██████╔╝ 
          ╚═════╝ ╚═╝   ╚═╝    ╚═════╝  ╚═════╝ ╚═════╝  
        
               ██████╗ ██╗      ██████╗  ██████╗ 
               ██╔══██╗██║     ██╔═══██╗██╔════╝ 
               ██████╔╝██║     ██║   ██║██║  ███╗
               ██╔══██╗██║     ██║   ██║██║   ██║
               ██████╔╝███████╗╚██████╔╝╚██████╔╝
               ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝ 
          `}</pre>

          <div className="mb-2" role="log" aria-live="polite">
            <span className="text-terminal-green">user@terminal</span>
            <span className="text-terminal-white">:</span>
            <span className="text-terminal-cyan">~</span>
            <span className="text-terminal-white">$ </span>
            <span className="text-terminal-yellow">cat welcome.txt</span>
          </div>

          <div className="mb-4 font-mono text-terminal-white leading-none">
            <p>╔═══════════════════════════════════════════╗</p>
            <p>║ Welcome to my stupid website              ║</p>
            <p>║ System Status: <span className="text-terminal-green">ONLINE</span>                ║</p>
            <p>║ Security Level: <span className="text-terminal-cyan">GITGUD</span>               ║</p>
            <p>╚═══════════════════════════════════════════╝</p>
          </div>

          <div className="mb-2">
            <span className="text-terminal-green">user@terminal</span>
            <span className="text-terminal-white">:</span>
            <span className="text-terminal-cyan">~</span>
            <span className="text-terminal-white">$ </span>
            <span className="text-terminal-yellow">ls -la {currentDir}</span>
          </div>

          <div className="mb-4 pl-2 sm:pl-4 overflow-x-auto">
            <nav>
              <p className="text-terminal-cyan whitespace-nowrap">
                <span className="hidden sm:inline">drwxr-xr-x 2 user user 4096 Oct 13 2025 </span>
                <Link
                  to="/documents"
                  className="text-terminal-magenta hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
                >
                  documents/
                </Link>
              </p>

              <p className="text-terminal-cyan whitespace-nowrap">
                <span className="hidden sm:inline">drwxr-xr-x 2 user user 4096 Oct 13 2025 </span>
                <Link
                  to="/games"
                  className="text-terminal-magenta hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
                >
                  games/
                </Link>
              </p>
            </nav>
          </div>

          <div className="flex items-center">
            <span className="text-terminal-green">user@terminal</span>
            <span className="text-terminal-white">:</span>
            <span className="text-terminal-cyan">~</span>
            <span className="text-terminal-white">$ </span>
            <span className="text-terminal-white cursor-blink">█</span>
          </div>
        </div>
      </div>
    </div>
  );
}
