#!/usr/bin/env bash
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/services}"
BACKUP_DIR="${BACKUP_DIR:-${COMPOSE_DIR}/backups/db}"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-${COMPOSE_DIR}/.env}"
PG_CONTAINER="${PG_CONTAINER:-services-postgres-1}"
BACKUP_DATABASES="${BACKUP_DATABASES:-forgejo immich appdb appdb_dev}"
LOG_TAG="[backup-db]"

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

ensure_repo() {
  if ! restic cat config >/dev/null 2>&1; then
    log "initializing restic repository ${RESTIC_REPOSITORY}"
    restic init
  fi
}

dump_db() {
  local db_name="$1"
  local out_file="${BACKUP_DIR}/${db_name}.sql.gz"

  if ! docker inspect "${PG_CONTAINER}" >/dev/null 2>&1; then
    log "postgres container not found: ${PG_CONTAINER}"
    return 1
  fi

  if ! docker exec "${PG_CONTAINER}" psql -U appuser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}'" | grep -q 1; then
    log "database ${db_name} missing; skipping"
    return 0
  fi

  log "dumping ${db_name}"
  if docker exec "${PG_CONTAINER}" pg_dump -U appuser -d "${db_name}" | gzip >"${out_file}"; then
    log "dump complete ${db_name} ($(du -sh "${out_file}" | cut -f1))"
    return 0
  fi

  log "dump failed ${db_name}"
  return 1
}

main() {
  local dump_failed=0

  mkdir -p "${BACKUP_DIR}"
  log "db backup started"

  for db_name in ${BACKUP_DATABASES}; do
    if ! dump_db "${db_name}"; then
      dump_failed=1
    fi
  done

  if [[ "${dump_failed}" -ne 0 ]]; then
    log "one or more dumps failed"
    exit 1
  fi

  ensure_repo
  log "running restic backup"
  restic backup "${BACKUP_DIR}" --tag automated-db

  log "running retention/prune"
  restic forget --keep-daily 7 --prune

  log "latest snapshots"
  restic snapshots --latest 5
  log "db backup finished"
}

main "$@"
