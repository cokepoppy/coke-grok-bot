#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTEXT="k3d-tp1121-sandbox-dev"
NAMESPACE="coke-grok-bot"
CURRENT_IMAGE="coke-grok-auth:checkpoint-website-demo-ui-2026-11-01"
ROLLBACK_IMAGE="coke-grok-auth:sha-5b66393"

if [[ "${1:-}" != "--apply" || "$#" -ne 1 ]]; then
  echo "Dry run only. This restores $ROLLBACK_IMAGE for deployment/coke-grok-auth in $NAMESPACE."
  echo "It does not change MySQL, PVCs, VPS configuration, or other workloads."
  echo "To apply after review, run: $0 --apply"
  exit 0
fi

if [[ "${COKE_GROK_NO_ACTIVE_RUNS_CONFIRMED:-}" != "1" ]]; then
  echo "Before rollback, inspect the run queue and set COKE_GROK_NO_ACTIVE_RUNS_CONFIRMED=1 only when no active runs can be interrupted." >&2
  exit 1
fi

current_context="$(kubectl config current-context)"
if [[ "$current_context" != "$CONTEXT" ]]; then
  echo "Refusing to roll back: current context is '$current_context', expected '$CONTEXT'." >&2
  exit 1
fi
running_image="$(kubectl get deployment/coke-grok-auth -n "$NAMESPACE" -o 'jsonpath={.spec.template.spec.containers[?(@.name=="auth")].image}')"
if [[ "$running_image" != "$CURRENT_IMAGE" ]]; then
  echo "Refusing to roll back: deployment runs '$running_image', expected '$CURRENT_IMAGE'." >&2
  exit 1
fi

"$ROOT/scripts/verify.sh"
docker load -i "$ROOT/images/coke-grok-auth-ui-checkpoint-linux-arm64.tar"
"$ROOT/scripts/verify.sh" --require-images
k3d image import --cluster tp1121-sandbox-dev "$ROLLBACK_IMAGE"
kubectl set image deployment/coke-grok-auth "auth=$ROLLBACK_IMAGE" -n "$NAMESPACE"
kubectl rollout status deployment/coke-grok-auth -n "$NAMESPACE" --timeout=180s
echo "Application image restored. MySQL and PVC resources were not modified."
