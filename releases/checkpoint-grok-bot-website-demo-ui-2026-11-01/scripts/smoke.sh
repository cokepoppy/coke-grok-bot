#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://codex.cokeagent.com/grok-bot}"
BASE_URL="${BASE_URL%/}"
curl --fail --silent --show-error --max-time 15 --output /dev/null \
  --write-out 'Auth readiness HTTP %{http_code}\n' \
  "$BASE_URL/api/auth/ready"
