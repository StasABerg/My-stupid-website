#!/usr/bin/env bash
set -euo pipefail

PROD_URL="${PROD_URL:-https://gitgud.zip}"
DEV_URL="${DEV_URL:-https://dev.gitgud.zip}"
PROD_LOCAL_URL="${PROD_LOCAL_URL:-http://localhost:8080}"
DEV_LOCAL_URL="${DEV_LOCAL_URL:-http://localhost:8091}"
LOG_TAG="[dr-verify]"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_TAG} $*"
}

check_http() {
  local url="$1"
  local expected="$2"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' "${url}" || true)
  if [[ "${code}" != "${expected}" ]]; then
    log "failed ${url} expected ${expected} got ${code}"
    return 1
  fi
  log "ok ${url} -> ${code}"
}

main() {
  local fail=0

  check_http "${PROD_LOCAL_URL}/" "200" || fail=1
  check_http "${DEV_LOCAL_URL}/" "200" || fail=1
  check_http "${PROD_URL}/" "200" || fail=1

  local dev_code
  dev_code=$(curl -sS -o /dev/null -w '%{http_code}' "${DEV_URL}/" || true)
  if [[ "${dev_code}" != "200" && "${dev_code}" != "302" ]]; then
    log "failed ${DEV_URL}/ expected 200 or 302 got ${dev_code}"
    fail=1
  else
    log "ok ${DEV_URL}/ -> ${dev_code}"
  fi

  check_http "${PROD_LOCAL_URL}/api/radio/health" "200" || fail=1
  check_http "${DEV_LOCAL_URL}/api/radio/health" "200" || fail=1

  if [[ "${fail}" -ne 0 ]]; then
    log "stack verification failed"
    exit 1
  fi
  log "stack verification passed"
}

main "$@"
