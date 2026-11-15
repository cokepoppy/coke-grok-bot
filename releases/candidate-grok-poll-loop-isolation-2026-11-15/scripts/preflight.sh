#!/usr/bin/env bash
set -euo pipefail
CONTEXT="k3d-tp1121-sandbox-dev"
NS="coke-grok-bot"
OLD_IMAGE="coke-grok-auth:candidate-library-files-20261115-r2"
NEW_IMAGE="coke-grok-auth:candidate-poll-loop-isolation-20261115"
[[ "$(kubectl config current-context)" == "$CONTEXT" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$OLD_IMAGE" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.status.readyReplicas}')" == "1" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-desktop-broker -o jsonpath='{.status.readyReplicas}')" == "1" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-desktop-broker -o jsonpath='{.spec.template.spec.containers[?(@.name=="broker")].image}')" == "coke-grok-desktop-broker:candidate-skill-library-20261115-r2" ]]
[[ "$(docker image inspect "$NEW_IMAGE" --format '{{.Os}}/{{.Architecture}}')" == "linux/arm64" ]]
[[ "$(docker image inspect "$NEW_IMAGE" --format '{{.Id}}')" == "sha256:93c66b975d779cdfbf26fbe2a6cb55272ec74b412df8d4e735547b368ab2f566" ]]
