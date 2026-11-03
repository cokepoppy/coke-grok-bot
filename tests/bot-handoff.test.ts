import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
import {TenantStore,type Session} from '../src/server/tenant-store.ts';
import {BotStore} from '../src/server/bot-store.ts';
import {RunStore} from '../src/server/run-store.ts';
import {BotHandoffStore} from '../src/server/bot-handoff-store.ts';
import {ModelGateway} from '../src/server/model-gateway.ts';

const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);if(!port)throw new Error('Set COKE_GROK_TEST_MYSQL_PORT to a disposable local MySQL instance.');

test('Bot handoffs queue private real runs, aggregate nested replies, resume the sender and enforce tenant plus lease scope',async()=>{
 const db=`grok_handoff_${randomUUID().replaceAll('-','')}`,admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);
 const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:db,timezone:'Z',connectionLimit:12});
 const identities=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool),handoffs=new BotHandoffStore(pool);let gateway:ModelGateway|undefined,server:import('node:http').Server|undefined;
 try{
  await identities.migrate();await bots.migrate();await runs.migrate();await handoffs.migrate();await handoffs.migrate();
  const owner=await identities.signInGoogle({subject:'handoff-owner',email:'handoff@example.test',name:'Handoff Owner'}),foreignOwner=await identities.signInGoogle({subject:'handoff-other',email:'other@example.test',name:'Other'});
  const session:Session={...owner,email:'handoff@example.test',name:'Handoff Owner',role:'owner'},foreignSession:Session={...foreignOwner,email:'other@example.test',name:'Other',role:'owner'};
  const chief=await bots.create(session,{name:'Chief',label:'Operations',shape:'round',color:'#abcdef'}),sales=await bots.create(session,{name:'Sales Outbound',label:'Research',shape:'round',color:'#fedcba'}),inbox=await bots.create(session,{name:'Inbox Manager',label:'Triage',shape:'round',color:'#123456'}),foreign=await bots.create(foreignSession,{name:'Foreign Bot',shape:'round',color:'#654321'});
  const root=await runs.create(session,chief.id,randomUUID(),'Delegate a harmless research question and report only verified findings.');assert.ok(root);
  const rootClaim=await runs.claimNext({...session,botId:chief.id},30);assert.ok(rootClaim);assert.equal(rootClaim.run.id,root.id);
  gateway=new ModelGateway('fake-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'),undefined,undefined,undefined,handoffs);
  server=gateway.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}/v1/bot-handoffs`,capability=gateway.issue({ttlMs:30000,calls:1,scope:{runId:root.id,leaseId:rootClaim.leaseId,botId:chief.id,owner}});
  const call=(token:string,method='GET',body?:unknown)=>fetch(base,{method,headers:{authorization:`Bearer ${token}`,...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const roster=await call(capability);assert.equal(roster.status,200);assert.deepEqual((await roster.json() as {bots:{id:string}[]}).bots.map(bot=>bot.id),[sales.id,inbox.id]);
  const first=await call(capability,'POST',{targetBotId:sales.id,message:'Find one harmless fact about the official Example Domain page. Do not click links or submit anything.'});assert.equal(first.status,202);
  const firstReceipt=(await first.json() as {handoff:{id:string;targetRunId:string}}).handoff;
  const duplicate=await call(capability,'POST',{targetBotId:sales.id,message:'Find one harmless fact about the official Example Domain page. Do not click links or submit anything.'});assert.equal(duplicate.status,202);assert.equal((await duplicate.json() as {handoff:{id:string}}).handoff.id,firstReceipt.id);
  assert.equal((await call(capability,'POST',{targetBotId:foreign.id,message:'Cross-owner attempt'})).status,409);
  const wrongCapability=gateway.issue({ttlMs:30000,calls:1,scope:{runId:root.id,leaseId:rootClaim.leaseId,botId:sales.id,owner}});assert.equal((await call(wrongCapability)).status,409);
  assert.equal(await handoffs.send({tenantId:owner.tenantId,userId:owner.userId,botId:chief.id,runId:root.id,leaseId:'00000000-0000-4000-8000-000000000000'},{targetBotId:inbox.id,message:'stale lease'}),null);
  assert.equal(await handoffs.send({tenantId:owner.tenantId,userId:owner.userId,botId:chief.id,runId:root.id,leaseId:rootClaim.leaseId},{targetBotId:foreign.id,message:'cross-owner target test'}),null);
  assert.equal(await runs.finish(root.id,rootClaim.leaseId,'completed','I delegated one safe research detail.'),true);

  const salesClaim=await runs.claimNext({...session,botId:sales.id},30);assert.ok(salesClaim);assert.equal(salesClaim.run.id,firstReceipt.targetRunId);assert.match(salesClaim.run.prompt,/Message from Chief:/);assert.match(salesClaim.run.prompt,/private asynchronous task/);
  const nested=await handoffs.send({tenantId:owner.tenantId,userId:owner.userId,botId:sales.id,runId:salesClaim.run.id,leaseId:salesClaim.leaseId},{targetBotId:inbox.id,message:'Independently verify the page title using the Browser User, without clicking or submitting anything.'});assert.ok(nested);assert.equal(nested.targetBotId,inbox.id);
  assert.equal(await runs.finish(salesClaim.run.id,salesClaim.leaseId,'completed','I asked Inbox Manager to verify the page title.'),true);
  const inboxClaim=await runs.claimNext({...session,botId:inbox.id},30);assert.ok(inboxClaim);assert.equal(inboxClaim.run.id,nested.targetRunId);assert.match(inboxClaim.run.prompt,/Message from Sales Outbound:/);
  assert.equal(await runs.finish(inboxClaim.run.id,inboxClaim.leaseId,'completed','Browser User confirms the title is Example Domain; no links were clicked.'),true);
  assert.equal(await handoffs.deliverReplies(),1,'nested response should queue one continuation on Sales Outbound');
  const continuation=await runs.claimNext({...session,botId:sales.id},30);assert.ok(continuation);assert.match(continuation.run.prompt,/asynchronous replies from Bots/);assert.match(continuation.run.prompt,/title is Example Domain/);
  assert.equal(await runs.finish(continuation.run.id,continuation.leaseId,'completed','Inbox Manager verified the title is Example Domain without interacting with links.'),true);
  assert.equal(await handoffs.deliverReplies(),1,'completed delegated work should return to Chief as a private Bot message');
  const returned=await runs.claimNext({...session,botId:chief.id},30);assert.ok(returned);assert.match(returned.run.prompt,/^Message from Sales Outbound:/);assert.match(returned.run.prompt,/title is Example Domain/);
  assert.equal(await runs.finish(returned.run.id,returned.leaseId,'completed','The page title is Example Domain; no links were clicked or forms submitted.'),true);
  const history=await runs.list(session,chief.id);assert.ok(history);assert.ok(history.some(run=>run.id===returned.run.id&&run.prompt.startsWith('Message from Sales Outbound:')));
  const [handoffRows]=await pool.execute<mysql.RowDataPacket[]>('SELECT id,status,parent_handoff_id AS parentId,response_run_id AS responseRunId FROM bot_handoffs ORDER BY created_at,id');
  assert.equal(handoffRows.length,2);assert.equal(handoffRows[0].status,'returned');assert.equal(handoffRows[1].status,'returned');assert.equal(String(handoffRows[1].parentId),String(handoffRows[0].id));assert.ok(handoffRows[0].responseRunId);
 }finally{
  gateway?.close();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await pool.end();await admin.query(`DROP DATABASE \`${db}\``);await admin.end();
 }
});
