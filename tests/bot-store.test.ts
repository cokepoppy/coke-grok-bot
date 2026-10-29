import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { TenantStore, type Session } from '../src/server/tenant-store.ts';
import { BotStore } from '../src/server/bot-store.ts';

const port = Number(process.env.COKE_GROK_TEST_MYSQL_PORT);
if (!port) throw new Error('Set COKE_GROK_TEST_MYSQL_PORT to a disposable local MySQL instance.');
test('personal bots persist and are scoped to tenant and owner', async () => {
  const database = `grok_bot_test_${randomUUID().replaceAll('-', '')}`;
  const admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root' });
  await admin.query(`CREATE DATABASE \`${database}\``);
  const pool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', database, timezone: 'Z' });
  try {
    const identities = new TenantStore(pool); await identities.migrate();
    const store = new BotStore(pool); await store.migrate(); await store.migrate();
    const a = await identities.signInGoogle({ subject: 'a', email: 'a@example.test', name: 'A' });
    const b = await identities.signInGoogle({ subject: 'b', email: 'b@example.test', name: 'B' });
    const session = (x: typeof a): Session => ({ ...x, email: 'test@example.test', name: 'Test', role: 'owner' });
    const bot = await store.create(session(a), { name: ' Maya ', color: '#ABC123', shape: 'hex' });
    assert.equal(bot.name, 'Maya'); assert.equal(bot.color, '#abc123');
    assert.deepEqual(await store.list(session(a)), [bot]); assert.deepEqual(await store.list(session(b)), []);
    assert.equal(await store.rename(session(b), bot.id, 'Intruder'), false);
    assert.equal(await store.rename(session(a), bot.id, 'Renamed'), true);
    assert.equal((await store.list(session(a)))[0].name, 'Renamed');
    await assert.rejects(store.create(session(a), { name: '', color: '#abc123', shape: 'hex' }));
    await assert.rejects(store.create(session(a), { name: 'X', color: 'red', shape: 'hex' }));
    await assert.rejects(store.create(session({ userId: a.userId, tenantId: b.tenantId }), { name: 'X', color: '#abc123', shape: 'hex' }));
  } finally { await pool.end(); await admin.query(`DROP DATABASE \`${database}\``); await admin.end(); }
});
