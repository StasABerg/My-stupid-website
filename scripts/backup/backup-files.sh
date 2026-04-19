#!/usr/bin/env bash
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/services}"
WEBSITE_DIR="${WEBSITE_DIR:-/opt/my-stupid-website}"
BACKUP_DIR="${BACKUP_DIR:-${COMPOSE_DIR}/backups}"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-${COMPOSE_DIR}/.env}"
LOG_TAG="[backup-files]"

if [[ ! -f "${BACKUP_ENV_FILE}" ]]; then
  echo "${LOG_TAG} missing env file: ${BACKUP_ENV_FILE}" >&2
  exit 1
fi

source "${BACKUP_ENV_FILE}"

: "${B2_ACCOUNT_ID:?B2_ACCOUNT_ID is required}"
: "${B2_ACCOUNT_KEY:?B2_ACCOUNT_KEY is required}"
: "${B2_BUCKET:?B2_BUCKET is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"

export B2_ACCOUNT_ID
export B2_ACCOUNT_KEY
export RESTIC_REPOSITORY="b2:${B2_BUCKET}:server"
export RESTIC_PASSWORD

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_TAG} $*"
}

ensure_repo() {
  if ! restic cat config >/dev/null 2>&1; then
    log "initializing restic repository ${RESTIC_REPOSITORY}"
    restic init
  fi
}

build_sources() {
  local sources=()

  for path in \
    "${COMPOSE_DIR}/forgejo/data" \
    "${COMPOSE_DIR}/vaultwarden/data" \
    "${COMPOSE_DIR}/kuma/data" \
    "${COMPOSE_DIR}/immich/library" \
    "${COMPOSE_DIR}/docker-compose.yml" \
    "${WEBSITE_DIR}/.env.production" \
    "${WEBSITE_DIR}/docker-compose.website.yml" \
    "/etc/caddy/Caddyfile" \
    "/etc/caddy/env"; do
    if [[ -e "${path}" ]]; then
      sources+=("${path}")
    fi
  done

  printf '%s\n' "${sources[@]}"
}

main() {
  mkdir -p "${BACKUP_DIR}"

  log "backup started"
  ensure_repo

  mapfile -t sources < <(build_sources)
  if [[ "${#sources[@]}" -eq 0 ]]; then
    log "no backup sources found"
    exit 1
  fi

  log "backing up ${#sources[@]} paths"
  restic backup "${sources[@]}" --tag automated-files

  log "running retention/prune"
  restic forget --keep-daily 7 --prune

  log "latest snapshots"
  restic snapshots --latest 5
  log "backup finished"
}

main "$@"
