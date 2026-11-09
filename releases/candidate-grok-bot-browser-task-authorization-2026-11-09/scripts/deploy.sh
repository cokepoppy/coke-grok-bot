#!/usr/bin/env bash
set -euo pipefail

APP_NS="coke-grok-bot"
USER_NS="${COKE_GROK_USER_NAMESPACE:-grok-user-00213195e832242e4afea5b264424355}"
CLUSTER="tp1121-sandbox-dev"
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="$(jq -er '.source.commit' "$RELEASE_DIR/manifest.json")"
AUTH_NEW="coke-grok-auth:sha-$COMMIT"
AGENT_NEW="coke-grok-desktop:sha-$COMMIT"
DESKTOP_NEW="coke-grok-desktop:sha-$COMMIT"
export CANDIDATE_AUTH_IMAGE="$AUTH_NEW" CANDIDATE_AGENT_IMAGE="$AGENT_NEW" CANDIDATE_DESKTOP_IMAGE="$DESKTOP_NEW"

[[ "$USER_NS" == "grok-user-00213195e832242e4afea5b264424355" ]]
[[ "$(kubectl config current-context)" == "k3d-$CLUSTER" ]]
"$RELEASE_DIR/scripts/preflight.sh"
k3d image import --cluster "$CLUSTER" "$AUTH_NEW" "$AGENT_NEW" "$DESKTOP_NEW"

changed=0
rollback_on_failure(){
  rc=$?
  if [[ "$rc" -ne 0 && "$changed" -eq 1 ]]; then
    printf 'Candidate rollout failed; restoring the exact r3 Auth, Agent, Desktop, and Broker image pins.\n' >&2
    "$RELEASE_DIR/scripts/rollback.sh" || true
  fi
  exit "$rc"
}
trap rollback_on_failure EXIT

changed=1
kubectl -n "$APP_NS" set image deployment/coke-grok-auth "auth=$AUTH_NEW"
kubectl -n "$APP_NS" rollout status deployment/coke-grok-auth --timeout=180s
kubectl -n "$APP_NS" patch configmap auth-runtime-config --type merge -p "{\"data\":{\"COKE_GROK_AGENT_IMAGE\":\"$AGENT_NEW\",\"COKE_GROK_DESKTOP_IMAGE\":\"$DESKTOP_NEW\"}}"
kubectl -n "$APP_NS" rollout restart deployment/coke-grok-desktop-broker
kubectl -n "$APP_NS" rollout status deployment/coke-grok-desktop-broker --timeout=180s
kubectl -n "$USER_NS" set image deployment/agent "agent=$AGENT_NEW"
kubectl -n "$USER_NS" set image deployment/desktop "desktop=$DESKTOP_NEW"
kubectl -n "$USER_NS" rollout status deployment/agent --timeout=180s
kubectl -n "$USER_NS" rollout status deployment/desktop --timeout=240s

changed=0
trap - EXIT
"$RELEASE_DIR/scripts/verify.sh"
