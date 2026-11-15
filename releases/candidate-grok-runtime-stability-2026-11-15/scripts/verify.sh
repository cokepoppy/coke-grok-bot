#!/usr/bin/env bash
set -euo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
CONTEXT="k3d-tp1121-sandbox-dev"
NS="coke-grok-bot"
NEW_IMAGE="coke-grok-auth:candidate-runtime-stability-b8c4b61-20261115"
[[ "$(kubectl config current-context)" == "$CONTEXT" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$NEW_IMAGE" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.status.availableReplicas}')" == "1" ]]
[[ "$(docker image inspect "$NEW_IMAGE" --format '{{.Id}}')" == "$(cat "$R/image-id.txt")" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get pods -l app=coke-grok-auth -o jsonpath='{.items[0].status.containerStatuses[0].imageID}')" == "$(cat "$R/image-config-id.txt")" ]]
"$R/scripts/snapshot-runtime.sh" "$R/operations/verify"
grep '^coke-grok-desktop-broker|' "$R/operations/verify.control" > "$R/operations/verify.broker"
cmp "$R/operations/pre-deploy.broker" "$R/operations/verify.broker"
cmp "$R/operations/pre-deploy.computers" "$R/operations/verify.computers"
cmp "$R/operations/pre-deploy.database-identities" "$R/operations/verify.database-identities"
