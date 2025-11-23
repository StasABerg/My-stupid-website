import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { logger } from "./lib/logger.ts";

type EnvKey = "VITE_RADIO_API_BASE_URL" | "VITE_TERMINAL_API_BASE_URL" | "VITE_RADIO_DEFAULT_LIMIT";
const defaults: Record<EnvKey, string> = {
  VITE_RADIO_API_BASE_URL: "/api/radio",
  VITE_TERMINAL_API_BASE_URL: "/api/terminal",
  VITE_RADIO_DEFAULT_LIMIT: "200",
};

for (const key of Object.keys(defaults) as EnvKey[]) {
  const value = (import.meta.env as Record<string, string | undefined>)[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    logger.warn("config.env_missing", { key, appliedDefault: defaults[key] });
    (import.meta.env as Record<string, string | undefined>)[key] = defaults[key];
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
