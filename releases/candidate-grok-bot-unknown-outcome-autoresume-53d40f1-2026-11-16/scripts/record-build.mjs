import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.argv[2];
const manifestPath = join(root, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const imageRecord = (await readFile(join(root, 'operations/image-id.txt'), 'utf8')).trim().split(/\s+/);
const hashes = {};
for (const [key, relative] of Object.entries({
  authBundleSha256: 'artifacts/auth.cjs',
  webIndexSha256: 'artifacts/web/index.html',
  webBuildMetadataSha256: 'artifacts/web/web-build.json',
  sourceBundleSha256: 'source/source.bundle',
  sourcePatchSha256: 'source/feature.patch',
})) {
  const bytes = await readFile(join(root, relative));
  hashes[key] = createHash('sha256').update(bytes).digest('hex');
}
manifest.images.candidateImageId = imageRecord[0];
manifest.checks.deploymentBuild = 'passed';
manifest.deployment.state = 'candidate-built-awaiting-rollout';
manifest.artifacts = hashes;
manifest.buildCompletedAt = new Date().toISOString();
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
