#!/usr/bin/env bash
set -euo pipefail

RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="${1:-${SOURCE_COMMIT:-$(git -C "$(cd "$RELEASE_DIR/../.." && pwd)" rev-parse HEAD)}}"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]]
mkdir -p "$RELEASE_DIR/artifacts"
TMP="$RELEASE_DIR/artifacts/runtime-images.tar.gz.tmp"
trap 'rm -f "$TMP"' EXIT
docker image save \
  "coke-grok-auth:sha-$COMMIT" \
  "coke-grok-desktop:sha-$COMMIT" \
  coke-grok-auth:browser-task-r3-20261109 \
  coke-grok-desktop:candidate-browser-task-r3-20261109 \
  coke-grok-desktop-broker:sha-e18f71547116d965c5abc5db9227b74729983588 \
  | gzip -1 > "$TMP"
mv "$TMP" "$RELEASE_DIR/artifacts/runtime-images.tar.gz"
shasum -a 256 "$RELEASE_DIR/artifacts/runtime-images.tar.gz" > "$RELEASE_DIR/artifacts/runtime-images.tar.gz.sha256"
trap - EXIT
printf 'Local runtime image archive exported. It is intentionally excluded from Git due to its size.\n'
