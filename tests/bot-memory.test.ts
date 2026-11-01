import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import mysql from 'mysql2/promise';
import {TenantStore,type Session} from '../src/server/tenant-store.ts';
import {BotStore} from '../src/server/bot-store.ts';
import {RunStore} from '../src/server/run-store.ts';
import {BotMemoryStore,containsSensitiveData} from '../src/server/bot-memory-store.ts';
import {BotMemoryBridge} from '../src/server/bot-memory-bridge.ts';
import {ModelGateway} from '../src/server/model-gateway.ts';

const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);if(!port)throw new Error('Disposable MySQL port required');

test('Bot memory is private to its Bot, lease scoped, persistent, editable and removable',async()=>{
 const db=`grok_bot_memory_${randomUUID().replaceAll('-','')}`,admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:db,timezone:'Z',connectionLimit:8});
 try{
  const ids=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool),memories=new BotMemoryStore(pool);await ids.migrate();await bots.migrate();await runs.migrate();await memories.migrate();
  const identity=await ids.signInGoogle({subject:'memory-owner',email:'memory@example.test',name:'Memory Owner'}),other=await ids.signInGoogle({subject:'memory-other',email:'other@example.test',name:'Other'});
  const session:Session={...identity,email:'memory@example.test',name:'Memory Owner',role:'owner'},otherSession:Session={...other,email:'other@example.test',name:'Other',role:'owner'};
  const botA=await bots.create(session,{name:'A',shape:'round',color:'#abcdef'}),botB=await bots.create(session,{name:'B',shape:'round',color:'#abcdef'}),otherBot=await bots.create(otherSession,{name:'Other',shape:'round',color:'#abcdef'});
  const first=await runs.create(session,botA.id,randomUUID(),'Remember that I prefer concise summaries.');assert.ok(first);const firstClaim=await runs.claimNext(session,30);assert.ok(firstClaim);
  const scope={owner:identity,botId:botA.id,runId:first.id,leaseId:firstClaim.leaseId};assert.deepEqual(await memories.list(scope),[]);
  const saved=await memories.remember(scope,'Writing preference','Use concise summaries and include links for source claims.');assert.ok(saved);assert.equal(saved.content,'Use concise summaries and include links for source claims.');
  const duplicate=await memories.remember(scope,'Updated preference','Use concise summaries and include links for source claims.');assert.equal(duplicate?.id,saved.id);assert.equal(duplicate?.title,'Updated preference');assert.equal((await memories.list(scope))?.length,1);
  assert.equal(await memories.list({...scope,owner:other}),null);assert.equal(await memories.list({...scope,botId:botB.id}),null);assert.equal(await memories.remember({...scope,botId:botB.id},'forged','wrong bot'),null);
  assert.equal(await memories.forget(scope,saved.id),true);assert.deepEqual(await memories.list(scope),[]);
  await runs.finish(first.id,firstClaim.leaseId,'completed','saved');
  const second=await runs.create(session,botB.id,randomUUID(),'What do you remember?');assert.ok(second);const secondClaim=await runs.claimNext(session,30);assert.ok(secondClaim);assert.deepEqual(await memories.list({owner:identity,botId:botB.id,runId:second.id,leaseId:secondClaim.leaseId}),[]);
  assert.equal(await memories.remember(scope,'stale','stale lease'),null);
  assert.equal(containsSensitiveData('Save my API key for later'),true);assert.equal(containsSensitiveData('My email is alice@example.com'),true);assert.equal(containsSensitiveData('I work best in the morning'),false);
  await runs.finish(second.id,secondClaim.leaseId,'completed','read');
  const third=await runs.create(otherSession,otherBot.id,randomUUID(),'Remember I prefer short replies.');assert.ok(third);const thirdClaim=await runs.claimNext(otherSession,30);assert.ok(thirdClaim);
  assert.deepEqual(await memories.list({owner:other,botId:otherBot.id,runId:third.id,leaseId:thirdClaim.leaseId}),[]);
 }finally{await pool.end();await admin.query(`DROP DATABASE \`${db}\``);await admin.end()}
});

test('memory gateway allows Bot-chosen memory updates and rejects cross-Bot scope',async()=>{
 const db=`grok_memory_gate_${randomUUID().replaceAll('-','')}`,admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:db,timezone:'Z',connectionLimit:8});
 const ids=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool),memories=new BotMemoryStore(pool);await ids.migrate();await bots.migrate();await runs.migrate();await memories.migrate();const bridge=new BotMemoryBridge(memories);
 const gateway=new ModelGateway('fake-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'),undefined,undefined,bridge),server=gateway.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No gateway');const base=`http://127.0.0.1:${address.port}/v1/bot-memory`;
 try{
  const owner=await ids.signInGoogle({subject:'memory-gateway',email:'gateway@example.test',name:'Gateway'}),session:Session={...owner,email:'gateway@example.test',name:'Gateway',role:'owner'};const bot=await bots.create(session,{name:'A',shape:'round',color:'#abcdef'}),otherBot=await bots.create(session,{name:'B',shape:'round',color:'#abcdef'});const run=await runs.create(session,bot.id,randomUUID(),'Please remember that I prefer short answers.');assert.ok(run);const claim=await runs.claimNext(session,30);assert.ok(claim);
  const token=gateway.issue({ttlMs:30000,calls:2,scope:{runId:run.id,leaseId:claim.leaseId,botId:bot.id,owner}}),wrongBot=gateway.issue({ttlMs:30000,calls:1,scope:{runId:run.id,leaseId:claim.leaseId,botId:otherBot.id,owner}});
  const call=(token:string,method='GET',body?:unknown)=>fetch(base,{method,headers:{authorization:`Bearer ${token}`,...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  assert.equal((await call(token)).status,200);
  const saved=await call(token,'POST',{action:'remember',title:'Preference',content:'Short answers'});assert.equal(saved.status,201);const id=(await saved.json() as {memory:{id:string}}).memory.id;
  assert.equal((await call(token,'POST',{action:'remember',title:'Contact',content:'My email is alice@example.com'})).status,409);assert.equal(((await call(token).then(response=>response.json())) as {memories:unknown[]}).memories.length,1);
  assert.equal((await call(wrongBot)).status,409);assert.equal((await fetch(`${base}/${id}`,{method:'DELETE',headers:{authorization:`Bearer ${wrongBot}`}})).status,409);
  assert.equal((await fetch(`${base}/${id}`,{method:'DELETE',headers:{authorization:`Bearer ${token}`}})).status,200);gateway.revoke(token);assert.equal((await call(token)).status,401);
 }finally{gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();await admin.query(`DROP DATABASE \`${db}\``);await admin.end()}
});
