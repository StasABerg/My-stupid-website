[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FStasABerg%2FMy-stupid-website.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2FStasABerg%2FMy-stupid-website?ref=badge_shield)

# My Stupid Website

A small devops playground I built for fun to keep my hands in both infra and app code. It’s a mono-repo with a Dioxus (Rust) frontend and a few services behind Helm and Docker so I can experiment with builds, routing, and deployment patterns.

## What’s inside
- Frontend (`dioxus-app/`): Dioxus app (Rust) .
- Legacy frontend (`app/`): Vite + React 19 + Tailwind.
- API gateway (`api-gateway-service/`): Rust proxy that fronts the SPA and fans out to backends.
- FMD service (`fmd/`): Rust fetch→extract→HTML→Markdown service for the Tools page (proxied via the gateway).
- Radio service (`radio-service-rs/`): Rust Radio service built on Radio Browser API.
- Terminal service (`terminal-service/`): Node sandbox shell with an allowlisted command set.
- Helm charts (`charts/`) and Dockerfiles (`docker/`) for each piece.

## Quick start
- Build images (local or CI) from `docker/` for the SPA, gateway, radio, and terminal services.
- Apply secrets/config for Postgres/Redis and service env vars (see chart values).
- Lint charts: `helm lint charts/<chart>`
- Deploy with Helm per service (charts in `charts/`), wiring Gateway API hostnames/paths as needed.
- Verify pods/routes, then hit the SPA through the gateway; docs live at `/swagger`, `/gateway/docs`, `/radio/docs`, `/terminal/docs`.

## How to use web-to-markdown via CURL

The Web → Markdown tool is exposed via the gateway at `POST /api/fmd/v1/fetch-md`. It requires a gateway session cookie plus CSRF headers.

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE="https://gitgud.zip"
COOKIE_JAR="/tmp/gw.cookies"
SESSION_JSON="/tmp/gw.session.json"

# 1) Create a session (stores cookie, returns CSRF tokens)
curl -fsS -c "$COOKIE_JAR" -X POST "$BASE/api/session" > "$SESSION_JSON"

# 2) Extract CSRF fields
CSRF_TOKEN=$(sed -n 's/.*"csrfToken":"\\([^"]*\\)".*/\\1/p' "$SESSION_JSON" | head -n1)
CSRF_PROOF=$(sed -n 's/.*"csrfProof":"\\([^"]*\\)".*/\\1/p' "$SESSION_JSON" | head -n1)

# 3) Fetch markdown
curl -fsS -b "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -H "x-gateway-csrf: $CSRF_TOKEN" \
  -H "x-gateway-csrf-proof: $CSRF_PROOF" \
  -d '{"url":"https://example.com/"}' \
  "$BASE/api/fmd/v1/fetch-md" > page.md
```

## Why
- I like building my own toys when I’m bored, so this is where I tinker without any production pressure.
- It lets me try random ideas just because I can.


## License
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FStasABerg%2FMy-stupid-website.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2FStasABerg%2FMy-stupid-website?ref=badge_large)
