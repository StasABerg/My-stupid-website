import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const GitGud = () => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    document.title = "Git Gud Sequence";
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((value) => {
        const next = value + Math.random() * 8;
        if (next > 98) {
          return 42;
        }
        return next;
      });
    }, 800);
    return () => clearInterval(interval);
  }, []);

  const widthClass = useMemo(() => `w-pct-${clampPercent(progress)}`, [progress]);

  return (
    <div className="min-h-screen bg-black text-terminal-green flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl border border-terminal-green/50 bg-[#050505] p-8 space-y-6 shadow-[0_0_45px_rgba(0,255,132,0.3)]">
        <header className="font-mono text-xl text-terminal-yellow tracking-[0.2em]">/git/gud</header>
        <p className="font-mono text-sm text-terminal-cyan">
          Initiating 8-bit montage. Please stand by while we dramatically fail to hit 100%.
        </p>
        <div className="w-full bg-terminal-green/10 h-6 border border-terminal-green/50 relative overflow-hidden">
          <div className={`h-full bg-terminal-green transition-all duration-700 ${widthClass}`} />
          <span className="absolute inset-0 flex items-center justify-center font-mono text-xs text-black/80">
            {progress.toFixed(1)}%
          </span>
        </div>
        <p className="font-mono text-xs text-terminal-white/70">
          Completion is a myth. Keep leveling up.
        </p>
        <div className="flex justify-between text-xs font-mono">
          <Link to="/begud" className="text-terminal-cyan hover:text-terminal-yellow">
            Need more training?
          </Link>
          <Link to="/" className="text-terminal-cyan hover:text-terminal-yellow">
            Return to ops
          </Link>
        </div>
      </div>
    </div>
  );
};

export default GitGud;
