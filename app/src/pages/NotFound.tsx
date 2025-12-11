import { useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { logger } from "../lib/logger";

const accessDeniedGifs = [
  "/easter-eggs/access-denied-1.gif",
  "/easter-eggs/access-denied-2.gif",
];

const NotFound = () => {
  const location = useLocation();
  const [showModal, setShowModal] = useState(() => Math.random() < 0.5);
  const [gifSrc] = useState(() => accessDeniedGifs[Math.floor(Math.random() * accessDeniedGifs.length)]);

  useEffect(() => {
    logger.error("route.not_found_visit", { path: location.pathname });
  }, [location.pathname]);

  return (
    <div className="relative min-h-screen bg-black text-terminal-green flex items-center justify-center p-6">
      <div
        className={`text-center z-10 border border-terminal-green/40 bg-black/80 p-8 max-w-lg w-full shadow-[0_0_40px_rgba(0,255,0,0.25)] transition ${
          showModal ? "opacity-40 blur-sm pointer-events-none" : ""
        }`}
        aria-hidden={showModal}
      >
        <p className="font-mono text-terminal-cyan text-xs uppercase tracking-[0.3em] mb-4">404 // ACCESS LOST</p>
        <h1 className="text-terminal-yellow text-3xl font-mono mb-2">Directory not found</h1>
        <p className="font-mono text-sm text-terminal-white/70 mb-6">The file system refuses your request.</p>
        <a href="/" className="font-mono text-terminal-cyan underline">
          Return to Home
        </a>
      </div>
      {showModal && (
        <div className="absolute inset-0 z-20 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#030b0a] border border-terminal-red/60 p-6 text-center text-terminal-green shadow-[0_0_60px_rgba(255,0,0,0.4)] space-y-4">
            <p className="font-mono text-sm">Access denied. Security is reviewing this incident.</p>
            <div className="border border-terminal-green/40 bg-black/60">
              <img
                src={gifSrc}
                alt="Access denied meme"
                className="w-full max-h-[50vh] object-contain"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="font-mono text-xs uppercase tracking-[0.3em] text-terminal-yellow border border-terminal-yellow/40 px-4 py-2 hover:bg-terminal-yellow/10"
            >
              I Understand
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotFound;
