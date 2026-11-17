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

test('DSH forwards worker envelope errors without turning them into an approval', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL;
  const oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1';
  process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
    if (path.endsWith('/computer/actions')) return Response.json({ error: 'Action rejected', diagnostic: { code: 'COMPUTER_ACTION_INVALID' }, privateValue: 'do-not-forward' }, { status: 400 });
    throw new Error('Unexpected computer route');
  };
  try {
    const browser = mount().tools.get('computer_browser');
    await assert.rejects(browser.execute({ action: 'click', by: 'role', role: 'link', target: 'Business Rules' }, { signal: new AbortController().signal }), error => {
      assert.match(error.message, /worker rejected the computer action envelope/i);
      assert.match(error.message, /allowlists are disabled/i);
      assert.doesNotMatch(error.message, /approval|do-not-forward/i);
      return true;
    });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
  }
});

test('DSH browser control clicks execute directly without approval polling', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL;
  const oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1';
  process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    if (path.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
    if (path.endsWith('/computer/actions')) return Response.json({ status: 'completed', result: { ready: true, action: 'click', url: 'https://example.test/' } }, { status: 201 });
    throw new Error('Unexpected computer route');
  };
  try {
    const { tools } = mount();
    const browser = tools.get('computer_browser');
    assert.ok(browser);
    const value = await browser.execute({ action: 'click', by: 'role', role: 'link', target: 'Docs' }, { signal: new AbortController().signal });
    assert.equal(value.action, 'click');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.find(call => call.path.endsWith('/computer/actions'))?.body, { action: { kind: 'browser', action: 'click', by: 'role', role: 'link', target: 'Docs' } });
    assert.ok(calls.every(call => call.path.endsWith('/computer/control') || call.path.endsWith('/computer/actions')));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
  }
});

test('DSH passes arbitrary link schemes and browser fields through unchanged', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL;
  const oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1';
  process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, body: init.body ? JSON.parse(init.body) : undefined });
    if (path.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
    if (path.endsWith('/computer/actions')) return Response.json({ status: 'completed', result: { ready: true } }, { status: 201 });
    throw new Error('Unexpected computer route');
  };
  try {
    const browser = mount().tools.get('computer_browser');
    await browser.execute({ action: 'click', by: 'href', target: 'custom-link://app/window', extra: { trace: true } }, { signal: new AbortController().signal });
    assert.deepEqual(calls.find(call => call.path.endsWith('/computer/actions'))?.body, {
      action: { kind: 'browser', action: 'click', by: 'href', target: 'custom-link://app/window', extra: { trace: true } },
    });
    assert.equal(browser.parameters.properties.action.enum, undefined);
    assert.equal(browser.parameters.additionalProperties, true);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
  }
});

test('DSH desktop accepts arbitrary key names and extra action fields', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL;
  const oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1';
  process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  const calls = [], key = `VendorKey+XF86AudioMute+${'CUSTOM'.repeat(1000)}`;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, body: init.body ? JSON.parse(init.body) : undefined });
    if (path.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
    if (path.endsWith('/computer/actions')) return Response.json({ status: 'completed', result: { ready: true } }, { status: 201 });
    throw new Error('Unexpected computer route');
  };
  try {
    const desktop = mount().tools.get('computer_desktop');
    await desktop.execute({ action: 'press', key, extensionField: { raw: ['kept'] } }, { signal: new AbortController().signal });
    assert.deepEqual(calls.find(call => call.path.endsWith('/computer/actions'))?.body, {
      action: { kind: 'desktop', action: 'press', key, extensionField: { raw: ['kept'] } },
    });
    assert.equal(desktop.parameters.properties.action.enum, undefined);
    assert.equal(desktop.parameters.additionalProperties, true);
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
    assert.match(browser.description, /available for every live Bot task lease across sites, URL schemes, keys, and controls/i);
    assert.match(browser.description, /Stop only when a real sign-in or human-verification challenge appears/i);
    assert.match(browser.description, /navigate, reload, open tabs, and use controls as the task requires/i);
    assert.match(browser.description, /choose Take control/i);
    assert.match(browser.description, /do not claim control transferred/i);
    assert.match(browser.description, /reuse an existing signed-in session when it is the right context/i);
    assert.match(browser.description, /without guessing account routes/i);
    assert.match(browser.description, /After takeover, inspect the same computer and resume from its current state/i);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
  }
});

test('DSH browser action forwards an explicitly identified same-user task artifact', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL;
  const oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1';
  process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  const calls = [], taskId = '8faf80b9-752d-42f1-86fc-38bdaa0e4bc9';
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    if (path.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
    if (path.endsWith('/computer/actions')) return Response.json({ status: 'completed', result: { ready: true, url: `file:///workspace/tasks/${taskId}/artifacts/bse-demo/index.html`, title: 'BSE Demo' } }, { status: 201 });
    throw new Error('Cross-task preview must use the direct browser-task completion path');
  };
  try {
    const browser = mount().tools.get('computer_browser');
    const value = await browser.execute({ action: 'open_artifact', artifactTaskId: taskId, path: 'artifacts/bse-demo/index.html' }, { signal: new AbortController().signal });
    assert.equal(value.action, 'open_artifact');
    assert.deepEqual(calls.find(call => call.path.endsWith('/computer/actions'))?.body, { action: { kind: 'browser', action: 'open_artifact', artifactTaskId: taskId, path: 'artifacts/bse-demo/index.html' } });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
  }
});

test('DSH Browser User uploads a same-user task artifact through the live page file input without approval polling', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL;
  const oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1';
  process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  const calls = [], taskId = '8faf80b9-752d-42f1-86fc-38bdaa0e4bc9';
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    if (path.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
    if (path.endsWith('/computer/actions')) return Response.json({ status: 'completed', result: { ready: true, action: 'upload_file', title: 'GitHub' } }, { status: 201 });
    throw new Error('A direct file upload must not create or poll an approval');
  };
  try {
    const { tools } = mount(), browser = tools.get('computer_browser');
    const value = await browser.execute({ action: 'upload_file', artifactTaskId: taskId, path: 'artifacts/bse-demo/index.html', by: 'css', target: 'input[type="file"]' }, { signal: new AbortController().signal });
    assert.equal(value.action, 'upload_file');
    assert.deepEqual(calls.find(call => call.path.endsWith('/computer/actions'))?.body, { action: { kind: 'browser', action: 'upload_file', artifactTaskId: taskId, path: 'artifacts/bse-demo/index.html', by: 'css', target: 'input[type="file"]' } });
    assert.equal(calls.length, 2, 'only check control and perform the requested upload');
    assert.match(browser.description, /input\[type="file"\]/i);
    assert.match(browser.description, /do not access host files/i);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
  }
});

test('DSH surfaces fixed Auth diagnostics without forwarding response text',async()=>{
 const oldUrl=process.env.COKE_GROK_COMPUTER_BRIDGE_URL,oldToken=process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN,oldFetch=globalThis.fetch;
 process.env.COKE_GROK_COMPUTER_BRIDGE_URL='https://gateway.example.test/v1';process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN=bridgeToken;
 const calls=[];
 globalThis.fetch=async(url,init={})=>{
  const path=new URL(String(url)).pathname;calls.push({path,method:init.method||'GET'});
  if(path.endsWith('/computer/control'))return Response.json({owner:'agent'});
  if(path.endsWith('/computer/actions'))return Response.json({error:'Service unavailable',diagnostic:{code:'COMPUTER_WORKER_REQUEST_BODY_INVALID',status:400},message:'private URL and credential detail'},{status:503});
  throw new Error('A direct navigation diagnostic must not be polled or executed');
 };
 try{
  const browser=mount().tools.get('computer_browser');
  await assert.rejects(browser.execute({action:'navigate',url:'https://example.test/'},{signal:new AbortController().signal}),/Computer action failed: COMPUTER_WORKER_REQUEST_BODY_INVALID/);
  assert.equal(calls.filter(call=>call.path.endsWith('/computer/actions')).length,1);
  assert.equal(calls.length,2,'one control check and one direct-navigation request; never retry or poll');
 }finally{
  globalThis.fetch=oldFetch;
  if(oldUrl===undefined)delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL;else process.env.COKE_GROK_COMPUTER_BRIDGE_URL=oldUrl;
  if(oldToken===undefined)delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN=oldToken;
 }
});

test('DSH Computer User can click Chrome and type in its address bar without approval', async () => {
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
    if (path.endsWith('/computer/actions')) return Response.json({ status: 'completed', result: { ready: true, url: 'https://mail.google.com/' } }, { status: 201 });
    throw new Error('A direct desktop action must not be polled or retried');
  };
  try {
    const { tools } = mount(), desktop = tools.get('computer_desktop');
    const result = await desktop.execute({ action: 'click', x: 295, y: 90 }, { signal: new AbortController().signal });
    assert.match(result.text, /https:\/\/mail\.google\.com/);
    assert.equal(calls.filter(call => call.path.endsWith('/computer/actions')).length, 1);
    assert.equal(calls.length, 1, 'the live task lease checks ownership atomically with the direct computer action');
    assert.match(desktop.description, /Chrome tabs and the address bar are ordinary computer controls/i);
    assert.match(desktop.description, /Browser User and Computer User actions needed for the task run without per-step or per-site approval/i);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
  }
});

test('DSH Browser User and Computer User pass arbitrary key names without a schema length cap', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL;
  const oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1';
  process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  const actions = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
    if (path.endsWith('/computer/actions')) {
      actions.push(JSON.parse(init.body).action);
      return Response.json({ status: 'completed', result: { ready: true } }, { status: 201 });
    }
    throw new Error('Unexpected computer route');
  };
  try {
    const { tools } = mount();
    const desktop = tools.get('computer_desktop');
    const browser = tools.get('computer_browser');
    const key = `XF86_${'CUSTOM'.repeat(100)}`;
    assert.equal(desktop.parameters.properties.action.enum, undefined);
    assert.equal(browser.parameters.properties.action.enum, undefined);
    assert.equal(desktop.parameters.additionalProperties, true);
    assert.equal(browser.parameters.additionalProperties, true);
    await desktop.execute({ action: 'press', key }, { signal: new AbortController().signal });
    await browser.execute({ action: 'press', by: 'label', target: 'Search', key }, { signal: new AbortController().signal });
    assert.equal(actions[0].key, key);
    assert.equal(actions[1].key, key);
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

test('DSH computer plugin fails closed instead of polling legacy approval ids', async () => {
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
    await assert.rejects(browser.execute({ action: 'navigate', url: 'https://example.test/' }, { signal: new AbortController().signal }), /Worker did not confirm that the computer action ran/);
    assert.equal(proposals, 1,'stale approval responses are not polled or executed');
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

test('DSH terminal runs a task command without a per-command approval', async () => {
  const oldUrl = process.env.COKE_GROK_COMPUTER_BRIDGE_URL, oldToken = process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN;
  const oldWorkspace = process.env.COKE_GROK_WORKSPACE_ROOT, oldFetch = globalThis.fetch;
  const root = await mkdtemp(join(tmpdir(), 'dsh-terminal-'));
  process.env.COKE_GROK_COMPUTER_BRIDGE_URL = 'https://gateway.example.test/v1'; process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = bridgeToken;
  process.env.COKE_GROK_WORKSPACE_ROOT = root;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname; calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    if (path.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
    throw new Error('Unexpected computer route');
  };
  try {
    const terminal = mount().tools.get('computer_terminal'); assert.ok(terminal);
    const result = await terminal.execute({ command: 'printf DSH_TERMINAL_OK > result.txt', directory: 'shared' }, { signal: new AbortController().signal });
    assert.match(result.text, /"exitCode":0/);
    assert.equal(await readFile(join(root, 'shared', 'result.txt'), 'utf8'), 'DSH_TERMINAL_OK');
    assert.deepEqual(calls.map(call => call.path), ['/v1/computer/control']);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_URL; else process.env.COKE_GROK_COMPUTER_BRIDGE_URL = oldUrl;
    if (oldToken === undefined) delete process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN; else process.env.COKE_GROK_COMPUTER_BRIDGE_TOKEN = oldToken;
    if (oldWorkspace === undefined) delete process.env.COKE_GROK_WORKSPACE_ROOT; else process.env.COKE_GROK_WORKSPACE_ROOT = oldWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});
