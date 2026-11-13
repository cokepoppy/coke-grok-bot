import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
import { mysqlTestCredentials } from './helpers/mysql-test-credentials.ts';
import {TenantStore,type Session} from '../src/server/tenant-store.ts';
import {BotStore} from '../src/server/bot-store.ts';
import {RunStore} from '../src/server/run-store.ts';
import {ApprovalStore} from '../src/server/approval-store.ts';
import {ComputerBroker,type ComputerState} from '../src/server/computer-broker.ts';
import {SafeDiagnosticError} from '../src/server/safe-diagnostics.ts';
const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);if(!port)throw new Error('Disposable MySQL port required');
const mysqlCredentials = mysqlTestCredentials(port);
test('legacy ComputerBroker cannot create or execute per-action approvals',async()=>{
 const db=`grok_computer_gate_${randomUUID().replaceAll('-','')}`,admin=await mysql.createConnection(mysqlCredentials);await admin.query(`CREATE DATABASE \`${db}\``);const pool=mysql.createPool({...mysqlCredentials,database:db,timezone:'Z',connectionLimit:8});
 try{
  const ids=new TenantStore(pool);await ids.migrate();const bots=new BotStore(pool);await bots.migrate();const runs=new RunStore(pool);await runs.migrate();const approvals=new ApprovalStore(pool);await approvals.migrate();
  const identity=await ids.signInGoogle({subject:'broker',email:'broker@example.test',name:'Broker'}),session:Session={...identity,email:'broker@example.test',name:'Broker',role:'owner'},bot=await bots.create(session,{name:'B',shape:'round',color:'#abcdef'}),run=await runs.create(session,bot.id,randomUUID(),'task');assert.ok(run);const claim=await runs.claimNext(session,30);assert.ok(claim);
  let current:ComputerState={owner:'agent',url:'https://example.test/path',screenshotSha256:'a'.repeat(64)},effects=0;
  const broker=new ComputerBroker(approvals,{snapshot:async()=>({...current}),performIfUnchanged:async()=>{effects++;return 'performed'}}),signal=new AbortController().signal;
  const action={kind:'browser',action:'click',by:'role',role:'button',target:'Submit'};
  await assert.rejects(broker.propose(run.id,claim.leaseId,action,signal),/Per-action approvals are disabled/);
  await assert.rejects(broker.execute(run.id,claim.leaseId,randomUUID(),action,signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_APPROVAL_REJECTED');
  assert.equal(effects,0);
  const [rows]=await pool.execute<import('mysql2/promise').RowDataPacket[]>('SELECT COUNT(*) AS count FROM run_approvals');assert.equal(Number(rows[0]?.count),0);
 }finally{await pool.end();await admin.query(`DROP DATABASE \`${db}\``);await admin.end()}
});
