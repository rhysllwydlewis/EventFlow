#!/usr/bin/env bash

set -euo pipefail

# CI-only helper; this does not change production rendering or public page layout.
PORT="${PORT:-3000}"
BASE_URL="http://127.0.0.1:${PORT}"

node scripts/serve-static.js &
server_pid=$!

cleanup() {
  kill "${server_pid}" 2>/dev/null || true
  wait "${server_pid}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

ready=false
for _attempt in $(seq 1 120); do
  if curl --fail --silent --show-error --output /dev/null "${BASE_URL}/"; then
    ready=true
    break
  fi
  sleep 0.25
done

if [[ "${ready}" != "true" ]]; then
  echo "Lighthouse server did not become ready" >&2
  exit 1
fi

# Warm each audited route once so Lighthouse measures page performance rather
# than the one-off cost of the static test server's first request.
for route in \
  / \
  /marketplace \
  /pricing \
  /suppliers \
  /guides \
  /articles/wedding-venue-selection-guide; do
  curl --fail --silent --show-error --output /dev/null "${BASE_URL}${route}"
done

echo "Lighthouse server warmed"
wait "${server_pid}"