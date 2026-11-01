import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
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
    const value = await desktop.execute({ action: 'screenshot' }, { signal: new AbortController().signal });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].mediaType, 'image/png');
    assert.deepEqual([...saved[0].data], [137,80,78,71]);
    assert.equal(value.screenshot, reference);
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

test('DSH browser mutations use one exact approved action and never retry execute', async () => {
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
    if (path.endsWith(`/computer/actions/${approvalId}/execute`)) return Response.json({ ready: true, action: 'navigate', url: 'https://example.test/' });
    throw new Error('Unexpected computer route');
  };
  try {
    const { tools } = mount();
    const browser = tools.get('computer_browser');
    assert.ok(browser);
    const value = await browser.execute({ action: 'navigate', url: 'https://example.test/' }, { signal: new AbortController().signal });
    assert.equal(value.action, 'navigate');
    const executes = calls.filter(call => call.path.endsWith(`/computer/actions/${approvalId}/execute`));
    assert.equal(executes.length, 1);
    assert.deepEqual(calls.find(call => call.path.endsWith('/computer/actions'))?.body, { action: { kind: 'browser', action: 'navigate', url: 'https://example.test/' } });
    assert.ok(calls.some(call => call.method === 'GET' && call.path.endsWith(`/computer/actions/${approvalId}`)));
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
