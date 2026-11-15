#!/usr/bin/env bash
set -euo pipefail
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTEXT="k3d-tp1121-sandbox-dev"
CLUSTER="tp1121-sandbox-dev"
NS="coke-grok-bot"
OLD_IMAGE="coke-grok-auth:candidate-library-files-20261115-r1"
NEW_IMAGE="coke-grok-auth:candidate-library-files-20261115-r2"

[[ "${COKE_GROK_PUBLIC_IDLE:-}" == 1 ]] || { echo 'Verify the signed-in public UI has no active Bot task first.' >&2; exit 2; }
[[ "$(kubectl config current-context)" == "$CONTEXT" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$NEW_IMAGE" ]]
docker image inspect "$OLD_IMAGE" >/dev/null
k3d image import "$OLD_IMAGE" --cluster "$CLUSTER"
kubectl --context "$CONTEXT" -n "$NS" set image deployment/coke-grok-auth "auth=$OLD_IMAGE"
kubectl --context "$CONTEXT" -n "$NS" rollout status deployment/coke-grok-auth --timeout=240s
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$OLD_IMAGE" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.status.readyReplicas}')" == 1 ]]
kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o yaml > "$RELEASE_DIR/operations/auth-rollback.yaml"
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$RELEASE_DIR/operations/rolled-back-at.txt"
echo 'Previous Auth image restored; MySQL and computer workloads were untouched.'
