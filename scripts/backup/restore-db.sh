#!/usr/bin/env bash
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/services}"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-${COMPOSE_DIR}/.env}"
RESTORE_DIR="${RESTORE_DIR:-${COMPOSE_DIR}/backups/restore-db}"
PG_CONTAINER="${PG_CONTAINER:-services-postgres-1}"
RESTORE_DATABASES="${RESTORE_DATABASES:-forgejo immich appdb appdb_dev}"
SNAPSHOT="${SNAPSHOT:-latest}"
LOG_TAG="[restore-db]"

if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "${LOG_TAG} set CONFIRM_RESTORE=YES to run" >&2
  exit 1
fi

if [[ ! -f "${BACKUP_ENV_FILE}" ]]; then
  echo "${LOG_TAG} missing env file: ${BACKUP_ENV_FILE}" >&2
  exit 1
fi

source "${BACKUP_ENV_FILE}"

: "${B2_DB_ACCOUNT_ID:?B2_DB_ACCOUNT_ID is required}"
: "${B2_DB_ACCOUNT_KEY:?B2_DB_ACCOUNT_KEY is required}"
: "${B2_DB_BUCKET:?B2_DB_BUCKET is required}"
: "${RESTIC_DB_PASSWORD:?RESTIC_DB_PASSWORD is required}"

export B2_ACCOUNT_ID="${B2_DB_ACCOUNT_ID}"
export B2_ACCOUNT_KEY="${B2_DB_ACCOUNT_KEY}"
export RESTIC_REPOSITORY="b2:${B2_DB_BUCKET}:db"
export RESTIC_PASSWORD="${RESTIC_DB_PASSWORD}"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_TAG} $*"
}

restore_dump_file() {
  local db_name="$1"
  local dump_file="${RESTORE_DIR}/db/${db_name}.sql.gz"

  if [[ ! -f "${dump_file}" ]]; then
    log "missing dump file for ${db_name}: ${dump_file}; skipping"
    return 0
  fi

  log "restoring ${db_name}"
  docker exec "${PG_CONTAINER}" psql -U appuser -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${db_name}' AND pid <> pg_backend_pid();" >/dev/null || true
  docker exec "${PG_CONTAINER}" psql -U appuser -d postgres -c "DROP DATABASE IF EXISTS \"${db_name}\";" >/dev/null
  docker exec "${PG_CONTAINER}" psql -U appuser -d postgres -c "CREATE DATABASE \"${db_name}\";" >/dev/null
  gunzip -c "${dump_file}" | docker exec -i "${PG_CONTAINER}" psql -U appuser -d "${db_name}" >/dev/null
  log "restored ${db_name}"
}

main() {
  if ! docker inspect "${PG_CONTAINER}" >/dev/null 2>&1; then
    log "postgres container not found: ${PG_CONTAINER}"
    exit 1
  fi

  rm -rf "${RESTORE_DIR}"
  mkdir -p "${RESTORE_DIR}"

  log "restoring snapshot ${SNAPSHOT} into ${RESTORE_DIR}"
  restic restore "${SNAPSHOT}" --target "${RESTORE_DIR}"

  for db_name in ${RESTORE_DATABASES}; do
    restore_dump_file "${db_name}"
  done

  log "restore completed"
}

main "$@"
