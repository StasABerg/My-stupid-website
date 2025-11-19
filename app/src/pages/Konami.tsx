import { useEffect } from "react";
import { Link } from "react-router-dom";

const videoUrl = "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&controls=0&modestbranding=1";

const Konami = () => {
  useEffect(() => {
    document.title = "Konami Override";
  }, []);

  return (
    <div className="min-h-screen bg-black text-terminal-green flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-3xl border border-terminal-green/60 bg-black/80 p-6 shadow-[0_0_40px_rgba(0,255,132,0.35)]">
        <header className="font-mono text-terminal-yellow text-xl mb-4">/dev/konami/override</header>
        <p className="font-mono text-sm text-terminal-cyan mb-4">
          Access granted. Loading clandestine transmission…
        </p>
        <div className="relative w-full pt-[56.25%] border border-terminal-green/50">
          <iframe
            title="Konami Transmission"
            src={videoUrl}
            className="absolute left-0 top-0 h-full w-full"
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
        </div>
        <p className="mt-4 font-mono text-xs text-terminal-white/70">
          Transmission locked in faux-terminal safe mode. Remember: trust no browser tabs.
        </p>
        <div className="mt-6 text-right">
          <Link
            to="/"
            className="font-mono text-xs uppercase tracking-[0.2em] text-terminal-cyan hover:text-terminal-yellow"
          >
            Abort Mission
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Konami;

