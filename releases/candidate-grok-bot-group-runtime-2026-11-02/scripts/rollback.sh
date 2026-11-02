#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-}"
[[ -z "$MODE" || "$MODE" == "--apply" ]] || { echo "Usage: $0 [--apply]" >&2; exit 2; }
CONTEXT="$(node -e 'process.stdout.write(require(process.argv[1]).deployment.clusterContext)' "$ROOT/manifest.json")"
CLUSTER="$(node -e 'process.stdout.write(require(process.argv[1]).deployment.clusterName)' "$ROOT/manifest.json")"
NS="$(node -e 'process.stdout.write(require(process.argv[1]).deployment.namespace)' "$ROOT/manifest.json")"
DEPLOY="$(node -e 'process.stdout.write(require(process.argv[1]).deployment.deployment)' "$ROOT/manifest.json")"
CANDIDATE="$(node -e 'process.stdout.write(require(process.argv[1]).images.candidate.tag)' "$ROOT/manifest.json")"
ROLLBACK="$(node -e 'process.stdout.write(require(process.argv[1]).images.rollback.tag)' "$ROOT/manifest.json")"
CURRENT_CONTEXT="$(kubectl config current-context)"
[[ "$CURRENT_CONTEXT" == "$CONTEXT" ]] || { echo "Refusing unexpected Kubernetes context: $CURRENT_CONTEXT" >&2; exit 1; }
CURRENT_AUTH="$(kubectl -n "$NS" get deployment "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[?(@.name=="auth")].image}')"
CURRENT_INIT="$(kubectl -n "$NS" get deployment "$DEPLOY" -o jsonpath='{.spec.template.spec.initContainers[?(@.name=="private-secrets")].image}')"
if [[ "$CURRENT_AUTH" == "$ROLLBACK" && "$CURRENT_INIT" == "$ROLLBACK" ]]; then
  echo "Rollback image is already active; no Deployment change is needed."
  exit 0
fi
[[ "$CURRENT_AUTH" == "$CANDIDATE" && "$CURRENT_INIT" == "$CANDIDATE" ]] || { echo "Refusing unexpected Auth/init image pair: $CURRENT_AUTH / $CURRENT_INIT" >&2; exit 1; }
if [[ "$MODE" != "--apply" ]]; then
  echo "Dry run: would restore only $NS/$DEPLOY from $CANDIDATE to $ROLLBACK in cluster $CLUSTER. MySQL and PVCs are preserved."
  exit 0
fi
"$ROOT/scripts/verify.sh"
docker load --input "$ROOT/images/auth-candidate-and-rollback-linux-arm64.tar" >/dev/null
ACTUAL_ID="$(docker image inspect "$ROLLBACK" --format '{{.Id}}')"
EXPECTED_ID="$(node -e 'process.stdout.write(require(process.argv[1]).images.rollback.imageId)' "$ROOT/manifest.json")"
[[ "$ACTUAL_ID" == "$EXPECTED_ID" ]] || { echo "Rollback image ID mismatch after load." >&2; exit 1; }
k3d image import "$ROLLBACK" --cluster "$CLUSTER"
kubectl -n "$NS" patch deployment "$DEPLOY" --type=strategic --patch-file "$ROOT/k3d/auth-image-rollback.patch.json"
kubectl -n "$NS" rollout status "deployment/$DEPLOY" --timeout=180s
BASE_URL="${BASE_URL:-https://codex.cokeagent.com/grok-bot}"
ready="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 20 "${BASE_URL%/}/api/auth/ready")"
[[ "$ready" == "204" ]] || { echo "Auth readiness expected 204 after rollback, got $ready." >&2; exit 1; }
echo "Rollback completed; Auth readiness is 204. MySQL and PVCs were left untouched."
