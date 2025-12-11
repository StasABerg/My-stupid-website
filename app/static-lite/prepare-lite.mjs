import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url);
const distDir = path.resolve(root.pathname, "dist");
const appDir = path.join(distDir, "app");
const liteSource = path.resolve(root.pathname, "static-lite", "index.html");
const liteTarget = path.join(distDir, "index.html");

const copyIfExists = (filename) => {
  const source = path.resolve(root.pathname, "public", filename);
  const target = path.join(distDir, filename);
  if (!fs.existsSync(source)) return;
  fs.copyFileSync(source, target);
};

if (!fs.existsSync(appDir)) {
  throw new Error('Expected SPA build at "dist/app". Run `npm run build:app` first.');
}

fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(liteSource, liteTarget);
copyIfExists("favicon.ico");
copyIfExists("apple-touch-icon.png");
copyIfExists("manifest.webmanifest");

console.log("Lite shell copied to dist/index.html");
