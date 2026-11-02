#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
shasum -a 256 -c SHA256SUMS
if [[ "${1:-}" == "--require-images" ]]; then
  node <<'NODE'
const {execFileSync}=require('node:child_process');
const m=require('./manifest.json');
for(const [name,image] of Object.entries({candidate:m.images.candidate,rollback:m.images.rollback})) {
  const actual=execFileSync('docker',['image','inspect',image.tag,'--format','{{.Id}}'],{encoding:'utf8'}).trim();
  if(actual!==image.imageId) throw new Error(`${name} image ID mismatch`);
}
console.log('Candidate and rollback image IDs match the manifest.');
NODE
elif [[ "${1:-}" != "" ]]; then
  echo "Usage: $0 [--require-images]" >&2
  exit 2
fi
echo "Release checksums passed."
