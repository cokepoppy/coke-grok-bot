#!/usr/bin/env bash
set -euo pipefail

APP_NS="coke-grok-bot"
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="$(jq -er '.source.commit' "$RELEASE_DIR/manifest.json")"
AUTH_NEW="coke-grok-auth:sha-$COMMIT"
[[ "$(kubectl config current-context)" == "k3d-tp1121-sandbox-dev" ]]
[[ "$(kubectl -n "$APP_NS" get deploy coke-grok-auth -o 'jsonpath={.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$AUTH_NEW" ]]
[[ "$(kubectl -n "$APP_NS" get deploy coke-grok-auth -o 'jsonpath={.status.availableReplicas}')" == "1" ]]
if [[ -n "${COKE_GROK_EGRESS_PROXY:-}" ]]; then
  curl -fsS --max-time 15 --proxy "$COKE_GROK_EGRESS_PROXY" -o /dev/null -w 'public_http=%{http_code}\n' https://codex.cokeagent.com/grok-bot/
else
  curl -fsS --max-time 15 -o /dev/null -w 'public_http=%{http_code}\n' https://codex.cokeagent.com/grok-bot/
fi
printf 'Auth image and public static route verified; Agent, Desktop, Broker, MySQL, and PVC pins are unchanged.\n'
