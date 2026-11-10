#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_NAME="$(basename "$RELEASE_DIR")"
COMMIT="${SOURCE_COMMIT:-$(git -C "$ROOT" rev-parse HEAD)}"
AUTH_OLD="coke-grok-auth:sha-aa5c3a24c242e126536a4523f6d820f872c9a8ee"
RUNTIME_CURRENT="coke-grok-desktop:sha-2670fed3f6830a2344ac7590d5856901e190b00d"
BROKER_CURRENT="coke-grok-desktop-broker:sha-e18f71547116d965c5abc5db9227b74729983588"

[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$(git -C "$ROOT" branch --show-current)" == "codex/grok-bot-persistent-group-chat" ]]
[[ "$(git -C "$ROOT" rev-parse HEAD)" == "$COMMIT" ]]
git -C "$ROOT" diff --quiet
git -C "$ROOT" diff --cached --quiet

cd "$ROOT"
npm run build:deployment
docker build --platform linux/arm64 -f Dockerfile.auth -t "coke-grok-auth:sha-$COMMIT" .
for image in "coke-grok-auth:sha-$COMMIT" "$AUTH_OLD" "$RUNTIME_CURRENT" "$BROKER_CURRENT"; do
  [[ "$(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}')" == "linux/arm64" ]]
done

mkdir -p "$RELEASE_DIR/artifacts/dist" "$RELEASE_DIR/deploy/k3d" "$RELEASE_DIR/docs"
cp -R dist/. "$RELEASE_DIR/artifacts/dist/"
cp deploy/k3d/auth.yaml deploy/k3d/auth-runtime-config.yaml "$RELEASE_DIR/deploy/k3d/"
git archive --format=tar --prefix=source/ "$COMMIT" -- . ':!releases' | gzip -n > "$RELEASE_DIR/artifacts/source.tar.gz"
docker save "coke-grok-auth:sha-$COMMIT" | gzip -1 > "$RELEASE_DIR/artifacts/auth-image.tar.gz"

AUTH_ID="$(docker image inspect "coke-grok-auth:sha-$COMMIT" --format '{{.Id}}')"
cat > "$RELEASE_DIR/manifest.json" <<EOF
{
  "name": "$RELEASE_NAME",
  "status": "built_pending_auth_rollout_and_public_interaction",
  "preparedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source": {"branch":"codex/grok-bot-persistent-group-chat","commit":"$COMMIT","trackedWorktreeClean":true},
  "runtime": {"context":"k3d-tp1121-sandbox-dev","cluster":"tp1121-sandbox-dev","applicationNamespace":"coke-grok-bot","publicUrl":"https://codex.cokeagent.com/grok-bot/","rolloutScope":"Auth only; Broker, Agent, Desktop, MySQL, PVCs, other namespaces and VPS unchanged"},
  "images": {"auth":{"candidate":"coke-grok-auth:sha-$COMMIT","candidateImageId":"$AUTH_ID","platform":"linux/arm64","rollback":"$AUTH_OLD"},"agent":{"unchanged":"$RUNTIME_CURRENT"},"desktop":{"unchanged":"$RUNTIME_CURRENT"},"broker":{"unchanged":"$BROKER_CURRENT"}},
  "checks": {"uiE2e":"passed: authenticated long history, delayed and periodic run-history refresh, newest submitted task remains visible","deploymentBuild":"passed","publicVisibleInteraction":"pending: supported Chrome Computer Use calls timed out; no public message was sent"}
}
EOF

cat > "$RELEASE_DIR/docs/operations.md" <<EOF
# Operations

- Source commit: $COMMIT.
- Rollout changes the existing Auth Deployment image only. Agent/Desktop, Broker, MySQL, PVCs, other namespaces and the VPS are unchanged.
- The preflight requires zero queued/running Agent runs and zero pending approvals.
- The rollout is one-for-one on the existing Auth Deployment; it creates no additional service or database container.
- Rollback restores the exact Auth image recorded in manifest.json.
- Local UI E2E covers authenticated long history, delayed and periodic run-history refresh, and newest-message visibility; deployment build passed.
- Public visible interaction remains pending because supported Chrome Computer Use calls timed out; no public message was sent.
EOF

(
  cd "$RELEASE_DIR"
  find . -type f ! -name SHA256SUMS -print | sort | while IFS= read -r file; do shasum -a 256 "$file"; done > SHA256SUMS
)
printf 'Auth candidate built for %s; existing Agent/Desktop and Broker were not rebuilt.\n' "$COMMIT"
