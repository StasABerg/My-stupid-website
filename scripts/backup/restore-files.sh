#!/usr/bin/env bash
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/services}"
WEBSITE_DIR="${WEBSITE_DIR:-/opt/my-stupid-website}"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-${COMPOSE_DIR}/.env}"
SNAPSHOT="${SNAPSHOT:-latest}"
LOG_TAG="[restore-files]"

if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "${LOG_TAG} set CONFIRM_RESTORE=YES to run" >&2
  exit 1
fi

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

restore_target() {
  local target="$1"
  local include="$2"

  mkdir -p "${target}"
  log "restoring ${include} -> ${target}"
  restic restore "${SNAPSHOT}" --target / --include "${include}"
}

main() {
  restore_target "${COMPOSE_DIR}/forgejo" "${COMPOSE_DIR}/forgejo/data"
  restore_target "${COMPOSE_DIR}/vaultwarden" "${COMPOSE_DIR}/vaultwarden/data"
  restore_target "${COMPOSE_DIR}/kuma" "${COMPOSE_DIR}/kuma/data"
  restore_target "${COMPOSE_DIR}/immich" "${COMPOSE_DIR}/immich/library"
  restore_target "/etc/caddy" "/etc/caddy/Caddyfile"
  restore_target "/etc/caddy" "/etc/caddy/env"
  restore_target "${WEBSITE_DIR}" "${WEBSITE_DIR}/.env.production"
  log "restore completed"
}

main "$@"
