import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const insults = [
  "Push harder. Git Gud.",
  "Logs don't read themselves.",
  "If kubectl apply failed, so did you.",
  "Backups are for cowards who plan ahead.",
  "Alerts are love letters from production. Answer them.",
  "Latency is just procrastination measured in ms.",
];

const Begud = () => {
  const [index, setIndex] = useState(0);
  const displayMessage = useMemo(() => insults[index % insults.length], [index]);

  useEffect(() => {
    document.title = "Be Gud Training";
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((value) => (value + 1) % insults.length);
    }, 2800);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-[#030b0a] to-black text-terminal-green flex items-center justify-center p-6">
      <div className="w-full max-w-3xl border border-terminal-green/50 bg-black/80 p-8 shadow-[0_0_50px_rgba(0,255,132,0.35)]">
        <header className="font-mono text-2xl text-terminal-yellow mb-6">/training/simulator</header>
        <div className="font-mono text-lg text-terminal-cyan min-h-[4rem] animate-pulse">{displayMessage}</div>
        <p className="mt-6 font-mono text-xs text-terminal-white/70">
          Status: recalibrating human firmware. Keep staring until self-improvement occurs.
        </p>
        <div className="mt-8 flex justify-end">
          <Link
            to="/"
            className="font-mono text-xs uppercase tracking-[0.25em] text-terminal-cyan border border-terminal-green/50 px-4 py-2 hover:bg-terminal-green/10 focus:outline-none focus:ring-1 focus:ring-terminal-yellow"
          >
            Return to Work
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Begud;

