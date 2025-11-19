import { useLocation } from "react-router-dom";
import { useEffect, useState } from "react";

const accessDeniedGifs = [
  "/easter-eggs/access-denied-1.gif",
  "/easter-eggs/access-denied-2.gif",
];

const NotFound = () => {
  const location = useLocation();
  const [showModal, setShowModal] = useState(() => Math.random() < 0.5);
  const [gifSrc] = useState(() => accessDeniedGifs[Math.floor(Math.random() * accessDeniedGifs.length)]);

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 relative">
      <div className="text-center z-10">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-gray-600">Oops! Page not found</p>
        <a href="/" className="text-blue-500 underline hover:text-blue-700">
          Return to Home
        </a>
      </div>
      {showModal && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-sm w-full bg-black border border-terminal-red/60 p-4 text-center text-terminal-green shadow-lg">
            <p className="font-mono text-sm mb-3">Access denied. Security is reviewing this incident.</p>
            <img src={gifSrc} alt="Access denied meme" className="mx-auto border border-terminal-green/40" />
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="mt-4 font-mono text-xs uppercase tracking-[0.3em] text-terminal-yellow"
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
