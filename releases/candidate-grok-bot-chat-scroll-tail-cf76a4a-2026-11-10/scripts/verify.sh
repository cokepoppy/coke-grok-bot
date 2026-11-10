#!/usr/bin/env bash
set -euo pipefail

APP_NS="coke-grok-bot"
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="$(jq -er '.source.commit' "$RELEASE_DIR/manifest.json")"
AUTH_NEW="coke-grok-auth:sha-$COMMIT"
[[ "$(kubectl config current-context)" == "k3d-tp1121-sandbox-dev" ]]
[[ "$(kubectl -n "$APP_NS" get deploy coke-grok-auth -o 'jsonpath={.spec.template.spec.containers[?(@.name=="auth")].image}')" == "$AUTH_NEW" ]]
[[ "$(kubectl -n "$APP_NS" get deploy coke-grok-auth -o 'jsonpath={.status.availableReplicas}')" == "1" ]]
node --input-type=module - "$RELEASE_DIR" <<'NODE'
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const releaseDir = process.argv[2];
const base = 'https://codex.cokeagent.com/grok-bot/';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status} from ${url}`);
      if (response.status < 500 && response.status !== 404) throw lastError;
    } catch (error) {
      lastError = error;
      if (error.message?.startsWith('HTTP ') && !error.message.includes('HTTP 404')) throw error;
    }
    if (attempt < 5) await delay(1000);
  }
  throw lastError;
}
const page = await fetchWithRetry(base);
const html = await page.text();
await Promise.all(['src', 'href'].map(async attribute => {
  const match = html.match(new RegExp(`${attribute}="([^"]+\\.(${attribute === 'src' ? 'js' : 'css'}))"`));
  if (!match) throw new Error(`Could not find deployed ${attribute} asset`);
  const assetResponse = await fetchWithRetry(new URL(match[1], base));
  const actual = Buffer.from(await assetResponse.arrayBuffer());
  const expected = await readFile(path.join(releaseDir, 'artifacts', 'dist', 'assets', path.basename(match[1])));
  const actualHash = createHash('sha256').update(actual).digest('hex');
  const expectedHash = createHash('sha256').update(expected).digest('hex');
  if (actualHash !== expectedHash) throw new Error(`Deployed asset mismatch for ${match[1]}`);
  console.log(`${attribute}_asset=${match[1]} sha256=${actualHash}`);
}));
console.log('public_http=200');
NODE
printf 'Auth image and public assets verified; no Agent/Desktop Pod restart was requested.\n'
