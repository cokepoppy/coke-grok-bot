import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import mysql from 'mysql2/promise';
import {TenantStore,type Session} from '../src/server/tenant-store.ts';
import {BotStore} from '../src/server/bot-store.ts';
import {RunStore} from '../src/server/run-store.ts';
import {ApprovalStore} from '../src/server/approval-store.ts';
import {ModelGateway} from '../src/server/model-gateway.ts';
const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);if(!port)throw new Error('Disposable MySQL port required');
test('internal approval capability is bound to a live run and exact action',async()=>{
 const db=`grok_gate_${randomUUID().replaceAll('-','')}`,admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:db,timezone:'Z'});
 const ids=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool),approvals=new ApprovalStore(pool);await ids.migrate();await bots.migrate();await runs.migrate();await approvals.migrate();
 const gateway=new ModelGateway('fake-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'),approvals),server=gateway.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No gateway');const base=`http://127.0.0.1:${address.port}/v1/action-approvals`;
 try{
  const identity=await ids.signInGoogle({subject:'approval',email:'approval@example.test',name:'Approval'}),session:Session={...identity,email:'approval@example.test',name:'Approval',role:'owner'};
  const bot=await bots.create(session,{name:'A',shape:'round',color:'#abcdef'}),run=await runs.create(session,bot.id,randomUUID(),'work');assert.ok(run);const claim=await runs.claimNext(session,30);assert.ok(claim);
  const token=gateway.issue({ttlMs:30000,calls:1,scope:{runId:run.id,leaseId:claim.leaseId}}),other=gateway.issue({ttlMs:30000,calls:1,scope:{runId:randomUUID(),leaseId:randomUUID()}}),unscoped=gateway.issue({ttlMs:30000,calls:1});
  const call=(path:string,cap:string,body?:unknown)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${cap}`,...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  assert.equal((await call('',unscoped,{action:'send'})).status,404);assert.equal((await call('',other,{action:'send'})).status,409);
  const proposed=await call('',token,{action:'Send test action'});assert.equal(proposed.status,201);const {id}=await proposed.json() as {id:string};
  assert.equal((await call(`/${id}`,other)).status,404);assert.equal((await (await call(`/${id}`,token)).json() as {status:string}).status,'pending');
  assert.equal((await call(`/${id}/consume`,token,{action:'Send test action'})).status,409);assert.equal(await approvals.decide(session,id,'approved'),'decided');
  assert.equal((await call(`/${id}/consume`,token,{action:'Different action'})).status,409);
  const attempts=await Promise.all([call(`/${id}/consume`,token,{action:'Send test action'}),call(`/${id}/consume`,token,{action:'Send test action'})]);assert.deepEqual(attempts.map(x=>x.status).sort(),[200,409]);
  gateway.revoke(token);assert.equal((await call(`/${id}`,token)).status,401);
 }finally{gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();await admin.query(`DROP DATABASE \`${db}\``);await admin.end()}
});
