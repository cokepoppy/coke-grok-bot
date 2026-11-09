#!/usr/bin/env bash
set -euo pipefail

APP_NS="coke-grok-bot"
USER_NS="${COKE_GROK_USER_NAMESPACE:-grok-user-00213195e832242e4afea5b264424355}"
CLUSTER="tp1121-sandbox-dev"
AUTH_OLD="coke-grok-auth:browser-task-r3-20261109"
AGENT_OLD="coke-grok-desktop:candidate-browser-task-r3-20261109"
DESKTOP_OLD="coke-grok-desktop:candidate-browser-task-r3-20261109"
AUTH_NEW="${CANDIDATE_AUTH_IMAGE:-}"
AGENT_NEW="${CANDIDATE_AGENT_IMAGE:-}"
DESKTOP_NEW="${CANDIDATE_DESKTOP_IMAGE:-}"

[[ -n "$AUTH_NEW" && -n "$AGENT_NEW" && -n "$DESKTOP_NEW" ]]
[[ "$USER_NS" == "grok-user-00213195e832242e4afea5b264424355" ]]
[[ "$(kubectl config current-context)" == "k3d-$CLUSTER" ]]
[[ "$(kubectl -n "$APP_NS" get deployment coke-grok-auth -o 'jsonpath={.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$AUTH_OLD" ]]
[[ "$(kubectl -n "$APP_NS" get deployment coke-grok-auth -o 'jsonpath={.status.availableReplicas}')" == "1" ]]
[[ "$(kubectl -n "$APP_NS" get deployment coke-grok-desktop-broker -o 'jsonpath={.status.availableReplicas}')" == "1" ]]
[[ "$(kubectl -n "$USER_NS" get deployment agent -o 'jsonpath={.spec.template.spec.containers[?(@.name=="agent")].image}')" == "$AGENT_OLD" ]]
[[ "$(kubectl -n "$USER_NS" get deployment desktop -o 'jsonpath={.spec.template.spec.containers[?(@.name=="desktop")].image}')" == "$DESKTOP_OLD" ]]
[[ "$(kubectl -n "$USER_NS" get deployment agent -o 'jsonpath={.status.availableReplicas}')" == "1" ]]
[[ "$(kubectl -n "$USER_NS" get deployment desktop -o 'jsonpath={.status.availableReplicas}')" == "1" ]]
[[ "$(kubectl -n "$USER_NS" get pvc workspace -o 'jsonpath={.status.phase}')" == "Bound" ]]
[[ "$(kubectl -n "$USER_NS" get pvc workspace -o 'jsonpath={.spec.volumeName}')" == "pvc-636987df-fa44-45f8-be00-bd8e88282b89" ]]
[[ "$(kubectl -n "$APP_NS" get configmap auth-runtime-config -o 'jsonpath={.data.COKE_GROK_DESKTOP_IMAGE}')" == "$DESKTOP_OLD" ]]
[[ "$(kubectl -n "$APP_NS" get configmap auth-runtime-config -o 'jsonpath={.data.COKE_GROK_AGENT_IMAGE}')" == "$AGENT_OLD" ]]

# Never restart Desktop while the owner has taken control of any persistent Bot screen.
owner_state="$(kubectl -n "$USER_NS" exec deployment/desktop -c desktop -- node -e '
const fs = require("node:fs");
const path = require("node:path");
const root = "/workspace/shared/computer-screens";
if (fs.existsSync(root)) {
  for (const file of fs.readdirSync(root).filter(name => /^[0-9a-f-]{36}\.json$/i.test(name))) {
    const state = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    if (state.owner !== "agent" && state.owner !== "user") process.exit(20);
    if (state.owner === "user") process.exit(21);
  }
}
process.stdout.write("agent");
')"
[[ "$owner_state" == "agent" ]]

mysql_query(){
  local query="$1"
  kubectl -n "$APP_NS" get secret auth-secrets -o 'jsonpath={.data.mysql-password}' | base64 -d | docker exec -i coke-grok-local-auth-mysql sh -ec '
    cfg=/tmp/coke-grok-browser-task-preflight-$$.cnf
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
docker image inspect "$AUTH_OLD" "$AGENT_OLD" "$DESKTOP_OLD" "$AUTH_NEW" "$AGENT_NEW" "$DESKTOP_NEW" --format '{{.Os}}/{{.Architecture}}' | rg -x 'linux/arm64' >/dev/null

printf 'Preflight passed: exact rollback images, idle queues, Agent-owned Desktop screens, and the bound workspace PVC were verified.\n'
