#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER_NAME="tp1121-sandbox-dev"
CONTEXT="k3d-tp1121-sandbox-dev"
NAMESPACE="coke-grok-bot"
IMAGE="coke-grok-auth:checkpoint-website-demo-ui-2026-11-01"
if [[ "$#" -gt 1 || ( "$#" -eq 1 && "${1:-}" != "--apply" ) ]]; then
  echo "Usage: $0 [--apply]" >&2
  exit 2
fi

current_context="$(kubectl config current-context)"
if [[ "$current_context" != "$CONTEXT" ]]; then
  echo "Refusing to inspect/apply: current context is '$current_context', expected '$CONTEXT'." >&2
  exit 1
fi

if [[ "$#" -eq 0 ]]; then
  echo "Dry run only: comparing release manifests with context '$CONTEXT'."
  set +e
  kubectl diff -k "$ROOT/deploy/k3d"
  diff_status=$?
  set -e
  if [[ "$diff_status" -gt 1 ]]; then
    exit "$diff_status"
  fi
  echo "To import and apply this checkpoint, run: $0 --apply"
  exit 0
fi

if [[ "${COKE_GROK_NO_ACTIVE_RUNS_CONFIRMED:-}" != "1" ]]; then
  echo "Before applying, inspect the run queue and set COKE_GROK_NO_ACTIVE_RUNS_CONFIRMED=1 only when no active runs can be interrupted." >&2
  exit 1
fi

kubectl get namespace "$NAMESPACE" >/dev/null
kubectl get configmap/auth-config secret/auth-secrets -n "$NAMESPACE" >/dev/null
kubectl get deployment/coke-grok-auth -n "$NAMESPACE" >/dev/null
"$ROOT/scripts/verify.sh"

docker load -i "$ROOT/images/coke-grok-auth-ui-checkpoint-linux-arm64.tar"
"$ROOT/scripts/verify.sh" --require-images
k3d image import --cluster "$CLUSTER_NAME" "$IMAGE"
kubectl apply -k "$ROOT/deploy/k3d"
kubectl rollout status deployment/coke-grok-auth -n "$NAMESPACE" --timeout=180s
echo "Checkpoint applied. MySQL and PVC resources were not modified."
