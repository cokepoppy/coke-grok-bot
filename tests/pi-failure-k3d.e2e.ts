/** Isolated, opt-in Pi smoke test. No provider response, token or credential is logged. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelGateway } from '../src/server/model-gateway.ts';

const keyFile = process.env.COKE_GROK_MODEL_KEY_FILE;
if (!keyFile) throw new Error('Set COKE_GROK_MODEL_KEY_FILE to the private provider key file.');
const expectedContext = 'k3d-tp1121-sandbox-dev';
const model = 'deepseek-v4.1-flash';
const image = process.env.COKE_GROK_DESKTOP_TEST_IMAGE;
if (!image || !/^coke-grok-desktop:sha-[a-f0-9]{40}$/.test(image)) throw new Error('Pinned test image required');
const namespace = `grok-pi-test-${randomBytes(6).toString('hex')}`;
const temp = await mkdtemp(join(tmpdir(), 'grok-pi-gateway-'));
let requestCount = 0, server: import('node:http').Server | undefined, gateway: ModelGateway | undefined;
let namespaceCreated = false;
async function run(command: string, args: string[], input?: string, timeout = 120_000): Promise<{ code: number; out: string; category: string }> {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  let out = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { out = (out + chunk).slice(-500_000); });
  // Suppress stderr: test inputs and provider diagnostics may contain credentials or capabilities.
  let category='other';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{const s=String(chunk);if(s.includes('invalid task decision status'))category='invalid decision status';else if(s.includes('invalid task decision message'))category=`invalid decision message: ${s.includes('(missing;')?'missing':s.includes('(empty;')?'empty':'wrong type'}; error field ${s.includes('error field present')?'present':'absent'}`;else if(s.includes('structured result'))category='missing structured result';else if(s.includes('Error'))category='adapter error'});child.stdin.end(input);
  const timeoutId = setTimeout(() => child.kill('SIGKILL'), timeout);
  try { const [code] = await once(child, 'close') as [number | null]; return { code: code ?? 1, out,category }; }
  finally { clearTimeout(timeoutId); }
}
async function kubectl(args: string[], input?: string, timeout?: number): Promise<string> {
  const result = await run('kubectl', args, input, timeout);
  if (result.code !== 0) throw new Error(`Kubernetes test command failed: ${args.slice(0, 2).join(' ')}`);
  return result.out;
}
try {
  assert.equal((await kubectl(['config','current-context'])).trim(), expectedContext);
  const cert = join(temp, 'cert.pem'), privateKey = join(temp, 'private.pem');
  const openssl = await run('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',privateKey,'-out',cert,'-days','1','-subj','/CN=host.k3d.internal','-addext','subjectAltName=DNS:host.k3d.internal']);
  if (openssl.code !== 0) throw new Error('Could not create test TLS certificate');
  const key = (await readFile(keyFile, 'utf8')).trim();
  gateway = new ModelGateway(key, 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', model, async (input, init) => { requestCount++; return fetch(input, init); });
  server = gateway.createServer({key:await readFile(privateKey), cert:await readFile(cert)});
  server.listen(0, '0.0.0.0'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test gateway port');
  const capability = gateway.issue({ ttlMs: 240_000, calls: 10 });
  await kubectl(['create','namespace',namespace]); namespaceCreated = true;
  await kubectl(['-n',namespace,'create','configmap','gateway-ca',`--from-file=ca.pem=${cert}`]);
  const pod = { apiVersion:'v1',kind:'Pod',metadata:{name:'pi-smoke'},spec:{
    automountServiceAccountToken:false, restartPolicy:'Never', hostAliases:[{ip:'192.168.65.254',hostnames:['host.k3d.internal']}],
    securityContext:{runAsUser:1000,runAsGroup:1000,fsGroup:1000,runAsNonRoot:true},
    containers:[{name:'pi',image,imagePullPolicy:'Never',command:['sleep','300'],env:[{name:'NODE_EXTRA_CA_CERTS',value:'/run/gateway/ca.pem'}],
      securityContext:{allowPrivilegeEscalation:false,capabilities:{drop:['ALL']}},
      resources:{requests:{cpu:'20m',memory:'128Mi'},limits:{cpu:'1',memory:'768Mi'}},
      volumeMounts:[{name:'work',mountPath:'/workspace'},{name:'gateway-ca',mountPath:'/run/gateway',readOnly:true}]}],
    volumes:[{name:'work',emptyDir:{}},{name:'gateway-ca',configMap:{name:'gateway-ca'}}],
  }};
  await kubectl(['-n',namespace,'apply','-f','-'],JSON.stringify(pod));
  await kubectl(['-n',namespace,'wait','--for=condition=Ready','pod/pi-smoke','--timeout=90s'],undefined,100_000);
  await kubectl(['-n',namespace,'exec','pi-smoke','--','mkdir','-p','/workspace/task']);
  const payload = JSON.stringify({engine:'pi',taskId:'12345678-1234-4234-8234-123456789abc',workspace:'/workspace',cwd:'task',
    prompt:'Read the file /workspace/task/missing-input.txt and report its contents. Do not create the file. If the file does not exist, return only a JSON object with exactly two fields: {"status":"failed","message":"a short explanation"}.',
    modelConfig:{apiKey:capability,baseUrl:`https://host.k3d.internal:${address.port}/v1`,model}});
  const result = await run('kubectl',['-n',namespace,'exec','-i','pi-smoke','--','node','/opt/coke-dots/grok-kernel-adapter.mjs'],payload,230_000);
  if (result.code !== 0) throw new Error(`Pi run failed (${result.category}; provider calls observed: ${requestCount})`);
  let decision: { status?: string }; try { decision = JSON.parse(result.out); } catch { throw new Error('Pi returned an invalid decision'); }
  assert.equal(decision.status,'failed'); assert.ok(requestCount >= 1);
  console.log(`Pi failure K3D smoke passed: real model returned failed for a missing input; ${requestCount} provider request(s).`);
} finally {
  gateway?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (namespaceCreated) await run('kubectl',['delete','namespace',namespace,'--wait=false'],undefined,20_000);
  await rm(temp,{recursive:true,force:true});
}
