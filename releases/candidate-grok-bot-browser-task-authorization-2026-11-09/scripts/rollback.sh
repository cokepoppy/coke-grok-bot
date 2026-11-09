#!/usr/bin/env bash
set -euo pipefail

APP_NS="coke-grok-bot"
USER_NS="${COKE_GROK_USER_NAMESPACE:-grok-user-00213195e832242e4afea5b264424355}"
AUTH_OLD="coke-grok-auth:browser-task-r3-20261109"
AGENT_OLD="coke-grok-desktop:candidate-browser-task-r3-20261109"
DESKTOP_OLD="coke-grok-desktop:candidate-browser-task-r3-20261109"

[[ "$USER_NS" == "grok-user-00213195e832242e4afea5b264424355" ]]
[[ "$(kubectl config current-context)" == "k3d-tp1121-sandbox-dev" ]]
docker image inspect "$AUTH_OLD" "$AGENT_OLD" "$DESKTOP_OLD" >/dev/null
kubectl -n "$APP_NS" patch configmap auth-runtime-config --type merge -p "{\"data\":{\"COKE_GROK_AGENT_IMAGE\":\"$AGENT_OLD\",\"COKE_GROK_DESKTOP_IMAGE\":\"$DESKTOP_OLD\"}}"
kubectl -n "$APP_NS" rollout restart deployment/coke-grok-desktop-broker
kubectl -n "$USER_NS" set image deployment/agent "agent=$AGENT_OLD"
kubectl -n "$USER_NS" set image deployment/desktop "desktop=$DESKTOP_OLD"
kubectl -n "$APP_NS" set image deployment/coke-grok-auth "auth=$AUTH_OLD"
kubectl -n "$APP_NS" rollout status deployment/coke-grok-auth --timeout=180s
kubectl -n "$APP_NS" rollout status deployment/coke-grok-desktop-broker --timeout=180s
kubectl -n "$USER_NS" rollout status deployment/agent --timeout=180s
kubectl -n "$USER_NS" rollout status deployment/desktop --timeout=240s
printf 'Rollback restored the exact r3 image pins; MySQL, workspace PVC, and other namespaces were preserved.\n'
