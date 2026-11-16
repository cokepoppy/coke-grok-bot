#!/usr/bin/env bash
set -euo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
CONTEXT="k3d-tp1121-sandbox-dev"
CLUSTER="tp1121-sandbox-dev"
NS="coke-grok-bot"
NEW_IMAGE="coke-grok-auth:candidate-poll-loop-isolation-20261115"
OPS="$R/operations"
"$R/scripts/preflight.sh"
(cd "$R" && shasum -a 256 -c SHA256SUMS)
mkdir -p "$OPS"
"$R/scripts/snapshot-runtime.sh" "$OPS/pre-deploy"
k3d image import "$NEW_IMAGE" --cluster "$CLUSTER"
kubectl --context "$CONTEXT" -n "$NS" set image deployment/coke-grok-auth "auth=$NEW_IMAGE"
kubectl --context "$CONTEXT" -n "$NS" rollout status deployment/coke-grok-auth --timeout=240s
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$NEW_IMAGE" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.status.availableReplicas}')" == "1" ]]
"$R/scripts/snapshot-runtime.sh" "$OPS/post-deploy"
grep '^coke-grok-desktop-broker|' "$OPS/pre-deploy.control" > "$OPS/pre-deploy.broker"
grep '^coke-grok-desktop-broker|' "$OPS/post-deploy.control" > "$OPS/post-deploy.broker"
cmp "$OPS/pre-deploy.broker" "$OPS/post-deploy.broker"
cmp "$OPS/pre-deploy.computers" "$OPS/post-deploy.computers"
cmp "$OPS/pre-deploy.database-identities" "$OPS/post-deploy.database-identities"
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$OPS/deployed-at.txt"
