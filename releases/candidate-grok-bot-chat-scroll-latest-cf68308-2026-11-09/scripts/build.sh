#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_NAME="$(basename "$RELEASE_DIR")"
COMMIT="${SOURCE_COMMIT:-$(git -C "$ROOT" rev-parse HEAD)}"
AUTH_OLD="coke-grok-auth:sha-3f79e8191457098c7f3e3dbdec7e70b9d8baaf08"
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
  "status": "built_pending_auth_rollout_and_public_acceptance",
  "preparedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source": {"branch":"codex/grok-bot-persistent-group-chat","commit":"$COMMIT","trackedWorktreeClean":true},
  "runtime": {"context":"k3d-tp1121-sandbox-dev","cluster":"tp1121-sandbox-dev","applicationNamespace":"coke-grok-bot","publicUrl":"https://codex.cokeagent.com/grok-bot/","rolloutScope":"Auth only; Broker, Agent, Desktop, MySQL, PVCs, other namespaces and VPS unchanged"},
  "images": {"auth":{"candidate":"coke-grok-auth:sha-$COMMIT","candidateImageId":"$AUTH_ID","platform":"linux/arm64","rollback":"$AUTH_OLD"},"agent":{"unchanged":"$RUNTIME_CURRENT"},"desktop":{"unchanged":"$RUNTIME_CURRENT"},"broker":{"unchanged":"$BROKER_CURRENT"}},
  "checks": {"build":"passed","publicChatScroll":"local browser verified; pending public verification","brokerHttpStatus":"safe numeric status logging added; pending live read"}
}
EOF

{
  printf '# Operations\n\n'
  printf -- '- Source commit: %s.\n' "$COMMIT"
  printf '%s\n' '- Candidate changes only the Auth image. Existing Agent/Desktop and Broker image pins are recorded in manifest.json and remain unchanged.'
  printf '%s\n' '- The rollout requires zero queued/running Agent runs and zero pending approvals. It does not restart user-owned cloud-computer screens.'
  printf '%s\n' '- MySQL, workspace PVCs, other namespaces and the VPS are outside the rollout.'
  printf '%s\n' '- Rollback restores the exact Auth image recorded in the manifest.'
  printf '%s\n' '- Local UI evidence: after a synthetic long message, only .message-scroll moved to its bottom; window.scrollY remained zero. Public-domain verification is pending.'
} > "$RELEASE_DIR/docs/operations.md"

(
  cd "$RELEASE_DIR"
  find . -type f ! -name SHA256SUMS -print | sort | while IFS= read -r file; do shasum -a 256 "$file"; done > SHA256SUMS
)
printf 'Auth candidate built for %s; Agent/Desktop and Broker were not rebuilt.\n' "$COMMIT"
