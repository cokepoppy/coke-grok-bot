#!/usr/bin/env bash
set -euo pipefail

APP_NS="coke-grok-bot"
CLUSTER="tp1121-sandbox-dev"
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="$(jq -er '.source.commit' "$RELEASE_DIR/manifest.json")"
AUTH_NEW="coke-grok-auth:sha-$COMMIT"
changed=0
rollback_on_failure(){
  rc=$?
  if [[ "$rc" -ne 0 && "$changed" -eq 1 ]]; then
    printf 'Auth rollout failed; restoring the exact previous Auth image.\n' >&2
    "$RELEASE_DIR/scripts/rollback.sh" || true
  fi
  exit "$rc"
}

"$RELEASE_DIR/scripts/preflight.sh"
k3d image import --cluster "$CLUSTER" "$AUTH_NEW"
trap rollback_on_failure EXIT
changed=1
kubectl -n "$APP_NS" set image deployment/coke-grok-auth "auth=$AUTH_NEW"
kubectl -n "$APP_NS" rollout status deployment/coke-grok-auth --timeout=180s
changed=0
trap - EXIT
"$RELEASE_DIR/scripts/verify.sh"
