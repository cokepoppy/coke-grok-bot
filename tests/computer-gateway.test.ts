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
import {ComputerBridge} from '../src/server/computer-bridge.ts';
const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);if(!port)throw new Error('Disposable MySQL port required');
test('computer gateway binds screen and action to one live user run and approval',async()=>{
 const db=`grok_computer_gateway_${randomUUID().replaceAll('-','')}`,admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:db,timezone:'Z',connectionLimit:8});
 const ids=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool),approvals=new ApprovalStore(pool);await ids.migrate();await bots.migrate();await runs.migrate();await approvals.migrate();let effects=0;
 const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>({owner:'agent' as const,url:'https://example.test/',screenshotSha256:'a'.repeat(64)}),inspect:async()=>({ready:true,text:'test page'}),screenshot:async()=>Buffer.from('png test'),performIfUnchanged:async()=>{effects++;return {ready:true}}};
 const bridge=new ComputerBridge(runs,approvals,()=>worker),gateway=new ModelGateway('fake-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'),approvals,bridge),server=gateway.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No gateway');const base=`http://127.0.0.1:${address.port}/v1/computer`;
 try{
  const identity=await ids.signInGoogle({subject:'gateway',email:'gateway@example.test',name:'Gateway'}),session:Session={...identity,email:'gateway@example.test',name:'Gateway',role:'owner'},bot=await bots.create(session,{name:'A',shape:'round',color:'#abcdef'}),run=await runs.create(session,bot.id,randomUUID(),'work');assert.ok(run);const claim=await runs.claimNext(session,30);assert.ok(claim);
  const token=gateway.issue({ttlMs:30000,calls:1,scope:{runId:run.id,leaseId:claim.leaseId,owner:identity}}),wrong=gateway.issue({ttlMs:30000,calls:1,scope:{runId:run.id,leaseId:claim.leaseId,owner:{...identity,userId:randomUUID()}}});
  const call=(path:string,cap:string,body?:unknown)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${cap}`,...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  assert.equal((await call('/inspect',wrong)).status,409);assert.equal((await call('/inspect',token)).status,200);assert.equal((await call('/screenshot',token)).headers.get('content-type'),'image/png');
  const action={kind:'browser',action:'click',by:'role',role:'button',target:'Submit'},proposed=await call('/actions',token,{action});assert.equal(proposed.status,201);const {id}=await proposed.json() as {id:string};
  assert.equal((await call(`/actions/${id}`,wrong)).status,409);assert.equal((await call(`/actions/${id}/execute`,token,{action})).status,409);assert.equal(effects,0);
  assert.equal(await approvals.decide(session,id,'approved'),'decided');
  assert.equal((await call(`/actions/${id}/execute`,token,{action:{...action,target:'Delete'}})).status,409);assert.equal(effects,0);
  assert.equal((await call(`/actions/${id}/execute`,token,{action})).status,200);assert.equal(effects,1);
  assert.equal((await call(`/actions/${id}/execute`,token,{action})).status,409);assert.equal(effects,1);
  await runs.markUnknown(run.id,claim.leaseId);assert.equal((await call('/inspect',token)).status,409);
 }finally{gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();await admin.query(`DROP DATABASE \`${db}\``);await admin.end()}
});
