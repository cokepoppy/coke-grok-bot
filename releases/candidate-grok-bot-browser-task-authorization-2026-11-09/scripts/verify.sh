#!/usr/bin/env bash
set -euo pipefail

APP_NS="coke-grok-bot"
USER_NS="${COKE_GROK_USER_NAMESPACE:-grok-user-00213195e832242e4afea5b264424355}"
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="$(jq -er '.source.commit' "$RELEASE_DIR/manifest.json")"
AUTH_NEW="coke-grok-auth:sha-$COMMIT"
AGENT_NEW="coke-grok-desktop:sha-$COMMIT"
DESKTOP_NEW="coke-grok-desktop:sha-$COMMIT"

[[ "$USER_NS" == "grok-user-00213195e832242e4afea5b264424355" ]]
[[ "$(kubectl config current-context)" == "k3d-tp1121-sandbox-dev" ]]
[[ "$(kubectl -n "$APP_NS" get deployment coke-grok-auth -o 'jsonpath={.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$AUTH_NEW" ]]
[[ "$(kubectl -n "$APP_NS" get deployment coke-grok-auth -o 'jsonpath={.status.availableReplicas}')" == "1" ]]
[[ "$(kubectl -n "$USER_NS" get deployment agent -o 'jsonpath={.spec.template.spec.containers[?(@.name=="agent")].image}')" == "$AGENT_NEW" ]]
[[ "$(kubectl -n "$USER_NS" get deployment agent -o 'jsonpath={.status.availableReplicas}')" == "1" ]]
[[ "$(kubectl -n "$USER_NS" get deployment desktop -o 'jsonpath={.spec.template.spec.containers[?(@.name=="desktop")].image}')" == "$DESKTOP_NEW" ]]
[[ "$(kubectl -n "$USER_NS" get deployment desktop -o 'jsonpath={.status.availableReplicas}')" == "1" ]]
[[ "$(kubectl -n "$APP_NS" get configmap auth-runtime-config -o 'jsonpath={.data.COKE_GROK_AGENT_IMAGE}')" == "$AGENT_NEW" ]]
[[ "$(kubectl -n "$APP_NS" get configmap auth-runtime-config -o 'jsonpath={.data.COKE_GROK_DESKTOP_IMAGE}')" == "$DESKTOP_NEW" ]]
[[ "$(kubectl -n "$USER_NS" get pvc workspace -o 'jsonpath={.status.phase}')" == "Bound" ]]
[[ "$(kubectl -n "$USER_NS" get pvc workspace -o 'jsonpath={.spec.volumeName}')" == "pvc-636987df-fa44-45f8-be00-bd8e88282b89" ]]
curl -fsS -o /dev/null -w 'public_http=%{http_code}\n' --max-time 15 https://codex.cokeagent.com/grok-bot/
printf 'Candidate image pins, public route, and unchanged workspace PVC verified. Gmail UI acceptance is a separate check.\n'
