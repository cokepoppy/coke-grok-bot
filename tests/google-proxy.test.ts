import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { GoogleIdentityProvider, parseGoogleProxy } from '../src/server/google-auth.ts';

test('Google OAuth proxy validates configuration and does not retry code exchange', async () => {
  assert.equal(parseGoogleProxy(''), '');
  assert.equal(parseGoogleProxy(' http://127.0.0.1:8080/ '), 'http://127.0.0.1:8080');
  for (const value of ['socks5://localhost:1080', 'http://user:pass@localhost:8080', 'http://localhost:8080/path', 'http://localhost:8080/?x=y']) assert.throws(() => parseGoogleProxy(value));
  let requests = 0;
  const proxy = createServer();
  proxy.on('connect', (_req, socket) => { requests++; socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  const port = (proxy.address() as import('node:net').AddressInfo).port;
  try {
    const provider = new GoogleIdentityProvider('test-client', 'test-secret', 'http://localhost/callback', `http://127.0.0.1:${port}`);
    await assert.rejects(provider.exchange('one-use-test-code', 'test-verifier'));
    assert.equal(requests, 1, 'a failed token exchange must not retry a one-use code');
  } finally { await new Promise<void>(resolve => proxy.close(() => resolve())); }
});

test('Google authorization URL includes the configured callback and OIDC protections', () => {
  const provider = new GoogleIdentityProvider('synthetic-client', 'synthetic-secret', 'https://example.test/grok-bot/auth/google/callback');
  const url = new URL(provider.authorizationUrl('state-value', 'nonce-value', 'challenge-value'));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('client_id'), 'synthetic-client');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.test/grok-bot/auth/google/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'state-value');
  assert.equal(url.searchParams.get('nonce'), 'nonce-value');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-value');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.deepEqual(new Set(url.searchParams.get('scope')!.split(' ')), new Set(['openid', 'email', 'profile']));
});
