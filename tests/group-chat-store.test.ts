import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import mysql from 'mysql2/promise';
import {TenantStore} from '../src/server/tenant-store.ts';
import {BotStore} from '../src/server/bot-store.ts';
import {RunStore} from '../src/server/run-store.ts';
import {RunScheduler} from '../src/server/run-scheduler.ts';
import {GroupChatStore} from '../src/server/group-chat-store.ts';
import {GoogleAuthService,type IdentityProvider} from '../src/server/google-auth.ts';
import {createAuthServer} from '../src/server/auth-http.ts';

const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);
if(!port)throw new Error('Set COKE_GROK_TEST_MYSQL_PORT to a disposable local MySQL instance.');

test('group chats persist six Bot memberships and fan each message into isolated real run records',async()=>{
 const database=`grok_groups_${randomUUID().replaceAll('-','')}`;
 const admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});
 await admin.query(`CREATE DATABASE \`${database}\``);
 const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database,timezone:'Z',connectionLimit:12});
 const identities=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool),groups=new GroupChatStore(pool);
 await identities.migrate();await bots.migrate();await runs.migrate();await groups.migrate();await groups.migrate();
 const net=await import('node:net'),reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
 const httpPort=(reservation.address() as import('node:net').AddressInfo).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 const origin=`http://127.0.0.1:${httpPort}`,base=origin+'/grok-bot';
 const provider:IdentityProvider={authorizationUrl:()=>'',exchange:async()=>({})};
 const backend=createAuthServer(new GoogleAuthService(identities,provider,base),base,undefined,bots,runs,undefined,undefined,'pi',undefined,undefined,groups);
 backend.listen(httpPort,'127.0.0.1');await once(backend,'listening');
 const login=async(subject:string)=>{
  const identity=await identities.signInGoogle({subject,email:`${subject}@example.test`,name:subject});
  const token=randomBytes(32).toString('base64url');
  await identities.createSession(createHash('sha256').update(token).digest('hex'),identity.userId,identity.tenantId,new Date(Date.now()+60000));
  return{identity,cookie:`coke_grok_session=${token}`};
 };
 const scheduler=new RunScheduler(runs,{execute:async(_screen,run)=>({status:'completed',result:`${run.prompt.split('\n')[0]} replied from its own queued run.`})},{concurrency:2,leaseSeconds:10});
 try{
  const alice=await login('group-owner'),bob=await login('other-owner');
  const aliceSession={...alice.identity,email:'group-owner@example.test',name:'Group owner',role:'owner' as const};
  const bobSession={...bob.identity,email:'other-owner@example.test',name:'Other owner',role:'owner' as const};
  const members=[];
  for(let index=0;index<6;index++)members.push(await bots.create(aliceSession,{name:['Chief','Sales Outbound','Inbox Manager','Account Manager','Talent Scout','Expense Manager'][index],label:`Role ${index+1}`,shape:'round',color:'#abcdef'}));
  const foreign=await bots.create(bobSession,{name:'Private Bot',shape:'round',color:'#abcdef'});
  const request=(path:string,cookie='',init:RequestInit={})=>fetch(`${base}${path}`,{...init,headers:{cookie,...init.headers}});
  assert.equal((await request('/api/groups')).status,401);
  const groupRequestId=randomUUID(),payload=JSON.stringify({requestId:groupRequestId,name:'Offsite crew',botIds:members.map(bot=>bot.id)});
  assert.equal((await request('/api/groups',alice.cookie,{method:'POST',headers:{origin:'https://attacker.example','content-type':'application/json'},body:payload})).status,403);
  assert.equal((await request('/api/groups',alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),name:'Private mix',botIds:[members[0].id,foreign.id]})})).status,404);
  assert.equal((await request('/api/groups',alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),name:'Too small',botIds:[members[0].id]})})).status,400);
  const create=await request('/api/groups',alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:payload});
  assert.equal(create.status,201);
  const group=(await create.json() as {group:{id:string;name:string;members:{id:string}[]}}).group;
  assert.equal(group.name,'Offsite crew');assert.equal(group.members.length,6);
  const replay=await request('/api/groups',alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:payload});
  assert.equal((await replay.json() as {group:{id:string}}).group.id,group.id);
  assert.equal((await request('/api/groups',alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:groupRequestId,name:'Changed',botIds:members.map(bot=>bot.id)})})).status,409);
  assert.equal((await request(`/api/groups/${group.id}`,bob.cookie)).status,404);
  assert.equal((await request('/api/groups',bob.cookie)).status,200);
  assert.deepEqual((await (await request('/api/groups',bob.cookie)).json() as {groups:unknown[]}).groups,[]);
  const turnRequestId=randomUUID(),text='Each Bot: give one concise, role-specific idea for a safe offsite. Do not use a computer or contact anyone.';
  const send=await request(`/api/groups/${group.id}/messages`,alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:turnRequestId,text})});
  assert.equal(send.status,202);
  const view=(await send.json() as {group:{id:string};messages:{role:string;botId:string|null;runId:string|null;status:string|null}[]});
  assert.equal(view.messages.length,7);assert.equal(view.messages[0].role,'user');
  const botMessages=view.messages.filter(message=>message.role==='bot');assert.equal(botMessages.length,6);
  assert.equal(new Set(botMessages.map(message=>message.botId)).size,6);
  assert.ok(botMessages.every(message=>message.runId&&message.status==='queued'));
  const duplicate=await request(`/api/groups/${group.id}/messages`,alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:turnRequestId,text})});
  assert.equal((await duplicate.json() as typeof view).messages.filter(message=>message.role==='bot').length,6);
  assert.equal((await request(`/api/groups/${group.id}/messages`,bob.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),text})})).status,404);
  assert.equal((await request(`/api/groups/${group.id}/messages`,alice.cookie,{method:'POST',headers:{origin:'https://attacker.example','content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),text})})).status,403);
  assert.equal((await request(`/api/groups/${group.id}/messages`,alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:turnRequestId,text:'Different content'})})).status,409);
  const runIds=botMessages.map(message=>message.runId!);
  for(let attempt=0;attempt<100;attempt++){
   await scheduler.tick();
   const persisted=await groups.get(aliceSession,group.id);
   if(persisted?.messages.filter(message=>message.role==='bot'&&message.status==='completed').length===6)break;
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  await scheduler.stop();
  const completed=await groups.get(aliceSession,group.id);
  assert.equal(completed?.messages.filter(message=>message.role==='bot'&&message.status==='completed').length,6);
  assert.equal(new Set(completed?.messages.filter(message=>message.role==='bot').map(message=>message.runId)).size,6);
  for(const runId of runIds){
   const [rows]=await pool.execute<mysql.RowDataPacket[]>('SELECT status,result,prompt FROM agent_runs WHERE id=?',[runId]);
   assert.equal(rows[0].status,'completed');assert.match(String(rows[0].prompt),/Each Bot: give one concise/);assert.ok(String(rows[0].result).endsWith('replied from its own queued run.'));
  }
  const [turnRows]=await pool.execute<mysql.RowDataPacket[]>('SELECT COUNT(*) AS count FROM bot_group_turns WHERE group_id=?',[group.id]);
  assert.equal(Number(turnRows[0].count),1);
 }finally{
  await scheduler.stop();await new Promise<void>(resolve=>backend.close(()=>resolve()));await pool.end();await admin.query(`DROP DATABASE \`${database}\``);await admin.end();
 }
});
