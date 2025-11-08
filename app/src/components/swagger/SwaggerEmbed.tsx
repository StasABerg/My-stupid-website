import clsx from "clsx";
import { useEffect, useRef } from "react";

type SwaggerBundle = {
  (config: Record<string, unknown>): { destroy?: () => void };
  presets: {
    apis?: unknown;
  };
};

declare global {
  interface Window {
    SwaggerUIBundle?: SwaggerBundle;
    SwaggerUIStandalonePreset?: unknown;
  }
}

const SWAGGER_CSS_URL = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css";
const SWAGGER_BUNDLE_URL = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js";
const SWAGGER_PRESET_URL = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js";

let cssPromise: Promise<void> | null = null;
let bundlePromise: Promise<void> | null = null;
let presetPromise: Promise<void> | null = null;

function loadStylesheet(href: string) {
  if (document.querySelector(`link[data-swagger-ui="${href}"]`)) {
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute("data-swagger-ui", href);
  document.head.appendChild(link);
}

function loadScript(src: string) {
  if (document.querySelector(`script[data-swagger-ui="${src}"]`)) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    script.setAttribute("data-swagger-ui", src);
    document.body.appendChild(script);
  });
}

function ensureAssets() {
  if (!cssPromise) {
    cssPromise = Promise.resolve().then(() => loadStylesheet(SWAGGER_CSS_URL));
  }
  if (!bundlePromise) {
    bundlePromise = loadScript(SWAGGER_BUNDLE_URL);
  }
  if (!presetPromise) {
    presetPromise = loadScript(SWAGGER_PRESET_URL);
  }
  return Promise.all([cssPromise, bundlePromise, presetPromise]);
}

type SwaggerEmbedProps = {
  specUrl: string;
  className?: string;
};

const SwaggerEmbed = ({ specUrl, className }: SwaggerEmbedProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let destroyed = false;
    let ui: { destroy?: () => void } | null = null;

    async function bootstrap() {
      await ensureAssets();
      if (!window.SwaggerUIBundle || !containerRef.current || destroyed) {
        return;
      }

      ui = window.SwaggerUIBundle({
        domNode: containerRef.current,
        url: specUrl,
        deepLinking: false,
        docExpansion: "list",
        layout: "StandaloneLayout",
        presets: window.SwaggerUIStandalonePreset
          ? [window.SwaggerUIBundle.presets.apis, window.SwaggerUIStandalonePreset]
          : undefined,
      });
    }

    bootstrap().catch((error) => {
      console.error("swagger-ui.embed_failed", error);
    });

    return () => {
      destroyed = true;
      if (ui?.destroy) {
        ui.destroy();
      }
    };
  }, [specUrl]);

  return <div ref={containerRef} className={clsx("swagger-ui w-full", className)} />;
};

export default SwaggerEmbed;
