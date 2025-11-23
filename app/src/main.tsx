import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { logger } from "./lib/logger.ts";

const requiredEnv = [
  "VITE_RADIO_API_BASE_URL",
  "VITE_TERMINAL_API_BASE_URL",
  "VITE_RADIO_DEFAULT_LIMIT",
];

for (const key of requiredEnv) {
  const value = (import.meta.env as Record<string, string | undefined>)[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    const message = `Missing required env: ${key}`;
    logger.error("config.env_missing", { key });
    throw new Error(message);
  }
}

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      logger.error("service-worker.registration_failed", { error });
    });
  });
}
