import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {createAuthServer} from '../src/server/auth-http.ts';
import type {GoogleAuthService} from '../src/server/google-auth.ts';
import type {Session} from '../src/server/tenant-store.ts';
import {UserComputer} from '../src/server/user-computer.ts';
import {SafeDiagnosticError} from '../src/server/safe-diagnostics.ts';

test('computer API selects the authenticated user and protects actions with origin and ownership',async()=>{
 const a:Session={tenantId:randomUUID(),userId:randomUUID(),email:'a@example.test',name:'a',role:'owner'};
 const b:Session={...a,userId:randomUUID(),email:'b@example.test',name:'b'};
 const botA=randomUUID(),botA2=randomUUID(),botB=randomUUID();
 const owners=new Map<string,'agent'|'user'>();owners.set(`${a.userId}:${botA}`,'agent');owners.set(`${a.userId}:${botA2}`,'agent');owners.set(`${b.userId}:${botB}`,'agent');const calls:string[]=[];
 const computer=new UserComputer((owner,botId)=>({
  async control(){return {owner:owners.get(`${owner.userId}:${botId}`) as 'agent'|'user'}},
  async userScreenshot(){if(botId===botA2)throw new SafeDiagnosticError('COMPUTER_WORKER_TRANSPORT_FAILED',504);return Buffer.from(owner.userId)},
  async setControl(value){owners.set(`${owner.userId}:${botId}`,value);return {owner:value}},
  async userAction(action){if(owners.get(`${owner.userId}:${botId}`)!=='user')throw new Error('Not in control');calls.push(`${owner.userId}:${botId}:${action.action}`)},
 }));
 const auth={session:async(req:import('node:http').IncomingMessage)=>req.headers.cookie==='a'?a:req.headers.cookie==='b'?b:null} as unknown as GoogleAuthService;
 const ownedByA=new Set<string>([botA,botA2]);
 const runs={ownsBot:async(session:Session,id:string)=>(session.userId===a.userId&&ownedByA.has(id))||(session.userId===b.userId&&id===botB)} as unknown as import('../src/server/run-store.ts').RunStore;
 const reserve=await import('node:net');const listener=reserve.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=(listener.address() as AddressInfo).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));
 const origin=`http://127.0.0.1:${port}`,server=createAuthServer(auth,origin+'/grok-bot',undefined,undefined,runs,undefined,computer);server.listen(port,'127.0.0.1');await once(server,'listening');
 const request=(bot:string,path:string,cookie='',init:RequestInit={})=>fetch(`${origin}/grok-bot/api/bots/${bot}/computer${path}`,{...init,headers:{cookie,...init.headers}});
 const post=(bot:string,path:string,cookie:string,body:unknown,from=origin)=>request(bot,path,cookie,{method:'POST',headers:{origin:from,'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  const unauthenticated=await request(botA,'/screenshot');assert.equal(unauthenticated.status,401);assert.deepEqual((await unauthenticated.json() as {diagnostic:unknown}).diagnostic,{code:'COMPUTER_AUTH_REQUIRED',status:401});
  const screenA=await request(botA,'/screenshot','a'),screenB=await request(botB,'/screenshot','b');assert.equal(screenA.headers.get('cache-control'),'no-store');assert.equal(await screenA.text(),a.userId);assert.equal(await screenB.text(),b.userId);
  const screenshotFailure=await request(botA2,'/screenshot','a');assert.equal(screenshotFailure.status,503);assert.deepEqual(await screenshotFailure.json(),{error:'Service unavailable',diagnostic:{code:'COMPUTER_WORKER_TRANSPORT_FAILED',status:504}});
  const unavailable=await request(botA,'/screenshot','b');assert.equal(unavailable.status,404);assert.deepEqual((await unavailable.json() as {diagnostic:unknown}).diagnostic,{code:'COMPUTER_BOT_UNAVAILABLE',status:404});
  assert.equal((await post(botA,'/control','a',{owner:'user'},'https://other.example')).status,403);
  assert.equal((await post(botA,'/control','a',{owner:'user',userId:b.userId})).status,400);
  assert.equal((await post(botA,'/control','a',{owner:'user'})).status,200);
  assert.equal(owners.get(`${a.userId}:${botA}`),'user');assert.equal(owners.get(`${a.userId}:${botA2}`),'agent');
  assert.equal((await post(botB,'/action','b',{action:'click',x:1,y:1})).status,503);
  assert.equal((await post(botA,'/action','a',{action:'click',x:1440,y:1})).status,400);
  assert.equal((await post(botA,'/action','a',{action:'click',x:1,y:2,actor:'agent'})).status,400);
  assert.equal((await post(botA,'/action','a',{action:'click',x:1,y:2})).status,200);
  assert.deepEqual(calls,[`${a.userId}:${botA}:click`]);assert.equal(owners.get(`${b.userId}:${botB}`),'agent');
  assert.equal((await post(botA,'/control','a',{owner:'agent'})).status,200);
  assert.equal((await post(botA,'/action','a',{action:'press',key:'Enter'})).status,503);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
});

test('user computer provisions once per authenticated owner before serving control or screenshots',async()=>{
 const owner:Session={tenantId:randomUUID(),userId:randomUUID(),email:'owner@example.test',name:'owner',role:'owner'};
 let release!:()=>void,provisionCalls=0,workerCalls=0;
 const provisioning=new Promise<void>(resolve=>{release=resolve});
 const botId=randomUUID(),computer=new UserComputer(()=>({
  async control(){workerCalls++;return {owner:'agent'}},
  async userScreenshot(){workerCalls++;return Buffer.from('ready')},
  async setControl(value){workerCalls++;return {owner:value}},
  async userAction(){workerCalls++},
 }),async()=>{provisionCalls++;await provisioning});
 const signal=AbortSignal.timeout(5000);
 const control=computer.control(owner,botId,signal),screenshot=computer.screenshot(owner,botId,signal);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(provisionCalls,1);assert.equal(workerCalls,0);
 release();
 assert.deepEqual(await control,{owner:'agent'});assert.equal((await screenshot).toString(),'ready');
 assert.equal(workerCalls,2);
});
