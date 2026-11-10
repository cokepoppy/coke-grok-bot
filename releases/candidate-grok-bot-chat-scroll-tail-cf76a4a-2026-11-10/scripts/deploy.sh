#!/usr/bin/env bash
set -euo pipefail

APP_NS="coke-grok-bot"
CLUSTER="tp1121-sandbox-dev"
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="$(jq -er '.source.commit' "$RELEASE_DIR/manifest.json")"
AUTH_NEW="coke-grok-auth:sha-$COMMIT"
changed=0
rollback_on_failure(){
  rc=$?
  if [[ "$rc" -ne 0 && "$changed" -eq 1 ]]; then
    printf 'Auth rollout failed; restoring the exact previous Auth image.\n' >&2
    "$RELEASE_DIR/scripts/rollback.sh" || true
  fi
  exit "$rc"
}

"$RELEASE_DIR/scripts/preflight.sh"
k3d image import --cluster "$CLUSTER" "$AUTH_NEW"
trap rollback_on_failure EXIT
changed=1
kubectl -n "$APP_NS" set image deployment/coke-grok-auth "auth=$AUTH_NEW"
kubectl -n "$APP_NS" rollout status deployment/coke-grok-auth --timeout=180s
sleep 8
"$RELEASE_DIR/scripts/verify.sh"
changed=0
trap - EXIT
node --input-type=module - "$RELEASE_DIR/manifest.json" <<'EOF'
import { readFile, writeFile, rename } from 'node:fs/promises';
const file = process.argv[2];
const manifest = JSON.parse(await readFile(file, 'utf8'));
manifest.status = 'deployed_candidate_public_interaction_pending';
manifest.deployment = { completedAt: new Date().toISOString(), authReplicas: '1/1 Ready', publicRoute: 'HTTP 200', rolloutScope: 'Auth only' };
const temporary = `${file}.tmp`;
await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
await rename(temporary, file);
EOF
(
  cd "$RELEASE_DIR"
  find . -type f ! -name SHA256SUMS -print | sort | while IFS= read -r file; do shasum -a 256 "$file"; done > SHA256SUMS
)
