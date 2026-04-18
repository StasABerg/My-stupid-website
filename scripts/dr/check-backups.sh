#!/usr/bin/env bash
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/services}"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-${COMPOSE_DIR}/.env}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-30}"
LOG_TAG="[dr-check]"

if [[ ! -f "${BACKUP_ENV_FILE}" ]]; then
  echo "${LOG_TAG} missing env file: ${BACKUP_ENV_FILE}" >&2
  exit 1
fi

source "${BACKUP_ENV_FILE}"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_TAG} $*"
}

latest_snapshot_time() {
  local account_id="$1"
  local account_key="$2"
  local repository="$3"

  B2_ACCOUNT_ID="${account_id}" B2_ACCOUNT_KEY="${account_key}" RESTIC_REPOSITORY="${repository}" RESTIC_PASSWORD="$4" \
    restic snapshots --latest 1 --json | python3 - <<'PY'
import json, sys
data = json.load(sys.stdin)
snaps = data if isinstance(data, list) else data.get("snapshots", [])
if not snaps:
    print("")
    sys.exit(0)
print(snaps[0]["time"])
PY
}

hours_since() {
  local iso_time="$1"
  python3 - "${iso_time}" <<'PY'
from datetime import datetime, timezone
import sys
ts = sys.argv[1]
if not ts:
    print(10**9)
    raise SystemExit(0)
dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
now = datetime.now(timezone.utc)
delta = now - dt
print(int(delta.total_seconds() // 3600))
PY
}

main() {
  : "${B2_ACCOUNT_ID:?B2_ACCOUNT_ID is required}"
  : "${B2_ACCOUNT_KEY:?B2_ACCOUNT_KEY is required}"
  : "${B2_BUCKET:?B2_BUCKET is required}"
  : "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"
  : "${B2_DB_ACCOUNT_ID:?B2_DB_ACCOUNT_ID is required}"
  : "${B2_DB_ACCOUNT_KEY:?B2_DB_ACCOUNT_KEY is required}"
  : "${B2_DB_BUCKET:?B2_DB_BUCKET is required}"
  : "${RESTIC_DB_PASSWORD:?RESTIC_DB_PASSWORD is required}"

  local file_repo="b2:${B2_BUCKET}:server"
  local db_repo="b2:${B2_DB_BUCKET}:db"

  local file_time db_time file_age db_age
  file_time=$(latest_snapshot_time "${B2_ACCOUNT_ID}" "${B2_ACCOUNT_KEY}" "${file_repo}" "${RESTIC_PASSWORD}")
  db_time=$(latest_snapshot_time "${B2_DB_ACCOUNT_ID}" "${B2_DB_ACCOUNT_KEY}" "${db_repo}" "${RESTIC_DB_PASSWORD}")
  file_age=$(hours_since "${file_time}")
  db_age=$(hours_since "${db_time}")

  log "file snapshot time: ${file_time:-none} (${file_age}h ago)"
  log "db snapshot time:   ${db_time:-none} (${db_age}h ago)"

  if (( file_age > MAX_AGE_HOURS )); then
    log "file backup is too old"
    exit 1
  fi
  if (( db_age > MAX_AGE_HOURS )); then
    log "db backup is too old"
    exit 1
  fi

  log "backup health check passed"
}

main "$@"
