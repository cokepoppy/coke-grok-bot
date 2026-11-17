import { execFileSync } from 'node:child_process';

const expectedReleaseId = process.argv[2] || process.env.COKE_GROK_RELEASE_ID || '';
if (!/^sha-[a-f0-9]{40}$/.test(expectedReleaseId)) {
  process.stderr.write('Usage: npm run release:verify-k3d -- sha-<full-40-character-commit> [--context <name>]\n');
  process.exit(2);
}
const contextIndex = process.argv.indexOf('--context');
const contextArgs = contextIndex >= 0 ? ['--context', process.argv[contextIndex + 1]] : [];
if (contextIndex >= 0 && !process.argv[contextIndex + 1]) throw new Error('--context requires a Kubernetes context name');
const kubectl = (...args) => execFileSync('kubectl', [...contextArgs, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
const applicationImages = new Set(['coke-grok-auth', 'coke-grok-desktop-broker', 'coke-grok-namespace-bootstrap', 'coke-grok-desktop']);
const requiredImages = new Set(applicationImages);
const errors = [];
const observations = [];

function imageParts(ref) {
  const leaf = ref.slice(ref.lastIndexOf('/') + 1);
  const split = leaf.lastIndexOf(':');
  return split < 1 ? { name: leaf, tag: '' } : { name: leaf.slice(0, split), tag: leaf.slice(split + 1) };
}
function isApplicationImage(ref) { return applicationImages.has(imageParts(ref).name); }
function validateImage(ref, place) {
  const { name, tag } = imageParts(ref);
  if (!applicationImages.has(name)) return;
  observations.push({ place, image: ref });
  if (tag !== expectedReleaseId) errors.push(`${place}: image ${ref} does not use ${expectedReleaseId}`);
}
function appContainers(spec) {
  return [...(spec?.initContainers ?? []), ...(spec?.containers ?? [])].filter(container => isApplicationImage(container.image));
}

const deploymentIndex = kubectl('get', 'deployments', '--all-namespaces', '-o', 'custom-columns=NS:.metadata.namespace,IMAGES:.spec.template.spec.containers[*].image,INIT:.spec.template.spec.initContainers[*].image', '--no-headers');
const appNamespaces = new Set(deploymentIndex.split(/\r?\n/).flatMap(line => {
  const [namespace, ...refs] = line.trim().split(/\s+/);
  return namespace && refs.some(ref => isApplicationImage(ref)) ? [namespace] : [];
}));
for (const namespace of appNamespaces) {
const deployments = JSON.parse(kubectl('get', 'deployments', '-n', namespace, '-o', 'json'));
for (const deployment of deployments.items ?? []) {
  const containers = appContainers(deployment.spec?.template?.spec);
  if (!containers.length || Number(deployment.spec?.replicas ?? 1) === 0) continue;
  const place = `${deployment.metadata.namespace}/${deployment.metadata.name}`;
  for (const container of containers) validateImage(container.image, `${place}/${container.name}`);
  const releaseLabel = deployment.spec?.template?.metadata?.labels?.['coke-grok-bot.io/release-id'];
  if (releaseLabel && releaseLabel !== expectedReleaseId) errors.push(`${place}: Pod template label is ${releaseLabel}, expected ${expectedReleaseId}`);
  if ((deployment.status?.readyReplicas ?? 0) < (deployment.spec?.replicas ?? 1)) errors.push(`${place}: not all desired replicas are Ready`);
}

const pods = JSON.parse(kubectl('get', 'pods', '-n', namespace, '-o', 'json'));
for (const pod of pods.items ?? []) {
  if (pod.metadata?.deletionTimestamp || ['Succeeded', 'Failed'].includes(pod.status?.phase)) continue;
  const containers = appContainers(pod.spec);
  if (!containers.length) continue;
  const place = `${pod.metadata.namespace}/${pod.metadata.name}`;
  if (pod.status?.phase !== 'Running') errors.push(`${place}: Pod phase is ${pod.status?.phase ?? 'unknown'}`);
  for (const container of containers) {
    validateImage(container.image, `${place}/${container.name}`);
    const status = [...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.containerStatuses ?? [])].find(item => item.name === container.name);
    if (pod.spec?.containers?.some(item => item.name === container.name) && !status?.ready) errors.push(`${place}/${container.name}: container is not Ready`);
    if (pod.spec?.containers?.some(item => item.name === container.name)) {
      try {
        const actual = kubectl('-n', pod.metadata.namespace, 'exec', pod.metadata.name, '-c', container.name, '--', 'printenv', 'COKE_GROK_RELEASE_ID').trim();
        if (actual !== expectedReleaseId) errors.push(`${place}/${container.name}: runtime release ID is ${actual || 'missing'}, expected ${expectedReleaseId}`);
      } catch {
        errors.push(`${place}/${container.name}: runtime release ID could not be read`);
      }
    }
  }
  const label = pod.metadata?.labels?.['coke-grok-bot.io/release-id'];
  if (label && label !== expectedReleaseId) errors.push(`${place}: Pod label is ${label}, expected ${expectedReleaseId}`);
}
}

for (const name of requiredImages) {
  if (!observations.some(entry => imageParts(entry.image).name === name)) errors.push(`No active Pod or Deployment found for ${name}`);
}
if (errors.length) {
  process.stderr.write(`Release consistency FAILED for ${expectedReleaseId}:\n${errors.map(error => `- ${error}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`Release consistency PASSED: ${expectedReleaseId}\n`);
for (const item of observations) process.stdout.write(`- ${item.place}: ${item.image}\n`);
