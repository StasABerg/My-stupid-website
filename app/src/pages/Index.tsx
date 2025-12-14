import { useMemo } from "react";
import { Link } from "react-router-dom";
import { TerminalWindow, TerminalHeader, TerminalPrompt, TerminalCursor } from "@/components/SecureTerminal";
import { formatDate, formatLsDate } from "@/lib/date-format";
import { getLatestPost } from "@/content/posts";

const Index = () => {
  const todayLabel = useMemo(() => formatLsDate(new Date()), []);
  const latestPost = useMemo(() => getLatestPost(), []);

  return (
    <div className="h-screen bg-black">
      <TerminalWindow>
        <TerminalHeader displayCwd="~" />
        
        <div className="p-3 sm:p-6 font-mono text-xs sm:text-sm overflow-y-auto flex-1">
          {/* desktop logo */}
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
        
          {/* mobile logo */}
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
          <TerminalPrompt command="cat welcome.txt" />

          <div className="mb-4 font-mono text-terminal-white leading-none">
            <p>╔═══════════════════════════════════════════╗</p>
            <p>║ Welcome to my stupid website              ║</p>
            <p>║ System Status: <span className="text-terminal-green">ONLINE</span>                     ║</p>
            <p>║ Security Level: <span className="text-terminal-cyan">GITGUD</span>                    ║</p>
            <p>╚═══════════════════════════════════════════╝</p>
          </div>

          <TerminalPrompt command="ls -la /home/user" />

          <div className="mb-4 pl-2 sm:pl-4 overflow-x-auto">
            <nav aria-label="Main directories" role="navigation">
              <p className="text-terminal-cyan whitespace-nowrap">
                <span className="hidden sm:inline">drwxr-xr-x 2 user user 4096 {todayLabel} </span>
                <Link 
                  to="/documents"
                  className="text-terminal-magenta hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
                  aria-label="Open documents folder"
                >
                  documents/
                </Link>
              </p>
              <p className="text-terminal-cyan whitespace-nowrap">
                <span className="hidden sm:inline">drwxr-xr-x 2 user user 4096 {todayLabel} </span>
                <Link
                  to="/games"
                  className="text-terminal-magenta hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
                  aria-label="Open games folder"
                >
                  games/
                </Link>
              </p>
              <p className="text-terminal-cyan whitespace-nowrap">
                <span className="hidden sm:inline">drwxr-xr-x 2 user user 4096 {todayLabel} </span>
                <Link
                  to="/radio"
                  className="text-terminal-magenta hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
                  aria-label="Tune into the Gitgud radio"
                >
                  radio/
                </Link>
              </p>
              <p className="text-terminal-cyan whitespace-nowrap">
                <span className="hidden sm:inline">drwxr-xr-x 2 user user 4096 {todayLabel} </span>
                <Link
                  to="/blog"
                  className="text-terminal-magenta hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
                  aria-label="Read the latest blog entries"
                >
                  blog/
                </Link>
              </p>
              <p className="text-terminal-cyan whitespace-nowrap">
                <span className="hidden sm:inline">drwxr-xr-x 2 user user 4096 {todayLabel} </span>
                <Link
                  to="/motivation"
                  className="text-terminal-magenta hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
                  aria-label="Open motivation utilities"
                >
                  motivation?/
                </Link>
              </p>
              <p className="text-terminal-cyan whitespace-nowrap">
                <span className="hidden sm:inline">drwxr-xr-x 2 user user 4096 {todayLabel} </span>
                <Link
                  to="/terminal"
                  className="text-terminal-magenta hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
                  aria-label="Open restricted SSH sandbox"
                >
                  ssh-sandbox/
                </Link>
              </p>
              <p className="text-terminal-cyan whitespace-nowrap">
                <span className="hidden sm:inline">drwxr-xr-x 2 user user 4096 {todayLabel} </span>
                <Link
                  to="/swagger"
                  className="text-terminal-magenta hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
                  aria-label="Browse API documentation"
                >
                  swagger/
                </Link>
              </p>
              <p className="text-terminal-cyan whitespace-nowrap">
                <span className="hidden sm:inline">drwxr-xr-x 2 user user 4096 {todayLabel} </span>
                <Link
                  to="/how-to"
                  className="text-terminal-magenta hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
                  aria-label="Open automated how-to searches"
                >
                  how-to/
                </Link>
              </p>
              <p className="text-terminal-cyan whitespace-nowrap">
                <span className="hidden sm:inline">drwxr----- 2 root root 1337 {todayLabel} </span>
                <Link
                  to="/konami"
                  className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
                  aria-label="Open secret transmission"
                >
                  .secrets/
                </Link>
              </p>
            </nav>
          </div>

          {latestPost ? (
            <>
              <TerminalPrompt command="tail -n 5 blog/latest.log" />
              <div className="mb-4">
                <p className="text-terminal-yellow text-[0.7rem] sm:text-xs uppercase tracking-[0.2em]">
                  Latest entry — {formatDate(latestPost.metadata.date)}
                </p>
                <Link
                  to={`/blog/${latestPost.metadata.slug}`}
                  className="block mt-1 text-lg sm:text-xl text-terminal-green hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-green"
                >
                  {latestPost.metadata.title}
                </Link>
                <p className="mt-1 text-terminal-green/75 leading-relaxed">{latestPost.metadata.excerpt}</p>
                <div className="mt-3 flex items-center gap-3 text-terminal-magenta text-xs">
                  <Link
                    to="/blog"
                    className="hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
                  >
                    ls blog
                  </Link>
                  <Link
                    to={`/blog/${latestPost.metadata.slug}`}
                    className="hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-magenta"
                  >
                    cat {latestPost.metadata.slug}
                  </Link>
                </div>
              </div>
            </>
          ) : null}

          <TerminalPrompt command="fastfetch" />

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

          <TerminalPrompt>
            <TerminalCursor />
          </TerminalPrompt>
        </div>
      </TerminalWindow>
    </div>
  );
};

export default Index;
