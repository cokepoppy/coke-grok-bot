#!/usr/bin/env bash
set -euo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
CONTEXT="k3d-tp1121-sandbox-dev"
NS="coke-grok-bot"
OLD_IMAGE="coke-grok-auth:candidate-signin-handoff-fix-2655b22-20261115"
NEW_IMAGE="coke-grok-auth:candidate-runtime-stability-b8c4b61-20261115"
EXPECTED_ID="$(cat "$R/image-id.txt")"
[[ "$(kubectl config current-context)" == "$CONTEXT" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$OLD_IMAGE" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.status.readyReplicas}')" == "1" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-desktop-broker -o jsonpath='{.status.readyReplicas}')" == "1" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-desktop-broker -o jsonpath='{.spec.template.spec.containers[?(@.name=="broker")].image}')" == "coke-grok-desktop-broker:candidate-skill-library-20261115-r2" ]]
[[ "$(docker image inspect "$NEW_IMAGE" --format '{{.Id}}')" == "$EXPECTED_ID" ]]
[[ "$(docker image inspect "$NEW_IMAGE" --format '{{.Os}}/{{.Architecture}}')" == "linux/arm64" ]]
