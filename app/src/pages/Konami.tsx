import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { TerminalWindow, TerminalHeader, TerminalPrompt } from "@/components/SecureTerminal";

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
    <div className="h-screen bg-black">
      <TerminalWindow>
        <TerminalHeader displayCwd="~/secrets/konami" />
        <div className="p-4 sm:p-6 font-mono text-xs sm:text-sm text-terminal-white flex-1 space-y-4">
          <TerminalPrompt command="cat transmission.log" />
          <p className="text-terminal-cyan">Access granted. Loading clandestine transmission…</p>
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
          <p className="text-terminal-white/70">
            Transmission locked in faux-terminal safe mode. Mobile browsers may require a tap before sound kicks in. If the player refuses
            to cooperate,{" "}
            <a
              href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL4fGSI1pDJn63Ntl9x_AcwIJ7bB8uW7VY&index=1"
              target="_blank"
              rel="noopener noreferrer"
              className="text-terminal-yellow underline"
            >
              watch it directly on YouTube
            </a>
            .
          </p>
          <TerminalPrompt command={<Link to="/">cd ~</Link>} />
        </div>
      </TerminalWindow>
    </div>
  );
};

export default Konami;
