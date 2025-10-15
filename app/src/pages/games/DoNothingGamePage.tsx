import { Link } from "react-router-dom";
import DoNothingGame from "@/components/DoNothingGame";

export default function DoNothingGamePage() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-2 sm:p-4 font-mono text-sm">
      <div className="w-full max-w-4xl border-2 border-terminal-green p-4">
        <div className="mb-2">
          <span className="text-terminal-green">user@terminal</span>
          <span className="text-terminal-white">:~/games/do-nothing$ </span>
          <Link to="/games" className="text-terminal-yellow hover:underline">cd ..</Link>
        </div>
        <DoNothingGame />
      </div>
    </div>
  );
}
