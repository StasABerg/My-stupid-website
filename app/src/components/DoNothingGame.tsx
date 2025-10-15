import { useState, useEffect, useRef } from "react";

interface DoNothingGameProps {
  onBack: () => void;
}

const DoNothingGame = ({ onBack }: DoNothingGameProps) => {
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [bestTime, setBestTime] = useState(0);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    const handleMovement = () => {
      if (isRunning) {
        setIsRunning(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        if (elapsedTime > bestTime) {
          setBestTime(elapsedTime);
        }
      }
    };

    if (isRunning) {
      window.addEventListener("mousemove", handleMovement);
      window.addEventListener("touchmove", handleMovement);
      intervalRef.current = window.setInterval(() => {
        setElapsedTime((prev) => prev + 0.01);
      }, 10);
    }

    return () => {
      window.removeEventListener("mousemove", handleMovement);
      window.removeEventListener("touchmove", handleMovement);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning, elapsedTime, bestTime]);

  const handleStart = () => {
    setElapsedTime(0);
    setIsRunning(true);
  };

  const formatTime = (time: number) => {
    return time.toFixed(2);
  };

  return (
    <div className="space-y-4" role="application" aria-label="Do Nothing Game">
      <div className="mb-4">
        <span className="text-terminal-green">user@terminal</span>
        <span className="text-terminal-white">:</span>
        <span className="text-terminal-cyan">~/games/do-nothing</span>
        <span className="text-terminal-white">$ </span>
        <span className="text-terminal-yellow">./start.sh</span>
      </div>

      <div className="border-2 border-terminal-green p-3 sm:p-4 text-terminal-white">
        <pre className="text-terminal-cyan mb-4 overflow-x-auto text-[0.6rem] sm:text-xs">
{`╔══════════════════════════════════════╗
║    DO NOTHING GAME v1.0              ║
║  Rules: Don't move anything!         ║
╚══════════════════════════════════════╝`}
        </pre>

        <div className="space-y-2 mb-4" role="status" aria-live="polite">
          <p className="text-terminal-yellow">
            Status: <span className={isRunning ? "text-terminal-green" : "text-terminal-red"}>
              {isRunning ? "RUNNING" : "STOPPED"}
            </span>
          </p>
          <p className="text-terminal-cyan">
            Time: <span aria-label={`${formatTime(elapsedTime)} seconds`}>{formatTime(elapsedTime)}s</span>
          </p>
          <p className="text-terminal-magenta">
            Best: <span aria-label={`Best time ${formatTime(bestTime)} seconds`}>{formatTime(bestTime)}s</span>
          </p>
        </div>

        {!isRunning && (
          <button
            onClick={handleStart}
            onKeyDown={(e) => e.key === "Enter" && handleStart()}
            className="border border-terminal-green bg-transparent text-terminal-green px-3 sm:px-4 py-2 hover:bg-terminal-green hover:text-black transition-colors focus:outline-none focus:ring-2 focus:ring-terminal-green text-xs sm:text-sm"
            aria-label={elapsedTime > 0 ? "Restart game" : "Start game"}
          >
            {elapsedTime > 0 ? "RESTART" : "START"}
          </button>
        )}
      </div>

      <div className="mb-2">
        <span className="text-terminal-green">user@terminal</span>
        <span className="text-terminal-white">:</span>
        <span className="text-terminal-cyan">~/games/do-nothing</span>
        <span className="text-terminal-white">$ </span>
      </div>
    </div>
  );
};

export default DoNothingGame;
