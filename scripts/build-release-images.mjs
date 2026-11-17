import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const commit = git('rev-parse', '--verify', 'HEAD');
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Cannot determine a full Git commit for this release');
try { execFileSync('git', ['diff-index', '--quiet', 'HEAD', '--'], { cwd: root, stdio: 'ignore' }); }
catch { throw new Error('Tracked source changes must be committed before building a release'); }
const releaseId = `sha-${commit}`;
const imageSpecs = [
  { name: 'coke-grok-auth', dockerfile: 'Dockerfile.auth' },
  { name: 'coke-grok-desktop-broker', dockerfile: 'Dockerfile.desktop-broker' },
  { name: 'coke-grok-namespace-bootstrap', dockerfile: 'Dockerfile.namespace-bootstrap' },
  { name: 'coke-grok-desktop', dockerfile: 'deploy/desktop/Dockerfile' },
];

execFileSync('npm', ['run', 'build:deployment'], { cwd: root, stdio: 'inherit' });
const images = {};
for (const image of imageSpecs) {
  const ref = `${image.name}:${releaseId}`;
  execFileSync('docker', [
    'build', '--platform', 'linux/arm64', '--build-arg', `COKE_GROK_RELEASE_ID=${releaseId}`,
    '-f', image.dockerfile, '-t', ref, '.',
  ], { cwd: root, stdio: 'inherit' });
  const inspected = JSON.parse(execFileSync('docker', ['image', 'inspect', ref, '--format', '{{json .}}'], { cwd: root, encoding: 'utf8' }));
  const labels = inspected.Config?.Labels ?? {};
  const environment = inspected.Config?.Env ?? [];
  if (labels['coke-grok-bot.io/release-id'] !== releaseId || !environment.includes(`COKE_GROK_RELEASE_ID=${releaseId}`)) {
    throw new Error(`Image metadata does not match ${releaseId}: ${image.name}`);
  }
  if (inspected.Os !== 'linux' || inspected.Architecture !== 'arm64') throw new Error(`Unexpected image platform: ${image.name}`);
  images[image.name] = { ref, imageId: inspected.Id, platform: `${inspected.Os}/${inspected.Architecture}` };
}
const manifest = { releaseId, commit, sourceBranch: git('branch', '--show-current'), builtAt: new Date().toISOString(), images };
const output = resolve(root, 'dist/release-images.json');
await mkdir(resolve(root, 'dist'), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Built ${Object.keys(images).length} application images for ${releaseId}. Manifest: ${output}\n`);
