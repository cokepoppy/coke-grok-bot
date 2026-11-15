#!/usr/bin/env bash
set -euo pipefail
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTEXT="k3d-tp1121-sandbox-dev"
NS="coke-grok-bot"
NEW_IMAGE="coke-grok-auth:candidate-library-files-20261115-r2"
OPS="$RELEASE_DIR/operations"
[[ "$(kubectl config current-context)" == "$CONTEXT" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$NEW_IMAGE" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-auth -o jsonpath='{.spec.replicas}:{.status.readyReplicas}')" == "1:1" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get deployment coke-grok-desktop-broker -o jsonpath='{.spec.template.spec.containers[?(@.name=="broker")].image}')" == "$(cat "$OPS/broker-image-before.txt")" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get cm auth-runtime-config -o jsonpath='{.data.COKE_GROK_AGENT_IMAGE}')" == "$(cat "$OPS/agent-image-before.txt")" ]]
[[ "$(kubectl --context "$CONTEXT" -n "$NS" get pods -l app=coke-grok-auth -o jsonpath='{.items[0].status.containerStatuses[?(@.name=="auth")].ready}')" == true ]]
echo 'Auth is 1/1 Ready; Broker and Agent image configuration are unchanged.'
