import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { TenantStore } from '../src/server/tenant-store.ts';

const port = Number(process.env.COKE_GROK_TEST_MYSQL_PORT);
if (!port) throw new Error('Set COKE_GROK_TEST_MYSQL_PORT to a disposable local MySQL instance.');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

test('Google subject, membership and one-use OAuth flows remain isolated', async () => {
  const database = `grok_test_${randomUUID().replaceAll('-', '')}`;
  const admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', timezone: 'Z' });
  await admin.query(`CREATE DATABASE \`${database}\``);
  const pool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', database, timezone: 'Z', connectionLimit: 8 });
  try {
    const store = new TenantStore(pool);
    await store.migrate(); await store.migrate();
    const [a, b] = await Promise.all([
      store.signInGoogle({ subject: 'google-a', email: 'a@example.test', name: 'A' }),
      store.signInGoogle({ subject: 'google-b', email: 'b@example.test', name: 'B' }),
    ]);
    assert.notEqual(a.tenantId, b.tenantId);
    const repeat = await store.signInGoogle({ subject: 'google-a', email: 'new@example.test', name: 'A renamed' });
    assert.deepEqual(repeat, a);
    const token = hash('a');
    await store.createSession(token, a.userId, a.tenantId, new Date(Date.now() + 60000));
    assert.deepEqual(await store.getSession(token), { userId: a.userId, tenantId: a.tenantId, email: 'new@example.test', name: 'A renamed', role: 'owner' });
    await assert.rejects(store.createSession(hash('forged'), a.userId, b.tenantId, new Date(Date.now() + 60000)));
    await assert.rejects(store.replaceSession(hash('replacement'), a.userId, b.tenantId, new Date(Date.now() + 60000), token));
    assert.ok(await store.getSession(token), 'failed replacement must preserve the old session');
    await store.replaceSession(hash('replacement'), b.userId, b.tenantId, new Date(Date.now() + 60000), token);
    assert.equal(await store.getSession(token), null);
    assert.equal((await store.getSession(hash('replacement')))?.userId, b.userId);
    await store.removeSession(hash('replacement'));
    await store.removeSession(token); assert.equal(await store.getSession(token), null);
    await store.createSession(token, a.userId, a.tenantId, new Date(Date.now() + 60000));
    await pool.execute('UPDATE sessions SET expires_at=UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE token_hash=?', [token]);
    assert.equal(await store.getSession(token), null);
    const live = hash('live'); await store.createSession(live, b.userId, b.tenantId, new Date(Date.now() + 60000));
    await assert.rejects(pool.execute('DELETE FROM memberships WHERE tenant_id=? AND user_id=?', [b.tenantId, b.userId]));
    assert.ok(await store.getSession(live), 'foreign key must prevent an orphaned active session');
    await pool.execute('UPDATE memberships SET role=? WHERE tenant_id=? AND user_id=?', ['member', b.tenantId, b.userId]);
    assert.equal((await store.getSession(live))?.role, 'member', 'authorization must read the current membership role');
    await store.pruneExpiredAuth();
    const [expiredRows] = await pool.execute<import('mysql2/promise').RowDataPacket[]>('SELECT token_hash FROM sessions WHERE token_hash=?', [token]);
    assert.equal(expiredRows.length, 0); assert.ok(await store.getSession(live));
    const stateHash = hash('state');
    await store.createOAuthFlow({ stateHash, nonce: 'nonce', codeVerifier: 'verifier', expiresAt: new Date(Date.now() + 60000) });
    const results = await Promise.all([store.consumeOAuthFlow(stateHash), store.consumeOAuthFlow(stateHash)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await store.consumeOAuthFlow(stateHash), null);
    await store.createOAuthFlow({ stateHash, nonce: 'nonce', codeVerifier: 'verifier', expiresAt: new Date(Date.now() + 60000) });
    await pool.execute('UPDATE oauth_flows SET expires_at=UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE state_hash=?', [stateHash]);
    assert.equal(await store.consumeOAuthFlow(stateHash), null);
    assert.equal(await store.consumeOAuthFlow(stateHash), null);
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => store.signInGoogle({ subject: 'google-c', email: 'c@example.test', name: 'C' })));
    assert.equal(new Set(concurrent.map(result => result.userId)).size, 1);
    assert.equal(new Set(concurrent.map(result => result.tenantId)).size, 1);
  } finally { await pool.end(); await admin.query(`DROP DATABASE \`${database}\``); await admin.end(); }
});
