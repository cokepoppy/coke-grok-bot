import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
import {TenantStore,type Session} from '../src/server/tenant-store.ts';
import {BotStore} from '../src/server/bot-store.ts';
import {RunStore} from '../src/server/run-store.ts';
import {ApprovalStore} from '../src/server/approval-store.ts';
const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);if(!port)throw new Error('Disposable MySQL port required');
test('approval is owner-scoped, action-bound, leased and consumable only once',async()=>{
 const db=`grok_approval_${randomUUID().replaceAll('-','')}`,admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);
 const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:db,timezone:'Z',connectionLimit:8});
 try{
  const ids=new TenantStore(pool);await ids.migrate();const bots=new BotStore(pool);await bots.migrate();const runs=new RunStore(pool);await runs.migrate();const approvals=new ApprovalStore(pool);await approvals.migrate();await approvals.migrate();
  const session=async (subject:string):Promise<Session>=>({...await ids.signInGoogle({subject,email:`${subject}@example.test`,name:subject}),email:`${subject}@example.test`,name:subject,role:'owner'});
  const a=await session('alice'),b=await session('bob'),bot=await bots.create(a,{name:'Bot',shape:'round',color:'#abcdef'}),run=await runs.create(a,bot.id,randomUUID(),'task');assert.ok(run);
  const claim=await runs.claimNext(a,30);assert.ok(claim);
  assert.equal(await approvals.propose(run.id,randomUUID(),'send example',20),null);
  const proposal=await approvals.propose(run.id,claim.leaseId,'send example',20);assert.ok(proposal);
  assert.equal(await approvals.list(b,run.id),null);assert.equal(await approvals.decide(b,proposal.id,'approved'),'not_found');
  assert.equal(await approvals.consume(run.id,claim.leaseId,proposal.id,'send example'),false);
  assert.equal(await approvals.decide(a,proposal.id,'approved'),'decided');
  assert.equal(await approvals.consume(run.id,claim.leaseId,proposal.id,'other action'),false);
  const concurrent=await Promise.all([approvals.consume(run.id,claim.leaseId,proposal.id,'send example'),approvals.consume(run.id,claim.leaseId,proposal.id,'send example')]);assert.equal(concurrent.filter(Boolean).length,1);
  assert.equal(await approvals.decide(a,proposal.id,'denied'),'conflict');assert.equal((await approvals.list(a,run.id))?.[0].status,'consumed');
  const denied=await approvals.propose(run.id,claim.leaseId,'deny me',20);assert.ok(denied);assert.equal(await approvals.decide(a,denied.id,'denied'),'decided');assert.equal(await approvals.consume(run.id,claim.leaseId,denied.id,'deny me'),false);
  const expiring=await approvals.propose(run.id,claim.leaseId,'expired',1);assert.ok(expiring);await new Promise(resolve=>setTimeout(resolve,1200));assert.equal(await approvals.decide(a,expiring.id,'approved'),'conflict');assert.equal((await approvals.list(a,run.id))?.find(x=>x.id===expiring.id)?.status,'expired');
  const stale=await approvals.propose(run.id,claim.leaseId,'stale run',20);assert.ok(stale);assert.equal(await approvals.decide(a,stale.id,'approved'),'decided');await runs.markUnknown(run.id,claim.leaseId);assert.equal(await approvals.consume(run.id,claim.leaseId,stale.id,'stale run'),false);
 }finally{await pool.end();await admin.query(`DROP DATABASE \`${db}\``);await admin.end()}
});
