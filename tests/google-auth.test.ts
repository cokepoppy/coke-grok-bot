import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import mysql from 'mysql2/promise';
import { TenantStore } from '../src/server/tenant-store.ts';
import { GoogleAuthService, type IdentityProvider } from '../src/server/google-auth.ts';
import { createAuthServer } from '../src/server/auth-http.ts';

const port = Number(process.env.COKE_GROK_TEST_MYSQL_PORT);
if (!port) throw new Error('Set COKE_GROK_TEST_MYSQL_PORT to a disposable local MySQL instance.');

test('HTTP OAuth flow binds state, PKCE and nonce, isolates tenants and revokes sessions', async () => {
  const database = `grok_auth_${randomUUID().replaceAll('-', '')}`;
  const admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', timezone: 'Z' });
  await admin.query(`CREATE DATABASE \`${database}\``);
  const pool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', database, timezone: 'Z' });
  const flows = new Map<string, { nonce: string; challenge: string }>();
  let activeState = '';
  const provider: IdentityProvider = {
    authorizationUrl(state, nonce, challenge) { flows.set(state, { nonce, challenge }); return `https://identity.example.test/?state=${state}`; },
    async exchange(code, verifier) {
      const flow = flows.get(activeState)!;
      assert.equal(createHash('sha256').update(verifier).digest('base64url'), flow.challenge);
      return { sub: code, email: `${code}@example.test`, email_verified: code !== 'unverified', name: code, nonce: code === 'badnonce' ? 'wrong' : flow.nonce };
    },
  };
  // Reserve the HTTP port before constructing the origin used by the service.
  const net = await import('node:net');
  const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const httpPort = (reservation.address() as import('node:net').AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const origin = `http://127.0.0.1:${httpPort}`;
  const store = new TenantStore(pool);
  await store.migrate();
  const server = createAuthServer(new GoogleAuthService(store, provider, origin), origin);
  server.listen(httpPort, '127.0.0.1'); await once(server, 'listening');
  const fetchPath = (path: string, options: RequestInit = {}) => fetch(origin + path, { redirect: 'manual', ...options });
  const start = async () => {
    const res = await fetchPath('/api/auth/google/start'); assert.equal(res.status, 302);
    const state = new URL(res.headers.get('location')!).searchParams.get('state')!;
    const cookie = res.headers.get('set-cookie')!.split(';')[0]; return { state, cookie };
  };
  const finish = async (flow: { state: string; cookie: string }, code: string) => {
    activeState = flow.state;
    return fetchPath(`/auth/google/callback?state=${flow.state}&code=${code}`, { headers: { cookie: flow.cookie } });
  };
  try {
    assert.equal((await fetchPath('/api/auth/ready')).status, 204);
    assert.equal((await fetchPath('/api/auth/me')).status, 401);
    const cancelled = await start();
    const cancelResponse = await fetchPath(`/auth/google/callback?state=${cancelled.state}&error=access_denied`, { headers: { cookie: cancelled.cookie } });
    assert.match(cancelResponse.headers.get('location')!, /authError=cancelled/);
    assert.match((await finish(cancelled, 'alice')).headers.get('location')!, /authError=cancelled/);
    const invalid = await start();
    const bad = await fetchPath(`/auth/google/callback?state=${invalid.state}&code=a`, { headers: { cookie: 'coke_grok_oauth_state=wrong' } });
    assert.match(bad.headers.get('location')!, /authError=invalid/);
    const a = await start(); const ar = await finish(a, 'alice');
    assert.equal(ar.headers.get('location'), origin + '/');
    const ac = ar.headers.getSetCookie().find(c => c.startsWith('coke_grok_session='))!.split(';')[0];
    const am = await (await fetchPath('/api/auth/me', { headers: { cookie: ac } })).json() as { tenantId: string; email: string };
    assert.equal(am.email, 'alice@example.test');
    assert.equal((await fetchPath('/api/auth/me', { headers: { cookie: `${ac}; ${ac}` } })).status, 401);
    assert.match((await finish(a, 'alice')).headers.get('location')!, /authError=cancelled/);
    const b = await start(); activeState = b.state;
    const br = await fetchPath(`/auth/google/callback?state=${b.state}&code=bob`, { headers: { cookie: `${b.cookie}; ${ac}` } });
    assert.equal((await fetchPath('/api/auth/me', { headers: { cookie: ac } })).status, 401);
    const bc = br.headers.getSetCookie().find(c => c.startsWith('coke_grok_session='))!.split(';')[0];
    const bm = await (await fetchPath('/api/auth/me', { headers: { cookie: bc } })).json() as { tenantId: string };
    assert.notEqual(am.tenantId, bm.tenantId);
    const nonce = await start(); assert.match((await finish(nonce, 'badnonce')).headers.get('location')!, /authError=invalid_identity/);
    const unverified = await start();
    const rejected = await finish(unverified, 'unverified');
    assert.match(rejected.headers.get('location')!, /authError=invalid_identity/);
    assert.equal(rejected.headers.getSetCookie().some(cookie => cookie.startsWith('coke_grok_session=')), false);
    assert.equal((await fetchPath('/api/auth/me', { headers: { cookie: bc } })).status, 200);
    assert.equal((await fetchPath('/api/auth/logout', { method: 'POST', headers: { cookie: bc, origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetchPath('/api/auth/logout', { method: 'POST', headers: { cookie: bc, origin } })).status, 200);
    assert.equal((await fetchPath('/api/auth/me', { headers: { cookie: ac } })).status, 401);
    assert.equal((await fetchPath('/api/auth/me', { headers: { cookie: bc } })).status, 401);
    await pool.end();
    assert.equal((await fetchPath('/api/auth/ready')).status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end().catch(() => {}); await admin.query(`DROP DATABASE \`${database}\``); await admin.end();
  }
});
