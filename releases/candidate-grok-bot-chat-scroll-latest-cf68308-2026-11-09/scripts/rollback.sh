#!/usr/bin/env bash
set -euo pipefail

APP_NS="coke-grok-bot"
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AUTH_OLD="$(jq -er '.images.auth.rollback' "$RELEASE_DIR/manifest.json")"
kubectl -n "$APP_NS" set image deployment/coke-grok-auth "auth=$AUTH_OLD"
kubectl -n "$APP_NS" rollout status deployment/coke-grok-auth --timeout=180s
[[ "$(kubectl -n "$APP_NS" get deploy coke-grok-auth -o 'jsonpath={.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$AUTH_OLD" ]]
printf 'Auth restored to %s.\n' "$AUTH_OLD"
