import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";

const Konami = () => {
  useEffect(() => {
    document.title = "Konami Override";
  }, []);

  const embedUrl = useMemo(() => {
    const base = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://gitgud.qzz.io";
    const params = new URLSearchParams({
      autoplay: "1",
      loop: "1",
      playlist: "dQw4w9WgXcQ",
      controls: "0",
      modestbranding: "1",
      rel: "0",
      origin,
      playsinline: "1",
      mute: "0",
    });
    return `${base}?${params.toString()}`;
  }, []);

  return (
    <div className="min-h-screen bg-black text-terminal-green flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-3xl border border-terminal-green/60 bg-black/80 p-6 shadow-[0_0_40px_rgba(0,255,132,0.35)]">
        <header className="font-mono text-terminal-yellow text-xl mb-4">/dev/konami/override</header>
        <p className="font-mono text-sm text-terminal-cyan mb-4">
          Access granted. Loading clandestine transmission…
        </p>
        <div className="relative w-full pt-[56.25%] border border-terminal-green/50 bg-black">
          <iframe
            title="Konami Transmission"
            src={embedUrl}
            className="absolute left-0 top-0 h-full w-full"
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
        <p className="mt-4 font-mono text-xs text-terminal-white/70">
          Transmission locked in faux-terminal safe mode. Stream starts muted on mobile—tap the player to unmute. If the player refuses to
          cooperate,{" "}
          <a
            href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL4fGSI1pDJn63Ntl9x_AcwIJ7bB8uW7VY&index=1"
            target="_blank"
            rel="noopener noreferrer"
            className="text-terminal-cyan underline"
          >
            watch it directly on YouTube
          </a>
          .
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
