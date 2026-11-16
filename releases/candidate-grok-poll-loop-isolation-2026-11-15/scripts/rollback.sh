#!/usr/bin/env bash
set -euo pipefail
CONTEXT="k3d-tp1121-sandbox-dev"
CLUSTER="tp1121-sandbox-dev"
NS="coke-grok-bot"
OLD_IMAGE="coke-grok-auth:candidate-library-files-20261115-r2"
NEW_IMAGE="coke-grok-auth:candidate-poll-loop-isolation-20261115"
[[ "$(kubectl config current-context)" == "$CONTEXT" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$NEW_IMAGE" ]]
docker image inspect "$OLD_IMAGE" >/dev/null
k3d image import "$OLD_IMAGE" --cluster "$CLUSTER"
kubectl --context "$CONTEXT" -n "$NS" set image deployment/coke-grok-auth "auth=$OLD_IMAGE"
kubectl --context "$CONTEXT" -n "$NS" rollout status deployment/coke-grok-auth --timeout=240s
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.status.availableReplicas}')" == "1" ]]
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$(cd "$(dirname "$0")/.." && pwd)/operations/rolled-back-at.txt"
