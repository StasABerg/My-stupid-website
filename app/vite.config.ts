import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import esbuild from "esbuild";
import { Buffer } from "node:buffer";

const manifestEntry = path.resolve(__dirname, "src/pwa/manifest.ts");
const pwaAssetsDir = path.resolve(__dirname, "src/assets/pwa");

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
    },
    assetNames: "icons/[name]-[hash]",
    publicPath: "/",
    outdir: "dist",
  });

  const jsChunk = result.outputFiles.find((file) => file.path.endsWith(".js"));
  if (!jsChunk) {
    throw new Error("Failed to build manifest: missing JS chunk");
  }

  const module = { exports: {} as any };
  const fn = new Function("module", "exports", jsChunk.text);
  fn(module, module.exports);
  const manifestObject = module.exports.default ?? module.exports;

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

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "/",
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), manifestPlugin(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          const matchers: Array<{ test: (value: string) => boolean; name: string }> = [
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

          const normalizedId = id.replace(/\\/g, "/");

          for (const matcher of matchers) {
            if (matcher.test(id)) {
              return matcher.name;
            }
          }

          const segments = normalizedId.split("/node_modules/")[1]?.split("/") ?? [];
          if (!segments.length) {
            return "vendor";
          }

          const [scopeOrName, maybeName] = segments;
          const packageName = scopeOrName?.startsWith("@")
            ? `${scopeOrName}/${maybeName ?? ""}`
            : scopeOrName;

          if (!packageName) {
            return "vendor";
          }

          return packageName.replace(/[@/]/g, "-");
        },
      },
    },
  },
}));
