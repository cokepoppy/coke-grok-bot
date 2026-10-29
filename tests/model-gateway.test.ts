import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ModelGateway } from '../src/server/model-gateway.ts';

const fakeKey = 'fake-sensitive-key-for-test';
const model = 'deepseek-v4.1-flash';
test('run capability limits model routing and redacts secrets across streaming chunks', async () => {
  let calls = 0;
  const upstream: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), 'https://example.test/compatible-mode/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${fakeKey}`);
    assert.equal((JSON.parse(String(init?.body)) as { max_tokens: number }).max_tokens, 8192);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encoder.encode('prefix fake-sensi'));
      controller.enqueue(encoder.encode('tive-key-for-test suffix'));
      controller.close();
    } });
    return new Response(stream, { status: 200 });
  };
  const gateway = new ModelGateway(fakeKey, 'https://example.test/compatible-mode/v1', model, upstream);
  const server = gateway.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  const url = `http://127.0.0.1:${address.port}/v1/chat/completions`;
  const token = gateway.issue({ ttlMs: 10000, calls: 1 });
  const call = (capability: string, body: unknown) => fetch(url, { method: 'POST', headers: { authorization: `Bearer ${capability}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const payload = { model, messages: [{ role:'user', content:'hello' }], stream:true };
  try {
    assert.equal((await call('invalid', payload)).status, 401);
    assert.equal((await call(token, { ...payload, model:'other' })).status, 400);
    assert.equal((await call(token, { ...payload, max_tokens:8193 })).status, 400);
    const result = await call(token, payload);
    assert.equal(result.status, 200);
    assert.equal(await result.text(), 'prefix [redacted] suffix');
    assert.equal((await call(token, payload)).status, 401);
    assert.equal(calls, 1);
  } finally { gateway.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('revocation and expiry prevent use; upstream errors are not disclosed', async () => {
  const gateway = new ModelGateway(fakeKey, 'https://example.test/compatible-mode/v1', model, async () => new Response(fakeKey, { status: 401 }));
  const server = gateway.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  const url = `http://127.0.0.1:${address.port}/v1/chat/completions`;
  const call = (token: string) => fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({model,messages:[{role:'user',content:'hello'}]}) });
  try {
    const revoked = gateway.issue({ ttlMs: 1000, calls: 1 }); gateway.revoke(revoked);
    assert.equal((await call(revoked)).status,401);
    const expired = gateway.issue({ ttlMs: 1, calls: 1 }); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await call(expired)).status,401);
    const token = gateway.issue({ ttlMs: 1000, calls: 1 });
    const response = await call(token); assert.equal(response.status,502);
    assert.equal((await response.text()).includes(fakeKey), false);
  } finally { gateway.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
