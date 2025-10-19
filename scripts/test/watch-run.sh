#!/usr/bin/env bash
set -euo pipefail
TIMEOUT="${1:-30}" # seconds
BIND="${COURIER_BIND:-127.0.0.1}"
HTTP_PORT="${COURIER_HTTP_PORT:-8787}"
WS_PORT="${COURIER_WS_PORT:-8788}"
STAMP=$(date -u +%s)
BASE=/tmp/courier.watch.$STAMP
LOG=$BASE.log
PIDF=$BASE.pid

# Clean any existing listeners
for P in "$HTTP_PORT" "$WS_PORT"; do lsof -tiTCP:$P -sTCP:LISTEN | xargs -r kill || true; done

# Start server
(COURIER_BIND="$BIND" node --loader ts-node/esm src/index.ts >"$LOG" 2>&1 & echo $! > "$PIDF")
T0=$(date +%s)
READY=0
while :; do
  if grep -q "HTTP gateway on" "$LOG"; then READY=1; break; fi
  if [ $(( $(date +%s) - T0 )) -ge "$TIMEOUT" ]; then break; fi
  sleep 0.2
done
ELAPSED=$(( $(date +%s) - T0 ))

# Quick checks with short timeouts
HEALTH=""
STATS=""
SNAP=""
METRICS=""
if [ "$READY" -eq 1 ]; then
  HEALTH=$(timeout 3s curl -sS "http://$BIND:$HTTP_PORT/health" || true)
  timeout 2s node --loader ts-node/esm scripts/cli/enqueue.ts --to agents/Watch/inbox --type ping --id e-$STAMP --payload '{"ok":true}' >/dev/null 2>&1 || true
  STATS=$(timeout 2s curl -sS "http://$BIND:$HTTP_PORT/v1/stats?stream=agents/Watch/inbox" || true)
  METRICS=$(timeout 2s curl -sS "http://$BIND:$HTTP_PORT/v1/metrics" || true)
  SNAP=$(timeout 2s curl -sS "http://$BIND:$HTTP_PORT/v1/snapshot?view=latestPerAgent" || true)
fi

# Summary
printf 'READY:%s\n' "$READY"
printf 'ELAPSED:%ss\n' "$ELAPSED"
printf 'HEALTH:%s\n' "${HEALTH:0:200}"
printf 'STATS:%s\n' "${STATS:0:200}"
printf 'METRICS:%s\n' "${METRICS:0:200}"
printf 'SNAP:%s\n' "${SNAP:0:200}"
printf 'LOG:%s\n' "$LOG"

tail -n 40 "$LOG" || true

# Cleanup
if [ -f "$PIDF" ]; then kill "$(cat "$PIDF")" >/dev/null 2>&1 || true; rm -f "$PIDF"; fi
