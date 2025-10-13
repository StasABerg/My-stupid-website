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
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-black border-2 border-terminal-green shadow-[0_0_30px_rgba(0,255,0,0.3)] rounded-none">
        <div className="border-b-2 border-terminal-green p-2 bg-black">
          <div className="flex items-center gap-2">
            <span className="text-terminal-red">●</span>
            <span className="text-terminal-yellow">●</span>
            <span className="text-terminal-green">●</span>
            <span className="text-terminal-cyan ml-4">terminal@gitgud.qzz.io:~</span>
          </div>
        </div>
        
        <div className="p-6 font-mono text-sm overflow-y-auto max-h-[80vh]">
          <pre className="text-terminal-cyan mb-4">
{`
  ██████╗ ██╗████████╗ ██████╗ ██╗   ██╗██████╗     ██████╗ ██╗      ██████╗  ██████╗ 
 ██╔════╝ ██║╚══██╔══╝██╔════╝ ██║   ██║██╔══██╗    ██╔══██╗██║     ██╔═══██╗██╔════╝ 
 ██║  ███╗██║   ██║   ██║  ███╗██║   ██║██║  ██║    ██████╔╝██║     ██║   ██║██║  ███╗
 ██║   ██║██║   ██║   ██║   ██║██║   ██║██║  ██║    ██╔══██╗██║     ██║   ██║██║   ██║
 ╚██████╔╝██║   ██║   ╚██████╔╝╚██████╔╝██████╔╝    ██████╔╝███████╗╚██████╔╝╚██████╔╝
  ╚═════╝ ╚═╝   ╚═╝    ╚═════╝  ╚═════╝ ╚═════╝     ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝ 
`}
          </pre>

          <div className="mb-2">
            <span className="text-terminal-green">user@terminal</span>
            <span className="text-terminal-white">:</span>
            <span className="text-terminal-cyan">~</span>
            <span className="text-terminal-white">$ </span>
            <span className="text-terminal-yellow">cat welcome.txt</span>
          </div>

          <div className="mb-4 pl-4 text-terminal-white">
            <p>╔═══════════════════════════════════════════════════════════════╗</p>
            <p>║  Welcome to my stupid website                                 ║</p>
            <p>║  System Status: <span className="text-terminal-green">ONLINE</span>                                       ║</p>
            <p>║  Security Level: <span className="text-terminal-cyan">GITGUD</span>                                     ║</p>
            <p>╚═══════════════════════════════════════════════════════════════╝</p>
          </div>

          <div className="mb-2">
            <span className="text-terminal-green">user@terminal</span>
            <span className="text-terminal-white">:</span>
            <span className="text-terminal-cyan">~</span>
            <span className="text-terminal-white">$ </span>
            <span className="text-terminal-yellow">ls -la {currentDir}</span>
          </div>

          <div className="mb-4 pl-4">
            {!showDocuments && !showGames ? (
              <>
                <p className="text-terminal-cyan">
                  drwxr-xr-x 2 user user 4096 Oct 13 2025{" "}
                  <span 
                    className="text-terminal-magenta cursor-pointer hover:underline"
                    onClick={() => handleFolderClick("documents")}
                  >
                    documents
                  </span>
                </p>
                <p className="text-terminal-cyan">
                  drwxr-xr-x 2 user user 4096 Oct 13 2025{" "}
                  <span 
                    className="text-terminal-magenta cursor-pointer hover:underline"
                    onClick={() => handleFolderClick("games")}
                  >
                    games
                  </span>
                </p>
              </>
            ) : showDocuments ? (
              <>
                <p className="text-terminal-white">-rw-r--r-- 1 user user 1024 Oct 13 2025{" "}
                  <a 
                    href="https://github.com/yourusername" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-terminal-cyan hover:underline"
                  >
                    Github
                  </a>
                </p>
                <p className="text-terminal-white">-rw-r--r-- 1 user user 1024 Oct 13 2025{" "}
                  <a 
                    href="https://linkedin.com/in/yourusername" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-terminal-cyan hover:underline"
                  >
                    Linkedin
                  </a>
                </p>
              </>
            ) : showGames ? (
              <>
                <p className="text-terminal-white">-rwxr-xr-x 1 user user 2048 Oct 13 2025{" "}
                  <span 
                    className="text-terminal-green cursor-pointer hover:underline"
                    onClick={() => handleGameClick("do-nothing")}
                  >
                    do-nothing
                  </span>
                </p>
              </>
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
                    <span 
                      className="text-terminal-yellow cursor-pointer hover:underline"
                      onClick={() => handleFolderClick("documents")}
                    >
                      cd ..
                    </span>
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
                    <span 
                      className="text-terminal-yellow cursor-pointer hover:underline"
                      onClick={() => handleFolderClick("games")}
                    >
                      cd ..
                    </span>
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

              <div className="mb-4 pl-4">
                <pre className="text-terminal-magenta">
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