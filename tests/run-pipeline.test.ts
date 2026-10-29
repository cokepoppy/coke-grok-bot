import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import mysql from 'mysql2/promise';
import {TenantStore} from '../src/server/tenant-store.ts';
import {BotStore} from '../src/server/bot-store.ts';
import {RunStore} from '../src/server/run-store.ts';
import {RunScheduler} from '../src/server/run-scheduler.ts';
import {GoogleAuthService,type IdentityProvider} from '../src/server/google-auth.ts';
import {createAuthServer} from '../src/server/auth-http.ts';
const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);if(!port)throw new Error('Disposable MySQL port required');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
test('authenticated API, persistent scheduler and event history form one recoverable pipeline',async()=>{
 const db=`grok_pipeline_${randomUUID().replaceAll('-','')}`,admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);
 const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:db,timezone:'Z'}),ids=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool);
 await ids.migrate();await bots.migrate();await runs.migrate();
 const net=await import('node:net'),reserve=net.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const p=(reserve.address() as import('node:net').AddressInfo).port;await new Promise<void>(resolve=>reserve.close(()=>resolve()));
 const origin=`http://127.0.0.1:${p}`,base=origin+'/grok-bot',provider:IdentityProvider={authorizationUrl:()=>'',exchange:async()=>({})};
 const server=createAuthServer(new GoogleAuthService(ids,provider,base),base,undefined,bots,runs);server.listen(p,'127.0.0.1');await once(server,'listening');
 let callCount=0;const scheduler=new RunScheduler(runs,{execute:async (_owner,run)=>{callCount++;assert.equal(run.prompt,'Perform test task');return {status:'completed',result:'Task finished'}}},{concurrency:1,leaseSeconds:6});
 try{
  const identity=await ids.signInGoogle({subject:'pipeline',email:'pipeline@example.test',name:'Pipeline'}),token=randomBytes(32).toString('base64url');await ids.createSession(createHash('sha256').update(token).digest('hex'),identity.userId,identity.tenantId,new Date(Date.now()+60000));
  const bot=await bots.create({...identity,email:'pipeline@example.test',name:'Pipeline',role:'owner'},{name:'Bot',color:'#abcdef',shape:'round'});
  const cookie=`coke_grok_session=${token}`,path=`/api/bots/${bot.id}/runs`,requestId=randomUUID(),body=JSON.stringify({requestId,prompt:'Perform test task'});
  const send=()=>fetch(base+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body});
  const response=await send();assert.equal(response.status,200);const {run}=await response.json() as {run:{id:string;status:string}};assert.equal(run.status,'queued');
  await scheduler.tick();
  let state='';for(let i=0;i<100;i++){const reply=await fetch(base+path,{headers:{cookie}}),data=await reply.json() as {runs:{status:string}[]};state=data.runs[0].status;if(state==='completed')break;await pause(20)}assert.equal(state,'completed');
  const repeat=await send(),replayed=await repeat.json() as {run:{id:string;result:string}};assert.equal(replayed.run.id,run.id);assert.equal(replayed.run.result,'Task finished');assert.equal(callCount,1);
  const eventResponse=await fetch(`${base}/api/runs/${run.id}/events`,{headers:{cookie}});const events=await eventResponse.json() as {events:{status:string}[]};assert.deepEqual(events.events.map(item=>item.status),['queued','running','completed']);
 }finally{await scheduler.stop();await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();await admin.query(`DROP DATABASE \`${db}\``);await admin.end()}
});
