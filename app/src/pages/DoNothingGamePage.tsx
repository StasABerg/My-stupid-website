import { Link } from "react-router-dom";
import DoNothingGame from "@/components/DoNothingGame";

const DoNothingGamePage = () => {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-2 sm:p-4">
      <div 
        className="w-full max-w-4xl bg-black border-2 border-terminal-green shadow-[0_0_30px_rgba(0,255,0,0.3)] rounded-none"
        role="main"
        aria-label="Do Nothing Game"
      >
        <div className="border-b-2 border-terminal-green p-2 bg-black">
          <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
            <span className="text-terminal-red" aria-hidden="true">●</span>
            <span className="text-terminal-yellow" aria-hidden="true">●</span>
            <span className="text-terminal-green" aria-hidden="true">●</span>
            <span className="text-terminal-cyan ml-2 sm:ml-4 truncate">terminal@gitgud.qzz.io:~/games/do-nothing</span>
          </div>
        </div>
        
        <div className="p-3 sm:p-6 font-mono text-xs sm:text-sm">
          <DoNothingGame onBack={() => {}} />
          
          <div className="mt-4">
            <span className="text-terminal-green">user@terminal</span>
            <span className="text-terminal-white">:</span>
            <span className="text-terminal-cyan">~/games/do-nothing</span>
            <span className="text-terminal-white">$ </span>
            <Link 
              to="/games"
              className="text-terminal-yellow hover:underline focus:outline-none focus:ring-2 focus:ring-terminal-yellow"
              aria-label="Go back to games directory"
            >
              cd ..
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DoNothingGamePage;