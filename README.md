[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FStasABerg%2FMy-stupid-website.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2FStasABerg%2FMy-stupid-website?ref=badge_shield)

# My Stupid Website

A small devops playground I built for fun to keep my hands in both infra and app code. It’s a mono-repo with a Vite/React frontend and a few services behind Helm and Docker so I can experiment with builds, routing, and deployment patterns.

## What’s inside
- Frontend (`app/`): Vite + React 19 + Tailwind.
- API gateway (`api-gateway-service/`): Rust proxy that fronts the SPA and fans out to backends.
- Radio service (`radio-service-rs/`): Rust Radio service built on Radio Browser API.
- Terminal service (`terminal-service/`): Node sandbox shell with an allowlisted command set.
- Helm charts (`charts/`) and Dockerfiles (`docker/`) for each piece.

## Quick start
- Build images (local or CI) from `docker/` for the SPA, gateway, radio, and terminal services.
- Apply secrets/config for Postgres/Redis and service env vars (see chart values).
- Lint charts: `helm lint charts/<chart>`
- Deploy with Helm per service (charts in `charts/`), wiring Gateway API hostnames/paths as needed.
- Verify pods/routes, then hit the SPA through the gateway; docs live at `/swagger`, `/gateway/docs`, `/radio/docs`, `/terminal/docs`.

## Why
- I like building my own toys when I’m bored, so this is where I tinker without any production pressure.
- It lets me try random ideas just because I can.


## License
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FStasABerg%2FMy-stupid-website.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2FStasABerg%2FMy-stupid-website?ref=badge_large)