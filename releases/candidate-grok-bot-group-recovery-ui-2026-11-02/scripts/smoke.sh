#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${BASE_URL:-https://codex.cokeagent.com/grok-bot}"
BASE_URL="${BASE_URL%/}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

ready="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 20 "$BASE_URL/api/auth/ready")"
[[ "$ready" == "204" ]] || { echo "Auth readiness expected 204, got $ready." >&2; exit 1; }
groups="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 20 "$BASE_URL/api/groups")"
[[ "$groups" == "401" ]] || { echo "Anonymous group API expected 401, got $groups." >&2; exit 1; }
curl --silent --show-error --fail --max-time 20 "$BASE_URL/" --output "$tmp/index.html"
node - "$tmp/index.html" > "$tmp/assets.json" <<'NODE'
const fs=require('node:fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const js=html.match(/src="([^"]+\.js)"/),css=html.match(/href="([^"]+\.css)"/);
if(!js||!css) throw new Error('Public HTML is missing JS/CSS references');
process.stdout.write(JSON.stringify({js:js[1],css:css[1]}));
NODE
origin="$(node -e 'process.stdout.write(new URL(process.argv[1]).origin)' "$BASE_URL")"
js_path="$(node -e 'process.stdout.write(require(process.argv[1]).js)' "$tmp/assets.json")"
css_path="$(node -e 'process.stdout.write(require(process.argv[1]).css)' "$tmp/assets.json")"
curl --silent --show-error --fail --max-time 20 "$origin$js_path" --output "$tmp/app.js"
curl --silent --show-error --fail --max-time 20 "$origin$css_path" --output "$tmp/app.css"
expected_js="$(node -e 'process.stdout.write(require(process.argv[1]).build.assets.javascript.sha256)' "$ROOT/manifest.json")"
expected_css="$(node -e 'process.stdout.write(require(process.argv[1]).build.assets.stylesheet.sha256)' "$ROOT/manifest.json")"
actual_js="$(shasum -a 256 "$tmp/app.js" | awk '{print $1}')"
actual_css="$(shasum -a 256 "$tmp/app.css" | awk '{print $1}')"
[[ "$actual_js" == "$expected_js" ]] || { echo "Public JS hash does not match the candidate." >&2; exit 1; }
[[ "$actual_css" == "$expected_css" ]] || { echo "Public CSS hash does not match the candidate." >&2; exit 1; }
echo "Public readiness is 204, anonymous group access is 401, and JS/CSS match this candidate."
