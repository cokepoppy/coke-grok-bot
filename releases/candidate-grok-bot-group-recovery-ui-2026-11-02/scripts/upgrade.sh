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
if [[ "$CURRENT_AUTH" == "$CANDIDATE" && "$CURRENT_INIT" == "$CANDIDATE" ]]; then
  echo "Candidate image is already active; no Deployment change is needed."
  if [[ "$MODE" == "--apply" ]]; then kubectl -n "$NS" rollout status "deployment/$DEPLOY" --timeout=180s; "$ROOT/scripts/smoke.sh"; fi
  exit 0
fi
[[ "$CURRENT_AUTH" == "$ROLLBACK" && "$CURRENT_INIT" == "$ROLLBACK" ]] || { echo "Refusing unexpected Auth/init image pair: $CURRENT_AUTH / $CURRENT_INIT" >&2; exit 1; }
if [[ "$MODE" != "--apply" ]]; then
  echo "Dry run: would update only $NS/$DEPLOY from $ROLLBACK to $CANDIDATE in cluster $CLUSTER."
  exit 0
fi
"$ROOT/scripts/verify.sh"
docker load --input "$ROOT/images/auth-candidate-and-rollback-linux-arm64.tar" >/dev/null
ACTUAL_ID="$(docker image inspect "$CANDIDATE" --format '{{.Id}}')"
EXPECTED_ID="$(node -e 'process.stdout.write(require(process.argv[1]).images.candidate.imageId)' "$ROOT/manifest.json")"
[[ "$ACTUAL_ID" == "$EXPECTED_ID" ]] || { echo "Candidate image ID mismatch after load." >&2; exit 1; }
k3d image import "$CANDIDATE" --cluster "$CLUSTER"
kubectl -n "$NS" patch deployment "$DEPLOY" --type=strategic --patch-file "$ROOT/k3d/auth-image-candidate.patch.json"
if ! kubectl -n "$NS" rollout status "deployment/$DEPLOY" --timeout=180s; then
  kubectl -n "$NS" patch deployment "$DEPLOY" --type=strategic --patch-file "$ROOT/k3d/auth-image-rollback.patch.json"
  kubectl -n "$NS" rollout status "deployment/$DEPLOY" --timeout=180s
  exit 1
fi
"$ROOT/scripts/smoke.sh"
