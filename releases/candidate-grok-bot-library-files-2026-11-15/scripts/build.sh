#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CODE_COMMIT="$(cat "$RELEASE_DIR/source/code-commit.txt")"
EXPECTED_BRANCH="$(cat "$RELEASE_DIR/source/branch.txt")"
IMAGE="coke-grok-auth:candidate-library-files-20261115-r1"

[[ "$(git -C "$ROOT" branch --show-current)" == "$EXPECTED_BRANCH" ]]
git -C "$ROOT" cat-file -e "$CODE_COMMIT^{commit}"
git -C "$ROOT" diff --quiet "$CODE_COMMIT" -- src/server/auth-http.ts src/server/file-store.ts src/web/main.tsx src/web/shell.css tests/run-http.test.ts

(cd "$ROOT" && npm run build:deployment)
rm -rf "$RELEASE_DIR/artifacts/web"
mkdir -p "$RELEASE_DIR/artifacts/web/assets" "$RELEASE_DIR/artifacts/images" "$RELEASE_DIR/operations"
cp "$ROOT/dist/server/auth.cjs" "$RELEASE_DIR/artifacts/auth.cjs"
cp "$ROOT/dist/index.html" "$ROOT/dist/web-build.json" "$RELEASE_DIR/artifacts/web/"
cp "$ROOT"/dist/assets/* "$RELEASE_DIR/artifacts/web/assets/"
docker build --platform linux/arm64 -f "$RELEASE_DIR/Dockerfile.auth" -t "$IMAGE" "$RELEASE_DIR"
docker image inspect "$IMAGE" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{.Size}}' > "$RELEASE_DIR/operations/auth-image.txt"
[[ "$(awk '{print $2}' "$RELEASE_DIR/operations/auth-image.txt")" == "linux/arm64" ]]
docker save "$IMAGE" | gzip -1 > "$RELEASE_DIR/artifacts/images/coke-grok-auth-linux-arm64.tar.gz.tmp"
mv "$RELEASE_DIR/artifacts/images/coke-grok-auth-linux-arm64.tar.gz.tmp" "$RELEASE_DIR/artifacts/images/coke-grok-auth-linux-arm64.tar.gz"
shasum -a 256 "$RELEASE_DIR/artifacts/images/coke-grok-auth-linux-arm64.tar.gz" > "$RELEASE_DIR/operations/image-archive.sha256"
(cd "$RELEASE_DIR" && find . -type f ! -name SHA256SUMS ! -path './artifacts/images/*.tar.gz' ! -path './operations/image-archive.sha256' -print0 | xargs -0 shasum -a 256 > SHA256SUMS)
echo "Built $IMAGE ($(cat "$RELEASE_DIR/operations/auth-image.txt"))"
