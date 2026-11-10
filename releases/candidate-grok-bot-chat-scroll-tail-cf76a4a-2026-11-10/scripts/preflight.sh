#!/usr/bin/env bash
set -euo pipefail

APP_NS="coke-grok-bot"
CLUSTER="tp1121-sandbox-dev"
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="$(jq -er '.source.commit' "$RELEASE_DIR/manifest.json")"
AUTH_NEW="coke-grok-auth:sha-$COMMIT"
AUTH_OLD="$(jq -er '.images.auth.rollback' "$RELEASE_DIR/manifest.json")"
RUNTIME_CURRENT="$(jq -er '.images.agent.unchanged' "$RELEASE_DIR/manifest.json")"
BROKER_CURRENT="$(jq -er '.images.broker.unchanged' "$RELEASE_DIR/manifest.json")"

[[ "$(kubectl config current-context)" == "k3d-$CLUSTER" ]]
[[ "$(kubectl -n "$APP_NS" get deploy coke-grok-auth -o 'jsonpath={.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$AUTH_OLD" ]]
[[ "$(kubectl -n "$APP_NS" get deploy coke-grok-auth -o 'jsonpath={.status.availableReplicas}')" == "1" ]]
[[ "$(kubectl -n "$APP_NS" get deploy coke-grok-desktop-broker -o 'jsonpath={.status.availableReplicas}')" == "1" ]]
[[ "$(kubectl -n "$APP_NS" get configmap auth-runtime-config -o 'jsonpath={.data.COKE_GROK_DESKTOP_IMAGE}')" == "$RUNTIME_CURRENT" ]]
[[ "$(kubectl -n "$APP_NS" get configmap auth-runtime-config -o 'jsonpath={.data.COKE_GROK_AGENT_IMAGE}')" == "$RUNTIME_CURRENT" ]]
[[ "$(kubectl -n "$APP_NS" get deploy coke-grok-desktop-broker -o 'jsonpath={.spec.template.spec.containers[?(@.name=="broker")].image}')" == "$BROKER_CURRENT" ]]

mysql_query(){
  local query="$1"
  kubectl -n "$APP_NS" get secret auth-secrets -o 'jsonpath={.data.mysql-password}' | base64 -d | docker exec -i coke-grok-local-auth-mysql sh -ec '
    cfg=/tmp/coke-grok-auth-rollout-preflight-$$.cnf
    trap "rm -f \"$cfg\"" EXIT
    umask 077
    IFS= read -r password || [ -n "$password" ]
    printf "[client]\nhost=127.0.0.1\nuser=%s\npassword=%s\ndatabase=%s\n" "$1" "$password" "$2" > "$cfg"
    unset password
    mysql --defaults-extra-file="$cfg" --connect-timeout=3 --batch --skip-column-names -e "$3"
  ' sh coke_grok_k3d coke_grok_local "$query"
}

active="$(mysql_query "SELECT COUNT(*) FROM agent_runs WHERE status IN ('queued','running')")"
pending="$(mysql_query "SELECT COUNT(*) FROM run_approvals WHERE status='pending' AND expires_at>UTC_TIMESTAMP(3)")"
[[ "$active" == "0" && "$pending" == "0" ]]
for image in "$AUTH_OLD" "$AUTH_NEW" "$RUNTIME_CURRENT" "$BROKER_CURRENT"; do
  [[ "$(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}')" == "linux/arm64" ]]
done
printf 'Preflight passed: Auth rollback pin and idle Agent/approval queues verified; user computer Pods are not restarted.\n'
