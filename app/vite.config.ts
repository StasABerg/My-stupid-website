import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import esbuild from "esbuild";
import { Buffer } from "node:buffer";

const manifestEntry = path.resolve(__dirname, "src/pwa/manifest.ts");
const pwaAssetsDir = path.resolve(__dirname, "src/assets/pwa");
// Keep vendor chunk splitting stable as we migrate to Rolldown's advanced chunking.
const chunkMatchers: Array<{ test: (value: string) => boolean; name: string }> = [
  { test: (value) => value.includes("react-dom") || value.includes("scheduler"), name: "react-dom" },
  { test: (value) => value.includes("/react/") || /react\/index\.js$/.test(value), name: "react" },
  { test: (value) => value.includes("react-router"), name: "router" },
  { test: (value) => value.includes("@tanstack/react-query"), name: "tanstack" },
  { test: (value) => value.includes("@radix-ui"), name: "radix" },
  { test: (value) => value.includes("lucide-react"), name: "icons" },
  { test: (value) => value.includes("sonner"), name: "sonner" },
  { test: (value) => value.includes("cmdk"), name: "command" },
  { test: (value) => value.includes("react-hook-form") || value.includes("@hookform"), name: "react-hook-form" },
  { test: (value) => value.includes("react-day-picker"), name: "react-day-picker" },
  { test: (value) => value.includes("date-fns"), name: "date-fns" },
  { test: (value) => value.includes("zod"), name: "zod" },
  { test: (value) => value.includes("hls.js"), name: "hls" },
  { test: (value) => value.includes("swagger-ui"), name: "swagger" },
  { test: (value) => value.includes("embla-carousel"), name: "carousel" },
  { test: (value) => value.includes("recharts"), name: "recharts" },
];
const deriveVendorChunkName = (id: string): string => {
  const normalizedId = id.replace(/\\/g, "/");
  const segments = normalizedId.split("/node_modules/")[1]?.split("/") ?? [];
  if (!segments.length) {
    return "vendor";
  }

  const [scopeOrName, maybeName] = segments;
  const packageName = scopeOrName?.startsWith("@") ? `${scopeOrName}/${maybeName ?? ""}` : scopeOrName;

  if (!packageName) {
    return "vendor";
  }

  return packageName.replace(/[@/]/g, "-");
};
const advancedChunkGroups = chunkMatchers.map((matcher, index, arr) => ({
  name: matcher.name,
  priority: arr.length - index + 1,
  test: (moduleId: string) => moduleId.includes("node_modules") && matcher.test(moduleId),
}));
advancedChunkGroups.push({
  name: (moduleId: string) => deriveVendorChunkName(moduleId),
  priority: 1,
  test: (moduleId: string) => moduleId.includes("node_modules"),
});

type ManifestBuild = {
  json: string;
  assets: Array<{ fileName: string; source: Uint8Array }>;
};

const buildManifest = async (): Promise<ManifestBuild> => {
  const result = await esbuild.build({
    entryPoints: [manifestEntry],
    bundle: true,
    format: "cjs",
    metafile: false,
    write: false,
    target: ["es2022"],
    platform: "node",
    loader: {
      ".png": "file",
      ".webp": "file",
    },
    assetNames: "icons/[name]-[hash]",
    publicPath: "/",
    outdir: "dist",
  });

  const jsChunk = result.outputFiles.find((file) => file.path.endsWith(".js"));
  if (!jsChunk) {
    throw new Error("Failed to build manifest: missing JS chunk");
  }

  type ManifestDefinition = typeof import("./src/pwa/manifest").default;
  type ManifestModule = { exports: ManifestDefinition | { default: ManifestDefinition } };

  const manifestModule: ManifestModule = { exports: { default: {} as ManifestDefinition } };
  const fn = new Function("module", "exports", jsChunk.text) as (
    module: ManifestModule,
    exports: ManifestModule["exports"],
  ) => void;
  fn(manifestModule, manifestModule.exports);
  const manifestCandidate = manifestModule.exports;
  const manifestObject =
    ((manifestCandidate as { default?: ManifestDefinition }).default ?? manifestCandidate) as ManifestDefinition;

  const manifestJson = JSON.stringify(manifestObject, null, 2);

  const assets = result.outputFiles
    .filter((file) => !file.path.endsWith(".js"))
    .map((file) => {
      const segments = file.path.split("dist/");
      const fileName = segments.length > 1 ? segments[1] : path.basename(file.path);
      return { fileName, source: file.contents };
    });

  return { json: manifestJson, assets };
};

const manifestPlugin = () => {
  let cached: ManifestBuild | null = null;

  const ensureManifest = async () => {
    cached = await buildManifest();
    return cached;
  };

  return {
    name: "gitgud-manifest",
    buildStart() {
      this.addWatchFile(manifestEntry);
      this.addWatchFile(pwaAssetsDir);
    },
    configureServer(server) {
      const rebuild = async () => {
        await ensureManifest();
        server.ws.send({ type: "full-reload" });
      };

      server.watcher.add([manifestEntry, pwaAssetsDir]);
      server.watcher.on("change", (file) => {
        const normalized = path.resolve(file);
        if (normalized === manifestEntry || normalized.startsWith(pwaAssetsDir)) {
          rebuild();
        }
      });

      server.middlewares.use(async (req, res, next) => {
        if (!cached) {
          await ensureManifest();
        }

        if (req.url === "/manifest.webmanifest") {
          res.setHeader("Content-Type", "application/manifest+json");
          res.end(cached!.json);
          return;
        }

        const matched = cached!.assets.find((asset) => req.url === `/${asset.fileName}`);
        if (matched) {
          res.setHeader("Content-Type", "image/png");
          res.end(Buffer.from(matched.source));
          return;
        }

        next();
      });
    },
    async generateBundle() {
      const manifest = await ensureManifest();
      manifest.assets.forEach((asset) => {
        this.emitFile({ type: "asset", fileName: asset.fileName, source: asset.source });
      });
      this.emitFile({
        type: "asset",
        fileName: "manifest.webmanifest",
        source: manifest.json,
      });
    },
  };
};

const stripModulePreload = () => ({
  name: "strip-modulepreload",
  enforce: "post" as const,
  transformIndexHtml(html: string) {
    return html.replace(/<link rel="modulepreload"[^>]+>\s*/g, "");
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "/",
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), manifestPlugin(), stripModulePreload(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      { find: "react/jsx-runtime", replacement: "preact/jsx-runtime" },
      { find: "react/jsx-dev-runtime", replacement: "preact/jsx-dev-runtime" },
      { find: "react-dom/test-utils", replacement: "preact/test-utils" },
      { find: "react-dom/client", replacement: "preact/compat/client" },
      { find: "react-dom", replacement: "preact/compat" },
      { find: "react", replacement: path.resolve(__dirname, "./src/preact-compat-shim") },
      { find: "react-router-dom", replacement: path.resolve(__dirname, "./src/lite-router") },
    ],
  },
  build: {
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: advancedChunkGroups,
        },
      },
    },
  },
}));
