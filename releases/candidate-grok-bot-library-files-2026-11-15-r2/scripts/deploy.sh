#!/usr/bin/env bash
set -euo pipefail
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTEXT="k3d-tp1121-sandbox-dev"
CLUSTER="tp1121-sandbox-dev"
NS="coke-grok-bot"
OLD_IMAGE="coke-grok-auth:candidate-library-files-20261115-r1"
NEW_IMAGE="coke-grok-auth:candidate-library-files-20261115-r2"
OPS="$RELEASE_DIR/operations"

[[ "${COKE_GROK_PUBLIC_IDLE:-}" == 1 ]] || { echo 'Verify the signed-in public UI has no active Bot task first.' >&2; exit 2; }
[[ "$(kubectl config current-context)" == "$CONTEXT" ]]
(cd "$RELEASE_DIR" && shasum -a 256 -c SHA256SUMS)
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deploy coke-grok-auth -o jsonpath='{.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$OLD_IMAGE" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deploy coke-grok-auth -o jsonpath='{.spec.replicas}:{.status.readyReplicas}')" == "1:1" ]]
[[ "$(docker image inspect "$NEW_IMAGE" --format '{{.Os}}/{{.Architecture}}')" == "linux/arm64" ]]
docker image inspect "$OLD_IMAGE" >/dev/null

mkdir -p "$OPS"
kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o yaml > "$OPS/auth-before.yaml"
kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-desktop-broker -o jsonpath='{.spec.template.spec.containers[?(@.name=="broker")].image}' > "$OPS/broker-image-before.txt"
kubectl --context "$CONTEXT" -n "$NS" get cm auth-runtime-config -o jsonpath='{.data.COKE_GROK_AGENT_IMAGE}' > "$OPS/agent-image-before.txt"
k3d image import "$NEW_IMAGE" --cluster "$CLUSTER"
kubectl --context "$CONTEXT" -n "$NS" set image deployment/coke-grok-auth "auth=$NEW_IMAGE"
kubectl --context "$CONTEXT" -n "$NS" rollout status deployment/coke-grok-auth --timeout=240s
kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o yaml > "$OPS/auth-after.yaml"
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$OPS/deployed-at.txt"
"$RELEASE_DIR/scripts/verify.sh"
echo 'Only the existing Auth deployment was updated.'
