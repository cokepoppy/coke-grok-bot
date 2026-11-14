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
    assert.deepEqual(await store.workspaces({userId:a.userId}),[{tenantId:a.tenantId,name:"A's workspace",tenantType:'personal',role:'owner',memberCount:1}]);
    const personalToken=hash('a-personal');await store.createSession(personalToken,a.userId,a.tenantId,new Date(Date.now()+60000));
    const teamTenantId=await store.createTeamWorkspace(token,(await store.getSession(token))!, 'Product team');
    assert.equal((await store.getSession(token))?.tenantId,teamTenantId,'creating a team workspace switches only the active session');
    assert.equal((await store.getSession(personalToken))?.tenantId,a.tenantId,'a second session remains in the personal workspace');
    const personalSession=await store.getSession(personalToken)!;
    await assert.rejects(store.createTeamWorkspace(token,(await store.getSession(token))!, 'Nested team'),/personal-workspace-required/);
    const secondTeamTenantId=await store.createTeamWorkspace(personalToken,personalSession,'Research team');
    assert.notEqual(secondTeamTenantId,teamTenantId,'one owner can create multiple team workspaces');
    const listed=await store.workspaces({userId:a.userId});
    assert.deepEqual(listed.map(item=>item.tenantType).sort(),['personal','team','team']);
    assert.equal((await store.getSession(personalToken))?.tenantId,secondTeamTenantId);
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

test('tenant migration preserves legacy teams while adding a personal workspace',async()=>{
  const database=`grok_legacy_${randomUUID().replaceAll('-','')}`;
  const admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root',timezone:'Z'});await admin.query(`CREATE DATABASE \`${database}\``);
  const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database,timezone:'Z',connectionLimit:4});
  try{
    await pool.execute(`CREATE TABLE users (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, issuer VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, subject VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, email VARCHAR(320) NOT NULL, name VARCHAR(255) NOT NULL, UNIQUE KEY identity_key (issuer, subject)) ENGINE=InnoDB`);
    await pool.execute(`CREATE TABLE tenants (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, name VARCHAR(255) NOT NULL, owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, UNIQUE KEY personal_owner (owner_id), FOREIGN KEY (owner_id) REFERENCES users(id)) ENGINE=InnoDB`);
    await pool.execute(`CREATE TABLE memberships (tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, role ENUM('owner','admin','member') NOT NULL, PRIMARY KEY (tenant_id, user_id), FOREIGN KEY (tenant_id) REFERENCES tenants(id), FOREIGN KEY (user_id) REFERENCES users(id)) ENGINE=InnoDB`);
    const ownerId='00000000-0000-4000-8000-000000000001',memberId='00000000-0000-4000-8000-000000000002',tenantId='00000000-0000-4000-8000-000000000003',inviteOwnerId='00000000-0000-4000-8000-000000000004',inviteTenantId='00000000-0000-4000-8000-000000000005',invitationId='00000000-0000-4000-8000-000000000006';
    await pool.execute(`INSERT INTO users (id,issuer,subject,email,name) VALUES (?,'https://accounts.google.com','legacy-owner','legacy@example.test','Legacy Owner'),(?,'https://accounts.google.com','legacy-member','member@example.test','Legacy Member'),(?,'https://accounts.google.com','legacy-invite-owner','invite-owner@example.test','Invite Owner')`,[ownerId,memberId,inviteOwnerId]);
    await pool.execute(`INSERT INTO tenants (id,name,owner_id) VALUES (?, 'Legacy shared workspace', ?)`,[tenantId,ownerId]);
    await pool.execute(`INSERT INTO tenants (id,name,owner_id) VALUES (?, 'Legacy invitation workspace', ?)`,[inviteTenantId,inviteOwnerId]);
    await pool.execute(`INSERT INTO memberships (tenant_id,user_id,role) VALUES (?,?,'owner'),(?,?,'member'),(?,?,'owner')`,[tenantId,ownerId,tenantId,memberId,inviteTenantId,inviteOwnerId]);
    await pool.execute(`CREATE TABLE tenant_invitations (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,invited_email VARCHAR(320) NOT NULL)`);
    await pool.execute(`INSERT INTO tenant_invitations (id,tenant_id,invited_email) VALUES (?,?,?)`,[invitationId,inviteTenantId,'invited@example.test']);
    const store=new TenantStore(pool);await store.migrate();await store.migrate();
    const ownerWorkspaces=await store.workspaces({userId:ownerId});assert.equal(ownerWorkspaces.find(item=>item.tenantId===tenantId)?.tenantType,'team');
    const memberWorkspaces=await store.workspaces({userId:memberId});assert.equal(memberWorkspaces[0]?.tenantType,'team');
    assert.equal((await store.workspaces({userId:inviteOwnerId}))[0]?.tenantType,'team','a legacy workspace with an invitation but one current member is still a team');
    const signedIn=await store.signInGoogle({subject:'legacy-owner',email:'legacy@example.test',name:'Legacy Owner'});
    assert.equal(signedIn.userId,ownerId);assert.notEqual(signedIn.tenantId,tenantId,'legacy team membership is retained and sign-in creates a separate personal workspace');
    assert.deepEqual((await store.workspaces({userId:ownerId})).map(item=>item.tenantType).sort(),['personal','team']);
  }finally{await pool.end();await admin.query(`DROP DATABASE \`${database}\``);await admin.end()}
});
