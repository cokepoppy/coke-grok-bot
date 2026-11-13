import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
import { mysqlTestCredentials } from './helpers/mysql-test-credentials.ts';
import {TenantStore,type Session} from '../src/server/tenant-store.ts';
import {BotStore} from '../src/server/bot-store.ts';
import {RunStore} from '../src/server/run-store.ts';
import {ApprovalStore} from '../src/server/approval-store.ts';
const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);if(!port)throw new Error('Disposable MySQL port required');
const mysqlCredentials = mysqlTestCredentials(port);
test('per-action approvals stay disabled and legacy pending rows cannot be decided or consumed',async()=>{
 const db=`grok_approval_${randomUUID().replaceAll('-','')}`,admin=await mysql.createConnection(mysqlCredentials);await admin.query(`CREATE DATABASE \`${db}\``);
 const pool=mysql.createPool({...mysqlCredentials,database:db,timezone:'Z',connectionLimit:8});
 try{
  const ids=new TenantStore(pool);await ids.migrate();const bots=new BotStore(pool);await bots.migrate();const runs=new RunStore(pool);await runs.migrate();const approvals=new ApprovalStore(pool);await approvals.migrate();await approvals.migrate();
  const session=async (subject:string):Promise<Session>=>({...await ids.signInGoogle({subject,email:`${subject}@example.test`,name:subject}),email:`${subject}@example.test`,name:subject,role:'owner'});
  const a=await session('alice'),b=await session('bob'),bot=await bots.create(a,{name:'Bot',shape:'round',color:'#abcdef'}),run=await runs.create(a,bot.id,randomUUID(),'task');assert.ok(run);
  const claim=await runs.claimNext(a,30);assert.ok(claim);
  assert.equal(await approvals.propose(run.id,claim.leaseId,'send example',20),null,'the active runtime cannot create new approval cards');
  assert.deepEqual(await approvals.list(a,run.id),[]);
  assert.equal(await approvals.list(b,run.id),null);

  const legacyId=randomUUID(),legacyAction=JSON.stringify({kind:'browser',action:'click'}),legacyHash='a'.repeat(64);
  await pool.execute(`INSERT INTO run_approvals (id,run_id,action_text,action_hash,status,expires_at) VALUES (?,?,?,?,'pending',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 300 SECOND))`,[legacyId,run.id,legacyAction,legacyHash]);
  await pool.execute('INSERT INTO approval_screenshots (approval_id,image) VALUES (?,?)',[legacyId,Buffer.from([137,80,78,71,13,10,26,10])]);
  const legacy=(await approvals.list(a,run.id))?.find(item=>item.id===legacyId);assert.equal(legacy?.status,'expired','legacy pending rows are never presented as actionable approvals');assert.equal(legacy?.hasScreenshot,false);
  assert.equal(await approvals.status(run.id,claim.leaseId,legacyId),'expired');
  assert.equal(await approvals.decide(a,legacyId,'approved'),'conflict');
  assert.equal(await approvals.consume(run.id,claim.leaseId,legacyId,legacyAction),false);
  assert.equal(await approvals.expirePending(),1,'runtime startup retires legacy pending rows');
  const [rows]=await pool.execute<import('mysql2/promise').RowDataPacket[]>('SELECT status FROM run_approvals WHERE id=?',[legacyId]);assert.equal(rows[0]?.status,'expired');
  const [screenshots]=await pool.execute<import('mysql2/promise').RowDataPacket[]>('SELECT approval_id FROM approval_screenshots WHERE approval_id=?',[legacyId]);assert.equal(screenshots.length,0);
 }finally{await pool.end();await admin.query(`DROP DATABASE \`${db}\``);await admin.end()}
});
