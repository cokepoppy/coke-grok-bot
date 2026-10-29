import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
import {TenantStore,type Session} from '../src/server/tenant-store.ts';
import {BotStore} from '../src/server/bot-store.ts';
import {RunStore} from '../src/server/run-store.ts';
import {ApprovalStore} from '../src/server/approval-store.ts';
import {ComputerBroker,type ComputerState} from '../src/server/computer-broker.ts';
const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);if(!port)throw new Error('Disposable MySQL port required');
test('computer broker denies unapproved, changed and repeated operations',async()=>{
 const db=`grok_computer_gate_${randomUUID().replaceAll('-','')}`,admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:db,timezone:'Z',connectionLimit:8});
 try{
  const ids=new TenantStore(pool);await ids.migrate();const bots=new BotStore(pool);await bots.migrate();const runs=new RunStore(pool);await runs.migrate();const approvals=new ApprovalStore(pool);await approvals.migrate();
  const identity=await ids.signInGoogle({subject:'broker',email:'broker@example.test',name:'Broker'}),session:Session={...identity,email:'broker@example.test',name:'Broker',role:'owner'},bot=await bots.create(session,{name:'B',shape:'round',color:'#abcdef'}),run=await runs.create(session,bot.id,randomUUID(),'task');assert.ok(run);const claim=await runs.claimNext(session,30);assert.ok(claim);
  let current:ComputerState={owner:'agent',url:'https://example.test/path',screenshotSha256:'a'.repeat(64)},effects=0;
  const broker=new ComputerBroker(approvals,{snapshot:async()=>({...current}),performIfUnchanged:async (_input,expected)=>{assert.deepEqual(expected,current);effects++;return 'performed'}}),signal=new AbortController().signal;
  const action={kind:'browser',action:'click',by:'role',role:'button',target:'Submit'},proposal=await broker.propose(run.id,claim.leaseId,action,signal);
  await assert.rejects(broker.execute(run.id,claim.leaseId,proposal.id,action,signal));assert.equal(effects,0);
  assert.equal(await approvals.decide(session,proposal.id,'approved'),'decided');
  await assert.rejects(broker.execute(run.id,claim.leaseId,proposal.id,{...action,target:'Delete'},signal));
  current={...current,screenshotSha256:'b'.repeat(64)};await assert.rejects(broker.execute(run.id,claim.leaseId,proposal.id,action,signal));
  current={...current,screenshotSha256:'a'.repeat(64),owner:'user'};await assert.rejects(broker.execute(run.id,claim.leaseId,proposal.id,action,signal));
  current={...current,owner:'agent'};
  const attempts=await Promise.allSettled([broker.execute(run.id,claim.leaseId,proposal.id,action,signal),broker.execute(run.id,claim.leaseId,proposal.id,action,signal)]);
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);assert.equal(effects,1);
  const denied=await broker.propose(run.id,claim.leaseId,action,signal);assert.equal(await approvals.decide(session,denied.id,'denied'),'decided');await assert.rejects(broker.execute(run.id,claim.leaseId,denied.id,action,signal));assert.equal(effects,1);
 }finally{await pool.end();await admin.query(`DROP DATABASE \`${db}\``);await admin.end()}
});
