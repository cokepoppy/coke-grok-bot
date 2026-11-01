#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
require_images=0
if [[ "${1:-}" == "--require-images" && "$#" -eq 1 ]]; then
  require_images=1
elif [[ "$#" -ne 0 ]]; then
  echo "Usage: $0 [--require-images]" >&2
  exit 2
fi

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c SHA256SUMS
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c SHA256SUMS
else
  echo "Need shasum or sha256sum to verify this checkpoint." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  if [[ "$require_images" -eq 1 ]]; then
    echo "Docker is required to inspect the checkpoint images." >&2
    exit 1
  fi
  echo "Checkpoint payload checksums verified; Docker image inspection skipped."
  exit 0
fi

manifest_values="$(node -e 'const m=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(`${m.image.name}:${m.image.tag}\t${m.image.imageId}\n${m.rollback.imageTag}\t${m.rollback.dockerImageId}`)' "$ROOT/manifest.json")"
while IFS=$'\t' read -r tag expected; do
  actual="$(docker image inspect "$tag" --format '{{.Id}}' 2>/dev/null || true)"
  if [[ -z "$actual" ]]; then
    if [[ "$require_images" -eq 1 ]]; then
      echo "Image $tag is not loaded. Load images/coke-grok-auth-ui-checkpoint-linux-arm64.tar first." >&2
      exit 1
    fi
    echo "Image $tag is not loaded yet; its archive checksum is verified."
    continue
  fi
  if [[ "$expected" != "$actual" ]]; then
    echo "Image ID mismatch for $tag: expected $expected, found $actual" >&2
    exit 1
  fi
done <<< "$manifest_values"
echo "Checkpoint checksums and all loaded image IDs verified."
