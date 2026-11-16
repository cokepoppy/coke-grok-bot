#!/usr/bin/env bash
set -euo pipefail
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NS="coke-grok-bot"
IMAGE="coke-grok-auth:candidate-unknown-outcome-autoresume-53d40f1-20261116-r1"
EXPECTED="$(awk 'NR==1 {print $1}' "$RELEASE_DIR/operations/image-id.txt")"
[[ "$(kubectl -n "$APP_NS" get deployment coke-grok-auth -o jsonpath='{.spec.template.spec.containers[0].image}')" == "$IMAGE" ]]
[[ "$(kubectl -n "$APP_NS" get deployment coke-grok-auth -o jsonpath='{.status.availableReplicas}')" == "1" ]]
POD="$(kubectl -n "$APP_NS" get pods -l app=coke-grok-auth -o jsonpath='{.items[0].metadata.name}')"
ACTUAL="$(kubectl -n "$APP_NS" exec "$POD" -c auth -- sha256sum /app/auth.cjs | awk '{print $1}')"
BUILT="$(shasum -a 256 "$RELEASE_DIR/artifacts/auth.cjs" | awk '{print $1}')"
[[ "$ACTUAL" == "$BUILT" ]]
docker image inspect "$IMAGE" --format '{{.Id}}' | grep -Fx "$EXPECTED"
