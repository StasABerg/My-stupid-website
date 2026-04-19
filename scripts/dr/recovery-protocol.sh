#!/usr/bin/env bash
set -euo pipefail

cat <<'EOF'
Disaster recovery protocol (Docker Compose + Backblaze B2)

1) Provision host
   - Install Docker + Compose + Caddy
   - Restore /opt/services/.env from secure secret storage

2) Restore stateful files
   - CONFIRM_RESTORE=YES scripts/backup/restore-files.sh

3) Start infra
   - docker compose -f /opt/services/docker-compose.yml up -d postgres valkey

4) Restore databases
   - CONFIRM_RESTORE=YES scripts/backup/restore-db.sh

5) Start service stacks
   - docker compose -f /opt/services/docker-compose.yml up -d
   - cd /opt/my-stupid-website && cp .env.production .env && echo "IMAGE_TAG=v0.1.0" >> .env
   - docker compose -p website-dev -f docker-compose.website.yml --env-file .env up -d
   - docker compose -p website-prod -f docker-compose.website.yml --env-file .env up -d

6) Reload edge
   - systemctl reload caddy

7) Verify
   - scripts/dr/check-backups.sh
   - scripts/dr/verify-stack.sh

8) Record drill report
   - Save command outputs and recovery timing for RTO/RPO tracking
EOF
