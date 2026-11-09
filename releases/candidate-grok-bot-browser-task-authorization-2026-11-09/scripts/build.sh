#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="${SOURCE_COMMIT:-$(git -C "$ROOT" rev-parse HEAD)}"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$(git -C "$ROOT" branch --show-current)" == "codex/grok-bot-persistent-group-chat" ]]
[[ "$(git -C "$ROOT" rev-parse HEAD)" == "$COMMIT" ]]
(cd "$ROOT" && git diff --quiet && git diff --cached --quiet)

cd "$ROOT"
npm run build:deployment
docker build --platform linux/arm64 -f Dockerfile.auth -t "coke-grok-auth:sha-$COMMIT" .
docker build --platform linux/arm64 -f deploy/desktop/Dockerfile -t "coke-grok-desktop:sha-$COMMIT" .
for image in \
  "coke-grok-auth:sha-$COMMIT" \
  "coke-grok-desktop:sha-$COMMIT" \
  coke-grok-auth:browser-task-r3-20261109 \
  coke-grok-desktop:candidate-browser-task-r3-20261109 \
  coke-grok-desktop-broker:sha-e18f71547116d965c5abc5db9227b74729983588; do
  [[ "$(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}')" == "linux/arm64" ]]
done

mkdir -p "$RELEASE_DIR/artifacts"
rm -rf "$RELEASE_DIR/artifacts/dist"
cp -R dist "$RELEASE_DIR/artifacts/dist"
"$RELEASE_DIR/scripts/export-images.sh" "$COMMIT"

AUTH_ID="$(docker image inspect "coke-grok-auth:sha-$COMMIT" --format '{{.Id}}')"
RUNTIME_ID="$(docker image inspect "coke-grok-desktop:sha-$COMMIT" --format '{{.Id}}')"
AUTH_ARCH="$(docker image inspect "coke-grok-auth:sha-$COMMIT" --format '{{.Os}}/{{.Architecture}}')"
RUNTIME_ARCH="$(docker image inspect "coke-grok-desktop:sha-$COMMIT" --format '{{.Os}}/{{.Architecture}}')"
cat > "$RELEASE_DIR/manifest.json" <<EOF
{
  "name": "candidate-grok-bot-browser-task-authorization-2026-11-09",
  "status": "built_pending_deployment_and_public_acceptance",
  "preparedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source": {"branch":"codex/grok-bot-persistent-group-chat","commit":"$COMMIT","trackedWorktreeClean":true},
  "runtime": {"context":"k3d-tp1121-sandbox-dev","cluster":"tp1121-sandbox-dev","applicationNamespace":"coke-grok-bot","publicOwnerNamespace":"grok-user-00213195e832242e4afea5b264424355","publicUrl":"https://codex.cokeagent.com/grok-bot/","databaseMigration":false,"workspacePvcChanged":false,"mysqlChanged":false,"otherUserNamespacesChanged":false,"vps":"proxy and tunnel only"},
  "images": {"auth":{"candidate":"coke-grok-auth:sha-$COMMIT","candidateImageId":"$AUTH_ID","platform":"$AUTH_ARCH","rollback":"coke-grok-auth:browser-task-r3-20261109"},"agent":{"candidate":"coke-grok-desktop:sha-$COMMIT","candidateImageId":"$RUNTIME_ID","platform":"$RUNTIME_ARCH","rollback":"coke-grok-desktop:candidate-browser-task-r3-20261109"},"desktop":{"candidate":"coke-grok-desktop:sha-$COMMIT","candidateImageId":"$RUNTIME_ID","platform":"$RUNTIME_ARCH","rollback":"coke-grok-desktop:candidate-browser-task-r3-20261109"},"archive":"artifacts/runtime-images.tar.gz"},
  "checks": {"runtimeTests":"160/160 passed","deploymentBuild":"passed","publicGmailE2e":"paused_at_user_sign_in_handoff"}
}
EOF

printf '\n- Built candidate source `%s`; Auth image ID `%s`, shared Agent/Desktop image ID `%s` (linux/arm64).\n' "$COMMIT" "$AUTH_ID" "$RUNTIME_ID" >> "$RELEASE_DIR/OPERATIONS.md"

(
  cd "$RELEASE_DIR"
  find . -type f ! -name SHA256SUMS ! -name runtime-images.tar.gz ! -name runtime-images.tar.gz.sha256 -print | sort | while IFS= read -r file; do shasum -a 256 "$file"; done > SHA256SUMS
)
printf '%s\n' "Candidate images, deployment bundle, and checksums built for source $COMMIT. Public Gmail acceptance is still paused at sign-in."
