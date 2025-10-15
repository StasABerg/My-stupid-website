import { useState } from "react";
import DoNothingGame from "@/components/DoNothingGame";

const Index = () => {
  const [currentDir, setCurrentDir] = useState<string>("/home/user");
  const [showDocuments, setShowDocuments] = useState(false);
  const [showGames, setShowGames] = useState(false);
  const [currentGame, setCurrentGame] = useState<string | null>(null);

  const handleFolderClick = (folder: string) => {
    if (folder === "documents") {
      setShowDocuments(!showDocuments);
      setShowGames(false);
      setCurrentGame(null);
      setCurrentDir(showDocuments ? "/home/user" : "/home/user/documents");
    } else if (folder === "games") {
      setShowGames(!showGames);
      setShowDocuments(false);
      setCurrentGame(null);
      setCurrentDir(showGames ? "/home/user" : "/home/user/games");
    }
  };

  const handleGameClick = (game: string) => {
    setCurrentGame(game);
    setCurrentDir(`/home/user/games/${game}`);
  };

  const handleBackFromGame = () => {
    setCurrentGame(null);
    setCurrentDir("/home/user/games");
  };

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
            <span className="text-terminal-cyan ml-2 sm:ml-4 truncate">terminal@gitgud.qzz.io:~</span>
          </div>
        </div>
        
        <div className="p-3 sm:p-6 font-mono text-xs sm:text-sm overflow-y-auto max-h-[85vh] sm:max-h-[80vh]">
          <pre className="text-terminal-cyan mb-4 overflow-x-auto text-[0.5rem] sm:text-xs" aria-label="Gitgud Blog logo">
{`
  ██████╗ ██╗████████╗ ██████╗ ██╗   ██╗██████╗     ██████╗ ██╗      ██████╗  ██████╗ 
 ██╔════╝ ██║╚══██╔══╝██╔════╝ ██║   ██║██╔══██╗    ██╔══██╗██║     ██╔═══██╗██╔════╝ 
 ██║  ███╗██║   ██║   ██║  ███╗██║   ██║██║  ██║    ██████╔╝██║     ██║   ██║██║  ███╗
 ██║   ██║██║   ██║   ██║   ██║██║   ██║██║  ██║    ██╔══██╗██║     ██║   ██║██║   ██║
 ╚██████╔╝██║   ██║   ╚██████╔╝╚██████╔╝██████╔╝    ██████╔╝███████╗╚██████╔╝╚██████╔╝
  ╚═════╝ ╚═╝   ╚═╝    ╚═════╝  ╚═════╝ ╚═════╝     ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝ 
`}
          </pre>

          <div className="mb-2" role="log" aria-live="polite">
            <span className="text-terminal-green">user@terminal</span>
            <span className="text-terminal-white">:</span>
            <span className="text-terminal-cyan">~</span>
            <span className="text-terminal-white">$ </span>
            <span className="text-terminal-yellow">cat welcome.txt</span>
          </div>

          <div className="mb-4 pl-2 sm:pl-4 text-terminal-white overflow-x-auto">
            <p className="whitespace-nowrap">╔═══════════════════════════════════════════╗</p>
            <p className="whitespace-nowrap">║  Welcome to my stupid website             ║</p>
            <p className="whitespace-nowrap">║  System Status: <span className="text-terminal-green">ONLINE</span>                       ║</p>
            <p className="whitespace-nowrap">║  Security Level: <span className="text-terminal-cyan">GITGUD</span>                      ║</p>
            <p className="whitespace-nowrap">╚═══════════════════════════════════════════╝</p>
          </div>

          <div className="mb-2">
            <span className="text-terminal-green">user@terminal</span>
            <span className="text-terminal-white">:</span>
            <span className="text-terminal-cyan">~</span>
            <span className="text-terminal-white">$ </span>
            <span className="text-terminal-yellow">ls -la {currentDir}</span>
          </div>

          <div className="mb-4 pl-2 sm:pl-4 overflow-x-auto">
            {!showDocuments && !showGames ? (
              <nav aria-label="Main directories" role="navigation">
                <p className="text-terminal-cyan whitespace-nowrap">
                  <span className="hidden sm:inline">drwxr-xr-x 2 user user 4096 Oct 13 2025 </span>
                  <button 
                    className="text-terminal-magenta cursor-pointer hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
                    onClick={() => handleFolderClick("documents")}
                    onKeyDown={(e) => e.key === "Enter" && handleFolderClick("documents")}
                    aria-label="Open documents folder"
                  >
                    documents/
                  </button>
                </p>
                <p className="text-terminal-cyan whitespace-nowrap">
                  <span className="hidden sm:inline">drwxr-xr-x 2 user user 4096 Oct 13 2025 </span>
                  <button 
                    className="text-terminal-magenta cursor-pointer hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
                    onClick={() => handleFolderClick("games")}
                    onKeyDown={(e) => e.key === "Enter" && handleFolderClick("games")}
                    aria-label="Open games folder"
                  >
                    games/
                  </button>
                </p>
              </nav>
            ) : showDocuments ? (
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
            ) : showGames ? (
              <nav aria-label="Games list" role="navigation">
                <p className="text-terminal-white whitespace-nowrap">
                  <span className="hidden sm:inline">-rwxr-xr-x 1 user user 2048 Oct 13 2025 </span>
                  <button 
                    className="text-terminal-green cursor-pointer hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-green"
                    onClick={() => handleGameClick("do-nothing")}
                    onKeyDown={(e) => e.key === "Enter" && handleGameClick("do-nothing")}
                    aria-label="Launch do-nothing game"
                  >
                    do-nothing
                  </button>
                </p>
              </nav>
            ) : null}
          </div>

          {currentGame ? (
            <DoNothingGame onBack={handleBackFromGame} />
          ) : (
            <>
              {showDocuments && (
                <>
                  <div className="mb-2">
                    <span className="text-terminal-green">user@terminal</span>
                    <span className="text-terminal-white">:</span>
                    <span className="text-terminal-cyan">~/documents</span>
                    <span className="text-terminal-white">$ </span>
                    <button 
                      className="text-terminal-yellow cursor-pointer hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
                      onClick={() => handleFolderClick("documents")}
                      onKeyDown={(e) => e.key === "Enter" && handleFolderClick("documents")}
                      aria-label="Go back to home directory"
                    >
                      cd ..
                    </button>
                  </div>
                </>
              )}

              {showGames && (
                <>
                  <div className="mb-2">
                    <span className="text-terminal-green">user@terminal</span>
                    <span className="text-terminal-white">:</span>
                    <span className="text-terminal-cyan">~/games</span>
                    <span className="text-terminal-white">$ </span>
                    <button 
                      className="text-terminal-yellow cursor-pointer hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
                      onClick={() => handleFolderClick("games")}
                      onKeyDown={(e) => e.key === "Enter" && handleFolderClick("games")}
                      aria-label="Go back to home directory"
                    >
                      cd ..
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {!showDocuments && !showGames && !currentGame && (
            <>
              <div className="mb-2">
                <span className="text-terminal-green">user@terminal</span>
                <span className="text-terminal-white">:</span>
                <span className="text-terminal-cyan">~</span>
                <span className="text-terminal-white">$ </span>
                <span className="text-terminal-yellow">fastfetch</span>
              </div>

              <div className="mb-4 pl-2 sm:pl-4 overflow-x-auto">
                <pre className="text-terminal-magenta text-[0.65rem] sm:text-xs" aria-label="System information">
{`        .---.
       /     \\       OS: Gitgud 2025
      | O _ O |      Host: Unknown
      |   >   |      Kernel: 6.6.6
     /|  ---  |\\     Uptime: 420 years, 69 days
    / \\_______/ \\    Shell: gitgudsh 4.2.0
   /  |  / \\  |  \\
  /   | /   \\ |   \\
      |/     \\|
`}
                </pre>
              </div>
            </>
          )}

          {!currentGame && (
            <div className="flex items-center">
              <span className="text-terminal-green">user@terminal</span>
              <span className="text-terminal-white">:</span>
              <span className="text-terminal-cyan">
                {showDocuments ? "~/documents" : showGames ? "~/games" : "~"}
              </span>
              <span className="text-terminal-white">$ </span>
              <span className="text-terminal-white cursor-blink">█</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Index;