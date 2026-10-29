import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import mysql from 'mysql2/promise';
import { TenantStore } from '../src/server/tenant-store.ts';
import { BotStore } from '../src/server/bot-store.ts';
import { RunStore } from '../src/server/run-store.ts';
import { GoogleAuthService, type IdentityProvider } from '../src/server/google-auth.ts';
import { createAuthServer } from '../src/server/auth-http.ts';
const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);if(!port)throw new Error('Disposable MySQL port required');
test('run API is authenticated, owner-scoped, origin-protected and idempotent',async()=>{
 const db=`grok_run_api_${randomUUID().replaceAll('-','')}`,admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);
 const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:db,timezone:'Z'});const ids=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool);
 await ids.migrate();await bots.migrate();await runs.migrate();
 const net=await import('node:net'),reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const httpPort=(reservation.address() as import('node:net').AddressInfo).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 const origin=`http://127.0.0.1:${httpPort}`,base=origin+'/grok-bot',provider:IdentityProvider={authorizationUrl:()=>'',exchange:async()=>({})};
 const server=createAuthServer(new GoogleAuthService(ids,provider,base),base,undefined,bots,runs);server.listen(httpPort,'127.0.0.1');await once(server,'listening');
 const login=async(subject:string)=>{const id=await ids.signInGoogle({subject,email:`${subject}@example.test`,name:subject}),token=randomBytes(32).toString('base64url');await ids.createSession(createHash('sha256').update(token).digest('hex'),id.userId,id.tenantId,new Date(Date.now()+60000));return {id,cookie:`coke_grok_session=${token}`}};
 try{
  const a=await login('a'),b=await login('b');const bot=await bots.create({...a.id,email:'a@example.test',name:'A',role:'owner'},{name:'A',shape:'round',color:'#abcdef'});
  const path=`/api/bots/${bot.id}/runs`,request=(path:string,cookie='',init:RequestInit={})=>fetch(base+path,{...init,headers:{cookie,...init.headers}});
  const requestId=randomUUID(),payload=JSON.stringify({requestId,prompt:'Hello'}),post=(cookie:string,body=payload,from=origin)=>request(path,cookie,{method:'POST',headers:{origin:from,'content-type':'application/json'},body});
  assert.equal((await request(path)).status,401);assert.equal((await post(a.cookie,payload,'https://evil.example')).status,403);assert.equal((await post(b.cookie)).status,404);
  const first=await post(a.cookie),firstBody=await first.json() as {run:{id:string}};assert.equal(first.status,200);
  const duplicate=await post(a.cookie),duplicateBody=await duplicate.json() as {run:{id:string}};assert.equal(duplicateBody.run.id,firstBody.run.id);
  assert.equal((await post(a.cookie,JSON.stringify({requestId,prompt:'Different'}))).status,409);
  assert.equal((await request(path,b.cookie)).status,404);
  assert.equal((await request(`/api/runs/${firstBody.run.id}/events`,b.cookie)).status,404);
  const events=await request(`/api/runs/${firstBody.run.id}/events`,a.cookie);assert.equal(events.status,200);assert.deepEqual((await events.json() as {events:{status:string}[]}).events.map(x=>x.status),['queued']);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();await admin.query(`DROP DATABASE \`${db}\``);await admin.end()}
});
