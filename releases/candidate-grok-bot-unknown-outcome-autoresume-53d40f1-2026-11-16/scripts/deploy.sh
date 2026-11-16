#!/usr/bin/env bash
set -euo pipefail
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NS="coke-grok-bot"
CLUSTER="tp1121-sandbox-dev"
IMAGE="coke-grok-auth:candidate-unknown-outcome-autoresume-53d40f1-20261116-r1"
OLD_IMAGE="coke-grok-auth:candidate-browser-scope-ccc0a6e-20261116-r1"

[[ "$(kubectl config current-context)" == "k3d-${CLUSTER}" ]]
[[ "$(kubectl -n "$APP_NS" get deployment coke-grok-auth -o jsonpath='{.spec.template.spec.containers[0].image}')" == "$OLD_IMAGE" ]]
[[ "$(kubectl -n "$APP_NS" get deployment coke-grok-auth -o jsonpath='{.spec.replicas}')" == "1" ]]
[[ "$(kubectl -n "$APP_NS" get deployment coke-grok-auth -o jsonpath='{.status.availableReplicas}')" == "1" ]]
EXPECTED="$(awk 'NR==1 {print $1}' "$RELEASE_DIR/operations/image-id.txt")"
[[ "$(docker image inspect "$IMAGE" --format '{{.Id}}')" == "$EXPECTED" ]]
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$RELEASE_DIR/operations/deployed-at.txt"
kubectl -n "$APP_NS" get deployment coke-grok-auth -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}' > "$RELEASE_DIR/operations/pre-deploy-image.txt"
docker image inspect "$OLD_IMAGE" --format '{{.Id}} {{.Os}}/{{.Architecture}}' > "$RELEASE_DIR/operations/pre-deploy-image-id.txt"
kubectl -n "$APP_NS" get pods -l app=coke-grok-auth -o 'custom-columns=NAME:.metadata.name,READY:.status.containerStatuses[*].ready,IMAGE:.spec.containers[*].image' --no-headers > "$RELEASE_DIR/operations/pre-deploy-pods.txt"
k3d image import "$IMAGE" --cluster "$CLUSTER"
kubectl -n "$APP_NS" patch deployment coke-grok-auth --type=json --patch-file "$RELEASE_DIR/deploy/auth-image-candidate.patch.json"
kubectl -n "$APP_NS" rollout status deployment/coke-grok-auth --timeout=240s
[[ "$(kubectl -n "$APP_NS" get deployment coke-grok-auth -o jsonpath='{.spec.template.spec.containers[0].image}')" == "$IMAGE" ]]
[[ "$(kubectl -n "$APP_NS" get deployment coke-grok-auth -o jsonpath='{.status.availableReplicas}')" == "1" ]]
kubectl -n "$APP_NS" get pods -l app=coke-grok-auth -o 'custom-columns=NAME:.metadata.name,READY:.status.containerStatuses[*].ready,IMAGE:.spec.containers[*].image' --no-headers > "$RELEASE_DIR/operations/post-deploy-pods.txt"
