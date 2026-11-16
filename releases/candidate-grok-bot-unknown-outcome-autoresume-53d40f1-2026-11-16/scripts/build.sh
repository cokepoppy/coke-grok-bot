#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_COMMIT="53d40f1cc4febed0df5061626c7d3a2286299da4"
IMAGE="coke-grok-auth:candidate-unknown-outcome-autoresume-53d40f1-20261116-r1"

[[ "$(git -C "$ROOT" rev-parse HEAD)" == "$EXPECTED_COMMIT" ]]
[[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]]
(cd "$ROOT" && npm run build:deployment)
mkdir -p "$RELEASE_DIR/artifacts/web/assets" "$RELEASE_DIR/source" "$RELEASE_DIR/operations"
cp "$ROOT/dist/server/auth.cjs" "$RELEASE_DIR/artifacts/auth.cjs"
cp "$ROOT/dist/index.html" "$ROOT/dist/web-build.json" "$RELEASE_DIR/artifacts/web/"
cp "$ROOT/dist/assets/"* "$RELEASE_DIR/artifacts/web/assets/"
cp "$ROOT/src/server/run-store.ts" "$ROOT/src/server/run-scheduler.ts" "$ROOT/src/server/group-chat-store.ts" "$ROOT/src/web/main.tsx" "$ROOT/src/web/shell.css" "$ROOT/tests/run-store.test.ts" "$ROOT/tests/run-browser.e2e.ts" "$RELEASE_DIR/source/"
git -C "$ROOT" bundle create "$RELEASE_DIR/source/source.bundle" origin/main..HEAD
git -C "$ROOT" diff --binary origin/main...HEAD > "$RELEASE_DIR/source/feature.patch"
git -C "$ROOT" rev-parse HEAD > "$RELEASE_DIR/source/commit.txt"
git -C "$ROOT" branch --show-current > "$RELEASE_DIR/source/branch.txt"
docker build --platform linux/arm64 -f "$RELEASE_DIR/Dockerfile.auth" -t "$IMAGE" "$RELEASE_DIR"
docker image inspect "$IMAGE" --format '{{.Id}} {{.Os}}/{{.Architecture}}' > "$RELEASE_DIR/operations/image-id.txt"
shasum -a 256 "$RELEASE_DIR/artifacts/auth.cjs" "$RELEASE_DIR/artifacts/web/index.html" "$RELEASE_DIR/artifacts/web/web-build.json" "$RELEASE_DIR/source/source.bundle" "$RELEASE_DIR/source/feature.patch" > "$RELEASE_DIR/SHA256SUMS"
node "$RELEASE_DIR/scripts/record-build.mjs" "$RELEASE_DIR"
