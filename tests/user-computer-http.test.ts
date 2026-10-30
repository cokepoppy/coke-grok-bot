import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {createAuthServer} from '../src/server/auth-http.ts';
import type {GoogleAuthService} from '../src/server/google-auth.ts';
import type {Session} from '../src/server/tenant-store.ts';
import {UserComputer} from '../src/server/user-computer.ts';

test('computer API selects the authenticated user and protects actions with origin and ownership',async()=>{
 const a:Session={tenantId:randomUUID(),userId:randomUUID(),email:'a@example.test',name:'a',role:'owner'};
 const b:Session={...a,userId:randomUUID(),email:'b@example.test',name:'b'};
 const owners=new Map([[a.userId,'agent'],[b.userId,'agent']]);const calls:string[]=[];
 const computer=new UserComputer(owner=>({
  async control(){return {owner:owners.get(owner.userId) as 'agent'|'user'}},
  async userScreenshot(){return Buffer.from(owner.userId)},
  async setControl(value){owners.set(owner.userId,value);return {owner:value}},
  async userAction(action){if(owners.get(owner.userId)!=='user')throw new Error('Not in control');calls.push(`${owner.userId}:${action.action}`)},
 }));
 const auth={session:async(req:import('node:http').IncomingMessage)=>req.headers.cookie==='a'?a:req.headers.cookie==='b'?b:null} as unknown as GoogleAuthService;
 const reserve=await import('node:net');const listener=reserve.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=(listener.address() as AddressInfo).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));
 const origin=`http://127.0.0.1:${port}`,server=createAuthServer(auth,origin+'/grok-bot',undefined,undefined,undefined,undefined,computer);server.listen(port,'127.0.0.1');await once(server,'listening');
 const request=(path:string,cookie='',init:RequestInit={})=>fetch(origin+'/grok-bot/api/computer'+path,{...init,headers:{cookie,...init.headers}});
 const post=(path:string,cookie:string,body:unknown,from=origin)=>request(path,cookie,{method:'POST',headers:{origin:from,'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await request('/screenshot')).status,401);
  const screenA=await request('/screenshot','a'),screenB=await request('/screenshot','b');assert.equal(screenA.headers.get('cache-control'),'no-store');assert.equal(await screenA.text(),a.userId);assert.equal(await screenB.text(),b.userId);
  assert.equal((await post('/control','a',{owner:'user'},'https://other.example')).status,403);
  assert.equal((await post('/control','a',{owner:'user',userId:b.userId})).status,400);
  assert.equal((await post('/control','a',{owner:'user'})).status,200);
  assert.equal((await post('/action','b',{action:'click',x:1,y:1})).status,503);
  assert.equal((await post('/action','a',{action:'click',x:1440,y:1})).status,400);
  assert.equal((await post('/action','a',{action:'click',x:1,y:2,actor:'agent'})).status,400);
  assert.equal((await post('/action','a',{action:'click',x:1,y:2})).status,200);
  assert.deepEqual(calls,[`${a.userId}:click`]);assert.equal(owners.get(b.userId),'agent');
  assert.equal((await post('/control','a',{owner:'agent'})).status,200);
  assert.equal((await post('/action','a',{action:'press',key:'Enter'})).status,503);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
