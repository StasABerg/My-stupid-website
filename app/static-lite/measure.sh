#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -d dist ]]; then
  echo "dist/ not found. Run npm run build first." >&2
  exit 1
fi

node - <<'NODE'
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const assetsDir = "dist/app/assets";
const pick = (prefix, suffix) => {
  if (!fs.existsSync(assetsDir)) return null;
  return fs.readdirSync(assetsDir).find((f) => f.startsWith(prefix) && (!suffix || f.endsWith(suffix)));
};

const candidates = [
  "dist/index.html",
  "dist/app/index.html",
  pick("index-", ".js") && path.join(assetsDir, pick("index-", ".js")),
  pick("index-", ".css") && path.join(assetsDir, pick("index-", ".css")),
  pick("react-dom-") && path.join(assetsDir, pick("react-dom-")),
];

const fmt = (n) => (n / 1024).toFixed(1) + " KB";

for (const f of candidates.filter(Boolean)) {
  if (!fs.existsSync(f)) continue;
  const buf = fs.readFileSync(f);
  const br = zlib.brotliCompressSync(buf);
  console.log(f.padEnd(48), "raw", fmt(buf.length).padStart(8), "br", fmt(br.length).padStart(8));
}
NODE
