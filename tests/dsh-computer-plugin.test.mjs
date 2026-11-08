import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../deploy/desktop/dsh-computer-plugin.mjs';

const bridgeToken = randomBytes(32).toString('base64url');

function mount() {
  const tools = new Map();
  const saved = [];
  const reference = { attachmentId: randomUUID(), mediaType: 'image/png', bytes: 1, width: 1, height: 1 };
  const context = {
    tools: { register(tool) { tools.set(tool.name, tool); } },
    get(name) {
      assert.equal(name, 'attachments');
      return { async saveImage(input) { saved.push(input); return reference; } };
    },
  };
  apply(context);
  return { tools, saved, reference };
}

test('DSH computer screenshot becomes a durable model image attachment', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL;
  const oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1';
  process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
    if (path.endsWith('/computer/screenshot')) return new Response(new Uint8Array([137,80,78,71]), { headers: { 'content-type': 'image/png' } });
    throw new Error('Unexpected computer route');
  };
  try {
    const { tools, saved, reference } = mount();
    const desktop = tools.get('computer_desktop');
    assert.ok(desktop);
    assert.match(desktop.description, /full 1440 x 900 screenshot/);
    const value = await desktop.execute({ action: 'screenshot' }, { signal: new AbortController().signal });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].mediaType, 'image/png');
    assert.deepEqual([...saved[0].data], [137,80,78,71]);
    assert.equal(value.screenshot, reference);
    assert.match(value.text, /origin \(0, 0\) at top-left/);
    assert.deepEqual(desktop.output.render({}, value), [
      { type: 'text', text: value.text },
      { type: 'image', attachment: reference },
    ]);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
  }
});

test('DSH browser control clicks use one exact approval and never retry execute', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL;
  const oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1';
  process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  const approvalId = randomUUID(), calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    if (path.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
    if (path.endsWith('/computer/actions')) return Response.json({ id: approvalId });
    if (path.endsWith(`/computer/actions/${approvalId}`)) return Response.json({ status: 'approved' });
    if (path.endsWith(`/computer/actions/${approvalId}/execute`)) return Response.json({ ready: true, action: 'click', url: 'https://example.test/' });
    throw new Error('Unexpected computer route');
  };
  try {
    const { tools } = mount();
    const browser = tools.get('computer_browser');
    assert.ok(browser);
    const value = await browser.execute({ action: 'click', by: 'role', role: 'link', target: 'Docs' }, { signal: new AbortController().signal });
    assert.equal(value.action, 'click');
    const executes = calls.filter(call => call.path.endsWith(`/computer/actions/${approvalId}/execute`));
    assert.equal(executes.length, 1);
    assert.deepEqual(calls.find(call => call.path.endsWith('/computer/actions'))?.body, { action: { kind: 'browser', action: 'click', by: 'role', role: 'link', target: 'Docs' } });
    assert.ok(calls.some(call => call.method === 'GET' && call.path.endsWith(`/computer/actions/${approvalId}`)));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
  }
});

test('DSH direct Gmail navigation consumes an immediate completion without creating an approval', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL;
  const oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1';
  process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  const calls = [], destination = { ready: true, url: 'https://mail.google.com/' };
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    if (path.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
    if (path.endsWith('/computer/actions')) return Response.json({ status: 'completed', result: destination }, { status: 201 });
    throw new Error('Direct Gmail navigation should not poll for or execute an approval');
  };
  try {
    const { tools } = mount(), browser = tools.get('computer_browser');
    const value = await browser.execute({ action: 'navigate', url: 'https://mail.google.com/' }, { signal: new AbortController().signal });
    assert.equal(value.action, 'navigate');
    assert.deepEqual(JSON.parse(value.text), destination);
    assert.equal(calls.filter(call => call.path.endsWith('/computer/actions')).length, 1);
    assert.equal(calls.length, 2, 'only check control and navigate; do not create, poll, or execute an approval');
    assert.match(browser.description, /ordinary HTTP\/HTTPS webpage navigation needed for the owner’s request do not require per-step approval/i);
    assert.match(browser.description, /navigate to the sign-in page, stop, and let the owner take control/i);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
  }
});

test('DSH surfaces a fixed worker screen-capacity diagnostic without forwarding response text',async()=>{
 const oldUrl=process.env.COKE_GROK_COMPUTER_BRIDGE_URL,oldToken=process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN,oldFetch=globalThis.fetch;
 process.env.COKE_GROK_COMPUTER_BRIDGE_URL='https://gateway.example.test/v1';process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN=bridgeToken;
 const calls=[];
 globalThis.fetch=async(url,init={})=>{
  const path=new URL(String(url)).pathname;calls.push({path,method:init.method||'GET'});
  if(path.endsWith('/computer/control'))return Response.json({owner:'agent'});
  if(path.endsWith('/computer/actions'))return Response.json({error:'computer_request_failed',diagnostic:{code:'COMPUTER_SCREEN_CAPACITY',status:503},message:'private URL and credential detail'},{status:409});
  throw new Error('A direct navigation diagnostic must not be polled or executed');
 };
 try{
  const browser=mount().tools.get('computer_browser');
  await assert.rejects(browser.execute({action:'navigate',url:'https://example.test/'},{signal:new AbortController().signal}),/Computer action failed: COMPUTER_SCREEN_CAPACITY/);
  assert.equal(calls.filter(call=>call.path.endsWith('/computer/actions')).length,1);
  assert.equal(calls.length,2,'one control check and one direct-navigation request; never retry or poll');
 }finally{
  globalThis.fetch=oldFetch;
  if(oldUrl===undefined)delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL;else process.env.COKE_GROK_COMPUTER_BRIDGE_URL=oldUrl;
  if(oldToken===undefined)delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN=oldToken;
 }
});

test('DSH routes mistaken desktop navigation to Browser User without showing an approval card', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL;
  const oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1';
  process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, method: init.method || 'GET' });
    if (path.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
    if (path.endsWith('/computer/actions')) return Response.json({ error: 'computer_request_failed', diagnostic: { code: 'COMPUTER_NAVIGATION_USE_BROWSER' } }, { status: 409 });
    throw new Error('A rejected navigation action must not be polled or executed');
  };
  try {
    const { tools } = mount(), desktop = tools.get('computer_desktop');
    await assert.rejects(desktop.execute({ action: 'click', x: 295, y: 90 }, { signal: new AbortController().signal }), /not executed and no approval was requested.*computer_browser\.navigate/i);
    assert.equal(calls.filter(call => call.path.endsWith('/computer/actions')).length, 1);
    assert.equal(calls.length, 1, 'receive the navigation directive without polling or executing an approval');
    assert.match(desktop.description, /desktop input is attempted for browser navigation.*without creating an approval card/i);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
  }
});

test('DSH computer plugin refuses actions when the user owns the screen and rejects an invalid gateway', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL;
  const oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1';
  process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  let proposals = 0;
  globalThis.fetch = async () => { proposals++; return Response.json({ owner: 'user' }); };
  try {
    const { tools } = mount();
    await assert.rejects(tools.get('computer_browser').execute({ action: 'navigate', url: 'https://example.test/' }, { signal: new AbortController().signal }), /owner currently controls/);
    assert.equal(proposals, 1);
    process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'http://gateway.example.test/v1';
    assert.throws(() => mount(), /bridge is not configured/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
  }
});

test('DSH computer plugin does not request the same action again after the owner denies it', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL;
  const oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1';
  process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  let proposals = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
    if (path.endsWith('/computer/actions')) { proposals++; return Response.json({ id: randomUUID() }); }
    if (/\/computer\/actions\/[0-9a-f-]+$/.test(path)) return Response.json({ status: 'denied' });
    throw new Error('Unexpected computer route');
  };
  try {
    const browser = mount().tools.get('computer_browser');
    const action = { action: 'navigate', url: 'https://example.test/' };
    const exec = { signal: new AbortController().signal };
    await assert.rejects(browser.execute(action, exec), /wait for a new user message/);
    await assert.rejects(browser.execute(action, exec), /owner denied a computer action/);
    assert.equal(proposals, 1);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
  }
});

test('DSH exposes only the persistent shared folder to file reads', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL, oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldWorkspace = process.env.COKE_GROK_WORKSPACE_ROOT, oldFetch = globalThis.fetch;
  const root = await mkdtemp(join(tmpdir(), 'dsh-shared-files-'));
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1'; process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  process.env.COKE_GROK_WORKSPACE_ROOT = root;
  await mkdir(join(root, 'shared')); await writeFile(join(root, 'shared', 'brief.md'), 'DSH shared brief');
  globalThis.fetch = async () => Response.json({ owner: 'agent' });
  try {
    const files = mount().tools.get('computer_files'); assert.ok(files);
    const listed = await files.execute({ action: 'list' }, { signal: new AbortController().signal });
    assert.match(listed.text, /brief.md/);
    const read = await files.execute({ action: 'read', path: 'brief.md' }, { signal: new AbortController().signal });
    assert.equal(read.text, 'DSH shared brief');
    await assert.rejects(files.execute({ action: 'read', path: '../brief.md' }, { signal: new AbortController().signal }), /invalid/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
    if (oldWorkspace === undefined) delete process.env.COKE_GROK_WORKSPACE_ROOT; else process.env.COKE_GROK_WORKSPACE_ROOT = oldWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});

test('DSH terminal runs the exact owner-approved command once in the shared folder', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL, oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldWorkspace = process.env.COKE_GROK_WORKSPACE_ROOT, oldFetch = globalThis.fetch;
  const root = await mkdtemp(join(tmpdir(), 'dsh-terminal-'));
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1'; process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  process.env.COKE_GROK_WORKSPACE_ROOT = root;
  const approvalId = randomUUID(), calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname; calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    if (path.endsWith('/computer/actions')) return Response.json({ id: approvalId });
    if (path.endsWith(`/computer/actions/${approvalId}`)) return Response.json({ status: 'approved' });
    if (path.endsWith(`/computer/actions/${approvalId}/execute`)) return Response.json({ approved: true });
    throw new Error('Unexpected computer route');
  };
  try {
    const terminal = mount().tools.get('computer_terminal'); assert.ok(terminal);
    const result = await terminal.execute({ command: 'printf DSH_TERMINAL_OK > result.txt', directory: 'shared' }, { signal: new AbortController().signal });
    assert.match(result.text, /"exitCode":0/);
    assert.equal(await readFile(join(root, 'shared', 'result.txt'), 'utf8'), 'DSH_TERMINAL_OK');
    assert.deepEqual(calls.filter(call => call.path.endsWith('/computer/actions'))[0].body, { action: { kind: 'terminal', action: 'run', command: 'printf DSH_TERMINAL_OK > result.txt', directory: 'shared' } });
    assert.equal(calls.filter(call => call.path.endsWith(`/computer/actions/${approvalId}/execute`)).length, 1);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
    if (oldWorkspace === undefined) delete process.env.COKE_GROK_WORKSPACE_ROOT; else process.env.COKE_GROK_WORKSPACE_ROOT = oldWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});
