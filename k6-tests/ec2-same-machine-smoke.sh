#!/usr/bin/env bash
set -euo pipefail

# Smoke validation helper for running on the SAME EC2 as the API.
# Not for real capacity numbers — only to confirm wiring works.

if [[ ! -d "$(pwd)/k6-tests" ]]; then
  echo "Run this from the server/ directory." >&2
  exit 2
fi

: "${BASE_URL:=http://127.0.0.1:5001}"
: "${K6_PROFILE:=smoke}"

if ! command -v k6 >/dev/null 2>&1; then
  echo "k6 not found. Install k6 first." >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node not found. Install Node 18+ first." >&2
  exit 2
fi

echo "[selftest] BASE_URL=${BASE_URL}"
echo "[selftest] K6_PROFILE=${K6_PROFILE}"

echo "[selftest] Checking API health..."
if command -v curl >/dev/null 2>&1; then
  curl -fsS "${BASE_URL}/health" >/dev/null || true
  curl -fsS "${BASE_URL}/api/ping" >/dev/null
else
  echo "curl not installed; skipping /api/ping check" >&2
fi

echo "[selftest] Dry-run runner (no load)"
export K6_DRY_RUN=1
node k6-tests/run-cognito-protected-2k.js

echo "[selftest] Running smoke load test"
unset K6_DRY_RUN
node k6-tests/run-cognito-protected-2k.js

echo "[selftest] Done"
