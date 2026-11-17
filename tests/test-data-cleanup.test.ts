import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { mysqlTestCredentials } from './helpers/mysql-test-credentials.ts';
import { TenantStore, type Session } from '../src/server/tenant-store.ts';
import { BotStore } from '../src/server/bot-store.ts';
import { RunStore } from '../src/server/run-store.ts';
import { GroupChatStore } from '../src/server/group-chat-store.ts';
import { BotMemoryStore } from '../src/server/bot-memory-store.ts';
import { TestDataCleanupStore, validateTestDataCleanupRequest } from '../src/server/test-data-cleanup-store.ts';

const port = Number(process.env.COKE_GROK_TEST_MYSQL_PORT);
if (!port) throw new Error('Set COKE_GROK_TEST_MYSQL_PORT to a disposable local MySQL instance.');
const mysqlCredentials = mysqlTestCredentials(port);

test('test cleanup previews exact owner-scoped fixtures, blocks active/unselected work, and preserves unrelated Bots', async () => {
  const database = `grok_cleanup_${randomUUID().replaceAll('-', '')}`;
  const admin = await mysql.createConnection(mysqlCredentials);
  await admin.query(`CREATE DATABASE \`${database}\``);
  const pool = mysql.createPool({ ...mysqlCredentials, database, timezone: 'Z', connectionLimit: 8 });
  try {
    const tenants = new TenantStore(pool), bots = new BotStore(pool), runs = new RunStore(pool), groups = new GroupChatStore(pool);
    await tenants.migrate(); await bots.migrate(); await runs.migrate(); await groups.migrate(); await new BotMemoryStore(pool).migrate();
    const owner = await tenants.signInGoogle({ subject: 'cleanup-owner', email: 'cleanup-owner@example.test', name: 'Cleanup owner' });
    const otherOwner = await tenants.signInGoogle({ subject: 'cleanup-other', email: 'cleanup-other@example.test', name: 'Other owner' });
    const session = (identity: typeof owner): Session => ({ ...identity, email: 'fixture@example.test', name: 'Fixture', role: 'owner' });
    const ownerSession = session(owner), otherSession = session(otherOwner);
    const first = await bots.create(ownerSession, { name: 'E2E Test Bot 1', color: '#123456', shape: 'round' });
    const second = await bots.create(ownerSession, { name: 'E2E Test Bot 2', color: '#654321', shape: 'hex' });
    const keep = await bots.create(ownerSession, { name: 'Long-term Bot', color: '#abcdef', shape: 'oval' });
    const foreign = await bots.create(otherSession, { name: 'E2E Test Bot 3', color: '#abcdef', shape: 'oval' });
    const groupId = randomUUID(), outsideGroupId = randomUUID(), turnId = randomUUID(), runId = randomUUID();
    await pool.execute('INSERT INTO bot_group_chats (id,tenant_id,owner_id,request_id,name) VALUES (?,?,?,?,?)', [groupId, owner.tenantId, owner.userId, randomUUID(), 'E2E Group Results']);
    await pool.execute('INSERT INTO bot_group_members (group_id,bot_id,position) VALUES (?,?,?),(?,?,?)', [groupId, first.id, 0, groupId, second.id, 1]);
    await pool.execute('INSERT INTO bot_group_turns (id,group_id,request_id,prompt) VALUES (?,?,?,?)', [turnId, groupId, randomUUID(), 'A test-only group prompt']);
    await pool.execute("INSERT INTO bot_group_messages (id,group_id,turn_id,sender_type,message_text) VALUES (?,?,?,'user',?)", [randomUUID(), groupId, turnId, 'A test-only message']);
    await pool.execute("INSERT INTO bot_messages (id,bot_id,message_role,message_text) VALUES (?,?, 'user', ?),(?,?, 'user', ?)", [randomUUID(), first.id, 'test prompt', randomUUID(), keep.id, 'keep this history']);
    await pool.execute("INSERT INTO agent_runs (id,bot_id,request_id,prompt,status,result) VALUES (?,?,?,?,'queued',NULL)", [runId, first.id, randomUUID(), 'Queued test task']);

    const cleanup = new TestDataCleanupStore(pool);
    assert.deepEqual(validateTestDataCleanupRequest({ botNamePrefixes: [' E2E Test Bot ', 'E2E Test Bot'], groupNamePrefixes: [] }), { botNamePrefixes: ['E2E Test Bot'], groupNamePrefixes: [] });
    assert.throws(() => validateTestDataCleanupRequest({ botNamePrefixes: [], groupNamePrefixes: [] }));
    const blockedPlan = await cleanup.preview(ownerSession, { botNamePrefixes: ['E2E Test Bot'], groupNamePrefixes: ['E2E Group'] });
    assert.deepEqual(blockedPlan.bots.map(bot => bot.id).sort(), [first.id, second.id].sort());
    assert.equal(blockedPlan.groups.length, 1);
    assert.equal(blockedPlan.counts.botMessages, 1);
    assert.equal(blockedPlan.counts.groupMessages, 1);
    assert.equal(blockedPlan.workspaceFilesTouched, false);
    assert.ok(blockedPlan.blockers.some(blocker => blocker.includes('queued or running')));
    await assert.rejects(cleanup.apply(ownerSession, { botNamePrefixes: ['E2E Test Bot'], groupNamePrefixes: ['E2E Group'] }), /queued or running/);

    await pool.execute("UPDATE agent_runs SET status='completed',result='done' WHERE id=?", [runId]);
    await pool.execute('INSERT INTO bot_group_chats (id,tenant_id,owner_id,request_id,name) VALUES (?,?,?,?,?)', [outsideGroupId, owner.tenantId, owner.userId, randomUUID(), 'Existing Team Chat']);
    await pool.execute('INSERT INTO bot_group_members (group_id,bot_id,position) VALUES (?,?,?),(?,?,?)', [outsideGroupId, first.id, 0, outsideGroupId, keep.id, 1]);
    const outsideGroupPlan = await cleanup.preview(ownerSession, { botNamePrefixes: ['E2E Test Bot'], groupNamePrefixes: ['E2E Group'] });
    assert.ok(outsideGroupPlan.blockers.some(blocker => blocker.includes('group that was not selected')));
    await assert.rejects(cleanup.apply(ownerSession, { botNamePrefixes: ['E2E Test Bot'], groupNamePrefixes: ['E2E Group'] }), /group that was not selected/);

    const selectedPlan = await cleanup.preview(ownerSession, { botNamePrefixes: ['E2E Test Bot'], groupNamePrefixes: ['E2E Group', 'Existing Team Chat'] });
    assert.deepEqual(selectedPlan.blockers, []);
    await cleanup.apply(ownerSession, { botNamePrefixes: ['E2E Test Bot'], groupNamePrefixes: ['E2E Group', 'Existing Team Chat'] });
    const [remainingBots] = await pool.execute<mysql.RowDataPacket[]>('SELECT id FROM bots WHERE id IN (?,?,?,?) ORDER BY id', [first.id, second.id, keep.id, foreign.id]);
    assert.deepEqual(remainingBots.map(row => String(row.id)).sort(), [keep.id, foreign.id].sort());
    const [remainingMessages] = await pool.execute<mysql.RowDataPacket[]>('SELECT bot_id FROM bot_messages WHERE bot_id IN (?,?)', [first.id, keep.id]);
    assert.deepEqual(remainingMessages.map(row => String(row.bot_id)), [keep.id]);
    const [remainingGroups] = await pool.execute<mysql.RowDataPacket[]>('SELECT id FROM bot_group_chats WHERE id IN (?,?)', [groupId, outsideGroupId]);
    assert.equal(remainingGroups.length, 0);
  } finally {
    await pool.end();
    await admin.query(`DROP DATABASE \`${database}\``);
    await admin.end();
  }
});
