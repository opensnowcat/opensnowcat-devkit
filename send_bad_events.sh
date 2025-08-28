#!/usr/bin/env bash
# send_bad_events.sh
# Usage: send_bad_events.sh <N_EVENTS> <COLLECTOR> [CONCURRENCY]
# Example: ./send_bad_events.sh 100 https://aa27003dcf40.ngrok-free.app 10

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <N_EVENTS> <COLLECTOR_HOST_OR_URL> [CONCURRENCY]"
  exit 1
fi

N_EVENTS="$1"
COLLECTOR_RAW="$2"
CONCURRENCY="${3:-}"

# Normalize collector: allow host, host:port, or full https://...
if [[ "$COLLECTOR_RAW" == http*://* ]]; then
  COLLECTOR_URL="$COLLECTOR_RAW"
else
  COLLECTOR_URL="https://${COLLECTOR_RAW}"
fi

ENDPOINT="${COLLECTOR_URL%/}/com.snowplowanalytics.snowplow/tp2"

# Concurrency default: min(N_EVENTS, 20)
if [[ -z "${CONCURRENCY}" ]]; then
  if (( N_EVENTS < 20 )); then
    CONCURRENCY="$N_EVENTS"
  else
    CONCURRENCY=20
  fi
fi
(( CONCURRENCY > 0 )) || { echo "CONCURRENCY must be > 0"; exit 1; }

# Dependencies
command -v curl >/dev/null 2>&1 || { echo "curl not found"; exit 1; }
command -v uuidgen >/dev/null 2>&1 || { echo "uuidgen not found"; exit 1; }

# Session-scoped identifiers (stay constant across events in this run)
SID="$(uuidgen)"
DUID="$(uuidgen)"
VID="$(( (RANDOM % 20) + 1 ))"   # 1..20

# Function that sends a single event.
send_one() {
  # ms without GNU date (macOS-safe): seconds*1000 + pseudo-millis
  local now_ms=$(( $(date +%s) * 1000 + (RANDOM % 1000) ))
  local eid
  eid="$(uuidgen)"

  # Optional tiny jitter to avoid thundering herd
  usleep=$(( (RANDOM % 400) * 1000 ))  # 0..400ms
  /bin/sleep 0.$(( usleep / 1000 )) 2>/dev/null || true

  # Build JSON inline; bash expands variables safely inside double quotes.
  # NOTE: If you want to vary fields per event, tweak below.
  read -r -d '' PAYLOAD <<JSON
{
  "schema": "iglu:com.snowplowanalytics.snowplow/non_existent/jsonschema/1-0-4",
  "data": [
    {
      "e":   "pv",
      "url": "https://www.snowcatcloud.com/",
      "page":"SnowcatCloud: Hosted Snowplow Analytics",
      "tv":  "js-2.14.0",
      "tna": "cf",
      "aid": "snowcat",
      "p":   "web",
      "tz":  "America/Los_Angeles",
      "lang":"en-US",
      "cs":  "UTF-8",
      "f_pdf":"1",
      "f_qt":"0",
      "f_realp":"0",
      "f_wma":"0",
      "f_dir":"0",
      "f_fla":"0",
      "f_java":"0",
      "f_gears":"0",
      "f_ag":"0",
      "res":"1920x1200",
      "cd":"24",
      "cookie":"1",
      "eid":"${eid}",
      "dtm":"${now_ms}",
      "vp":"1920x484",
      "ds":"1920x6277",
      "vid":"${VID}",
      "sid":"${SID}",
      "duid":"${DUID}",
      "stm":"${now_ms}"
    }
  ]
}
JSON

  # Send
  http_code="$(curl -sS -o /dev/null -w "%{http_code}" \
    --location "${ENDPOINT}" \
    --header 'Content-Type: application/json' \
    --data "${PAYLOAD}")"

  if [[ "${http_code}" == "200" || "${http_code}" == "204" ]]; then
    printf '.'          # success marker (no newline)
  else
    printf 'x' >&2      # failure marker to stderr
    return 1
  fi

}


export -f send_one
export ENDPOINT SID DUID VID

# Kick off N events with limited parallelism using xargs -P
# Note: On macOS, BSD xargs supports -P.
printf '%s\n\n' $(seq 1 "${N_EVENTS}") | xargs -I {} -P "${CONCURRENCY}" bash -c 'send_one'

echo "\n\nDone: sent ${N_EVENTS} events to ${ENDPOINT} with concurrency=${CONCURRENCY}"

