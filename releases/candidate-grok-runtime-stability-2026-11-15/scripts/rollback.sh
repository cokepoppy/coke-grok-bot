#!/usr/bin/env bash
set -euo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
CONTEXT="k3d-tp1121-sandbox-dev"
CLUSTER="tp1121-sandbox-dev"
NS="coke-grok-bot"
OPS="$R/operations"
OLD_IMAGE="coke-grok-auth:candidate-signin-handoff-fix-2655b22-20261115"
NEW_IMAGE="coke-grok-auth:candidate-runtime-stability-b8c4b61-20261115"
[[ "$(kubectl config current-context)" == "$CONTEXT" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$NEW_IMAGE" ]]
[[ "$(docker image inspect "$OLD_IMAGE" --format '{{.Os}}/{{.Architecture}}')" == "linux/arm64" ]]
"$R/scripts/snapshot-runtime.sh" "$OPS/pre-rollback"
grep '^coke-grok-desktop-broker|' "$OPS/pre-rollback.control" > "$OPS/pre-rollback.broker"
k3d image import "$OLD_IMAGE" --cluster "$CLUSTER"
kubectl --context "$CONTEXT" -n "$NS" set image deployment/coke-grok-auth "auth=$OLD_IMAGE"
kubectl --context "$CONTEXT" -n "$NS" rollout status deployment/coke-grok-auth --timeout=240s
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$OLD_IMAGE" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.status.readyReplicas}')" == "1" ]]
"$R/scripts/snapshot-runtime.sh" "$OPS/post-rollback"
grep '^coke-grok-desktop-broker|' "$OPS/post-rollback.control" > "$OPS/post-rollback.broker"
cmp "$OPS/pre-rollback.broker" "$OPS/post-rollback.broker"
cmp "$OPS/pre-rollback.computers" "$OPS/post-rollback.computers"
cmp "$OPS/pre-rollback.database-identities" "$OPS/post-rollback.database-identities"
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$OPS/rolled-back-at.txt"
