/** Disposable K3D Browser User and Computer User test without model/API calls. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { desktopIdentity, desktopResources } from '../src/server/desktop-resources.ts';

const context = 'k3d-tp1121-sandbox-dev';
const image = process.env.COKE_GROK_DESKTOP_TEST_IMAGE;
if (!image) throw new Error('Pinned desktop test image is required');

const temp = await mkdtemp(join(tmpdir(), 'grok-desktop-worker-test-'));
const identity = desktopIdentity({ tenantId: randomUUID(), userId: randomUUID() }, randomBytes(32));
const [screenA, screenB] = [randomUUID(), randomUUID()];
let created = false;
let forward: ChildProcess | undefined;
let forwardStderr = '';
let stage = 'initialize';
let lastScreenState: { screenId: string; title: string; text: string; url: string; visibleH1?: string[] } | undefined;

async function exec(command: string, args: string[], input?: string, timeout = 120_000) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { out = (out + chunk).slice(-100_000); });
  child.stderr.on('data', chunk => { err = (err + chunk).slice(-10_000); });
  child.stdin.end(input);
  const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
  try {
    const [code] = await once(child, 'close') as [number | null];
    return { code: code ?? 1, out, err };
  } finally { clearTimeout(timer); }
}

async function kubectl(args: string[], input?: string, timeout?: number) {
  const result = await exec('kubectl', ['--context', context, ...args], input, timeout);
  if (result.code !== 0) throw new Error(`Kubernetes command failed: ${args.slice(0, 3).join(' ')}`);
  return result.out.trim();
}

function locateYellow(bytes: Buffer) {
  const { width, height, data } = PNG.sync.read(bytes);
  let count = 0, sumX = 0, sumY = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    if (data[index] === 255 && data[index + 1] === 230 && data[index + 2] === 20) {
      count++; sumX += x; sumY += y;
    }
  }
  assert.ok(count > 100, 'computer screenshot should contain the yellow input target');
  return { x: Math.round(sumX / count), y: Math.round(sumY / count), width, height };
}

function containsColor(bytes: Buffer, color: [number, number, number]) {
  const { width, height, data } = PNG.sync.read(bytes);
  let count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    if (data[index] === color[0] && data[index + 1] === color[1] && data[index + 2] === color[2]) count++;
  }
  return count > 100;
}

let workerPort = 0;
async function worker(path: string, screenId: string, body?: unknown) {
  try {
    return await fetch(`http://127.0.0.1:${workerPort}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${identity.workerToken}`,
        'x-coke-grok-screen-id': screenId,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const cause = error instanceof Error && 'cause' in error ? (error as Error & { cause?: { code?: string } }).cause : undefined;
    throw new Error(`${path} ${body && typeof body === 'object' && 'action' in body ? String((body as { action: unknown }).action) : ''} socket failure (${cause?.code || 'unknown'})`, { cause: error });
  }
}

async function expectStatus(response: Response, expected: number, action: string) {
  if (response.status === expected) return;
  const detail = (await response.text()).slice(0, 500);
  throw new Error(`${action} expected HTTP ${expected}, got ${response.status}${detail ? `: ${detail}` : ''}`);
}

try {
  stage = 'verify K3D context';
  assert.equal((await kubectl(['config', 'current-context'])).trim(), context);
  stage = 'create ephemeral TLS fixture';
  const cert = join(temp, 'cert.pem'), privateKey = join(temp, 'key.pem');
  const certResult = await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', privateKey, '-out', cert, '-days', '1', '-subj', '/CN=host.k3d.internal', '-addext', 'subjectAltName=DNS:host.k3d.internal']);
  assert.equal(certResult.code, 0, 'temporary K3D test certificate should be created');
  stage = 'create isolated desktop namespace';
  const resources = desktopResources(identity, { image, controlNamespace: 'coke-grok-bot', gatewayCA: await readFile(cert, 'utf8') });
  await kubectl(['apply', '-f', '-'], JSON.stringify(resources[0]));
  created = true;
  await kubectl(['apply', '-f', '-'], JSON.stringify({ apiVersion: 'v1', kind: 'List', items: resources.slice(1) }));
  stage = 'wait for isolated desktop rollout';
  await kubectl(['-n', identity.namespace, 'rollout', 'status', 'deployment/desktop', '--timeout=150s'], undefined, 160_000);

  stage = 'start local browser fixture in isolated Pod';
  const pod = await kubectl(['-n', identity.namespace, 'get', 'pods', '-l', 'app=grok-desktop', '-o', 'jsonpath={.items[0].metadata.name}']);
  const fixturePath = `/tmp/grok-screen-fixture-${randomUUID()}.cjs`;
  const artifactTaskId = randomUUID();
  const uploadArtifactPath = `/workspace/tasks/${artifactTaskId}/artifacts/upload-check.txt`;
  await kubectl(['-n', identity.namespace, 'exec', pod, '-c', 'agent', '--', 'node', '-e', `require('node:fs').mkdirSync(require('node:path').dirname(${JSON.stringify(uploadArtifactPath)}),{recursive:true});require('node:fs').writeFileSync(${JSON.stringify(uploadArtifactPath)},'GROK_UPLOAD_FILE_OK')`]);
  const fixtureHtml = `<!doctype html><title>SCREEN_LABEL</title><h1>SCREEN_LABEL</h1>
    <div id="screen-marker" style="position:fixed;right:20px;top:20px;width:180px;height:90px;background:SCREEN_COLOR;color:#fff;font:24px sans-serif">SCREEN_LABEL</div>
    <button onclick="document.getElementById('browser').textContent='BROWSER_CLICK_OK'">Mark complete</button><p id="browser">WAITING</p>
    <label for="file-upload">Upload fixture file</label><input id="file-upload" aria-label="Upload fixture file" type="file"><p id="uploaded">WAITING</p><script>document.getElementById('file-upload').addEventListener('change',async event=>{const file=event.target.files[0];document.getElementById('uploaded').textContent=file.name+':'+await file.text()})</script>
    <form onsubmit="event.preventDefault();document.getElementById('computer').textContent='COMPUTER_INPUT_OK'"><input aria-label="Desktop input" oninput="document.getElementById('typed').textContent=this.value" style="position:fixed;left:120px;top:180px;width:360px;height:54px;background:rgb(255,230,20);font:24px sans-serif"><button type="submit" style="position:fixed;left:520px;top:180px;width:200px;height:54px;background:#155ab5;color:white">Submit</button></form>
    <p id="typed"></p>
    <p id="computer">WAITING</p><p id="shared"></p><script>const key='grok-shared',cookie='grok-shared=ok',had=localStorage.getItem(key)==='ok'&&document.cookie.split('; ').includes(cookie);if(localStorage.getItem(key)!=='ok')localStorage.setItem(key,'ok');if(!document.cookie.split('; ').includes(cookie))document.cookie=cookie+'; path=/';document.getElementById('shared').textContent=had?'SHARED_STATE_OK':'SHARED_STATE_INIT'</script>`;
  const fixture = `const http=require('node:http');const html=${JSON.stringify(fixtureHtml)};http.createServer((req,res)=>{if(req.url==='/healthz'){res.writeHead(204);return res.end()}const a=req.url==='/a';const label=a?'BOT_A_SCREEN':'BOT_B_SCREEN';const color=a?'rgb(230, 20, 140)':'rgb(20, 140, 230)';res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html.replaceAll('SCREEN_LABEL',label).replaceAll('SCREEN_COLOR',color))}).listen(18111,'0.0.0.0')`;
  await kubectl(['-n', identity.namespace, 'exec', pod, '-c', 'agent', '--', 'node', '-e', `require('node:fs').writeFileSync(${JSON.stringify(fixturePath)},${JSON.stringify(fixture)})`]);
  await kubectl(['-n', identity.namespace, 'exec', pod, '-c', 'agent', '--', 'sh', '-c', `nohup node ${fixturePath} >/tmp/grok-screen-fixture.log 2>&1 </dev/null &`]);

  let fixtureReady = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const probe = await kubectl(['-n', identity.namespace, 'exec', pod, '-c', 'agent', '--', 'node', '-e', "fetch('http://127.0.0.1:18111/healthz',{signal:AbortSignal.timeout(500)}).then(r=>process.stdout.write(String(r.status))).catch(()=>process.exitCode=1)"]).catch(() => '');
    if (probe === '204') { fixtureReady = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(fixtureReady, true, 'disposable fixture should listen inside the shared Pod network');

  stage = 'start Worker port-forward';
  forward = spawn('kubectl', ['--context', context, '-n', identity.namespace, 'port-forward', 'service/desktop', ':8082'], { stdio: ['ignore', 'pipe', 'pipe'] });
  forward.stdout?.setEncoding('utf8');
  forward.stderr?.setEncoding('utf8');
  forward.stderr?.on('data', chunk => { forwardStderr = (forwardStderr + chunk).slice(-4000); });
  const portLine = await new Promise<string>((resolve, reject) => {
    let output = '';
    forward!.stdout!.on('data', chunk => {
      output += String(chunk);
      if (/127\.0\.0\.1:\d+ -> 8082/.test(output)) resolve(output);
    });
    forward!.once('exit', code => reject(new Error(`Worker port-forward exited (${code})`)));
    setTimeout(() => reject(new Error(`Worker port-forward timeout ${forwardStderr.slice(-200)}`)), 15_000).unref();
  });
  workerPort = Number(portLine.match(/127\.0\.0\.1:(\d+) -> 8082/)?.[1]);
  assert.ok(workerPort > 0);
  stage = 'check Worker readiness';
  const ready = await fetch(`http://127.0.0.1:${workerPort}/readyz`, { signal: AbortSignal.timeout(15_000) });
  assert.equal(ready.status, 200, 'Worker and Chromium should be ready over port-forward');

  const navigate = async (screenId: string, path: string) => {
    stage = `Browser User navigate ${path}`;
    const response = await worker('/v1/browser', screenId, { action: 'navigate', url: `http://127.0.0.1:18111/${path}` });
    await expectStatus(response, 200, `Browser User navigate ${path}`);
  };
  await navigate(screenA, 'a');
  await navigate(screenB, 'b');
  const inspect = async (screenId: string) => {
    stage = 'Browser User inspect';
    const response = await worker('/v1/browser', screenId, { action: 'inspect' });
    await expectStatus(response, 200, 'Browser User inspect');
    const state = await response.json() as { title: string; text: string; url: string; visibleH1: string[] };
    lastScreenState = { screenId, ...state };
    return state;
  };
  const [initialA, initialB] = await Promise.all([inspect(screenA), inspect(screenB)]);
  assert.equal(initialA.title, 'BOT_A_SCREEN');
  assert.equal(initialB.title, 'BOT_B_SCREEN');
  assert.deepEqual(initialA.visibleH1, ['BOT_A_SCREEN']);
  assert.deepEqual(initialB.visibleH1, ['BOT_B_SCREEN']);
  assert.ok(initialB.text.includes('SHARED_STATE_OK'), 'Bots for one user should share the browser profile');

  stage = 'Browser User click';
  const browserClick = await worker('/v1/browser', screenA, { action: 'click', by: 'role', role: 'button', target: 'Mark complete' });
  await expectStatus(browserClick, 200, 'Browser User click');
  assert.ok((await inspect(screenA)).text.includes('BROWSER_CLICK_OK'));

  stage = 'Browser User uploads an artifact through the webpage file input';
  const upload = await worker('/v1/browser', screenA, { action: 'upload_file', taskId: artifactTaskId, path: 'artifacts/upload-check.txt', by: 'css', target: 'input[type="file"][aria-label="Upload fixture file"]' });
  await expectStatus(upload, 200, stage);
  let uploadState = await inspect(screenA);
  for (let attempt = 0; attempt < 20 && !uploadState.text.includes('upload-check.txt:GROK_UPLOAD_FILE_OK'); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    uploadState = await inspect(screenA);
  }
  assert.ok(uploadState.text.includes('upload-check.txt:GROK_UPLOAD_FILE_OK'), 'the real browser page should receive the isolated task file through input[type=file]');

  stage = 'capture two 1440x900 Bot screenshots';
  const images = await Promise.all([screenA, screenB].map(screenId => worker('/v1/screenshot', screenId)));
  assert.ok(images.every(response => response.status === 200 && response.headers.get('content-type') === 'image/png'));
  const screenshotBytes = await Promise.all(images.map(response => response.arrayBuffer().then(bytes => Buffer.from(bytes))));
  assert.ok(containsColor(screenshotBytes[0], [230, 20, 140]), 'Bot A computer screenshot should show Bot A foreground page pixels');
  assert.equal(containsColor(screenshotBytes[0], [20, 140, 230]), false, 'Bot A computer screenshot must not show Bot B foreground page pixels');
  assert.ok(containsColor(screenshotBytes[1], [20, 140, 230]), 'Bot B computer screenshot should show Bot B foreground page pixels');
  assert.equal(containsColor(screenshotBytes[1], [230, 20, 140]), false, 'Bot B computer screenshot must not show Bot A foreground page pixels');
  const screenPoints = await Promise.all(screenshotBytes.map(async bytes => {
    const point = locateYellow(bytes);
    assert.deepEqual([point.width, point.height], [1440, 900]);
    return point;
  }));
  const userAction = async (screenId: string, point: ReturnType<typeof locateYellow>) => {
    stage = `Computer User take control ${screenId}`;
    await expectStatus(await worker('/v1/control', screenId, { owner: 'user' }), 200, stage);
    stage = `Computer User click ${screenId} (${point.x},${point.y})`;
    await expectStatus(await worker('/v1/commands', screenId, { action: 'click', x: point.x, y: point.y, actor: 'user' }), 200, stage);
    stage = `Computer User type ${screenId}`;
    await expectStatus(await worker('/v1/commands', screenId, { action: 'type', text: 'K3D_COMPUTER_USER_OK', actor: 'user' }), 200, stage);
    stage = `Computer User press Enter ${screenId}`;
    await expectStatus(await worker('/v1/commands', screenId, { action: 'press', key: 'Enter', actor: 'user' }), 200, stage);
    stage = `Computer User return control ${screenId}`;
    await expectStatus(await worker('/v1/control', screenId, { owner: 'agent' }), 200, stage);
    stage = `Computer User verify ${screenId}`;
    const state = await inspect(screenId);
    assert.ok(state.text.includes('K3D_COMPUTER_USER_OK'), `Computer User text should reach the selected Bot screen; observed page text: ${JSON.stringify(state.text)}`);
    assert.ok(state.text.includes('COMPUTER_INPUT_OK'), `Computer User Enter should submit the selected Bot screen form; observed page text: ${JSON.stringify(state.text)}`);
  };
  stage = 'Computer User dual-screen control and input';
  await Promise.all([userAction(screenA, screenPoints[0]), userAction(screenB, screenPoints[1])]);
  stage = 'Bot-scoped takeover isolation';
  assert.equal((await worker('/v1/control', screenA, { owner: 'user' })).status, 200);
  assert.equal((await worker('/v1/browser', screenA, { action: 'inspect' })).status, 400, 'Agent actions should stop during user takeover');
  assert.equal((await inspect(screenB)).title, 'BOT_B_SCREEN', 'Bot B should remain usable during Bot A takeover');
  assert.equal((await worker('/v1/control', screenA, { owner: 'agent' })).status, 200);

  console.log('Worker K3D test passed: separate Bot screens, shared browser profile, browser click and artifact upload, Computer User input, screenshots, takeover, and cross-Bot isolation; no model calls.');
} catch (error) {
  console.error(`Last test stage: ${stage}`);
  if (lastScreenState) console.error(`Last inspected screen: ${JSON.stringify({ ...lastScreenState, text: lastScreenState.text.slice(0, 600) })}`);
  if (forwardStderr) console.error(`Worker port-forward stderr: ${forwardStderr.slice(-1000)}`);
  if (created) {
    const podsJson = await kubectl(['-n', identity.namespace, 'get', 'pods', '-o', 'json']).catch(() => '');
    if (podsJson) {
      const podInfo = JSON.parse(podsJson).items.map((pod: any) => ({ name: pod.metadata.name, containers: pod.status.containerStatuses?.map((container: any) => ({ name: container.name, restarts: container.restartCount, ready: container.ready, reason: container.state?.terminated?.reason || container.lastState?.terminated?.reason || '' })) }));
      console.error(`Test pod state: ${JSON.stringify(podInfo)}`);
      const pod = podInfo.find((item: any) => item.name)?.name;
      if (pod) for (const container of ['desktop', 'agent']) {
        const logs = await kubectl(['-n', identity.namespace, 'logs', pod, '-c', container, '--tail=30']).catch(() => '');
        if (logs) console.error(`Test ${container} startup log: ${logs.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]').slice(-1800)}`);
      }
    }
  }
  const message = error instanceof Error ? error.message : 'unknown';
  const cause = error instanceof Error && 'cause' in error ? (error as Error & { cause?: { code?: string } }).cause?.code : undefined;
  throw new Error(`Desktop Worker K3D test failed at ${stage} on port ${workerPort || 'unassigned'} (${cause || 'no-cause-code'}): ${message}`, { cause: error });
} finally {
  if (forward) { forward.kill('SIGTERM'); await once(forward, 'exit').catch(() => {}); }
  if (created) await kubectl(['delete', 'namespace', identity.namespace, '--wait=true', '--timeout=90s'], undefined, 100_000);
  await rm(temp, { recursive: true, force: true });
}
