import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import mysql from 'mysql2/promise';
import { TenantStore } from '../src/server/tenant-store.ts';
import { BotStore } from '../src/server/bot-store.ts';
import { RunStore } from '../src/server/run-store.ts';
import { RoutineStore } from '../src/server/routine-store.ts';
import { GoogleAuthService, type IdentityProvider } from '../src/server/google-auth.ts';
import { createAuthServer } from '../src/server/auth-http.ts';

const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);
if(!port)throw new Error('Set COKE_GROK_TEST_MYSQL_PORT to a disposable local MySQL instance.');

test('routine APIs enforce Bot ownership, persist schedules, and queue one real run per due occurrence',async()=>{
 const database=`grok_routines_${randomUUID().replaceAll('-','')}`;
 const admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});
 await admin.query(`CREATE DATABASE \`${database}\``);
 const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database,timezone:'Z',connectionLimit:12});
 const identities=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool),routines=new RoutineStore(pool);
 await identities.migrate();await bots.migrate();await runs.migrate();await routines.migrate();await routines.migrate();
 const net=await import('node:net'),reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
 const httpPort=(reservation.address() as import('node:net').AddressInfo).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 const origin=`http://127.0.0.1:${httpPort}`,base=origin+'/grok-bot';
 const provider:IdentityProvider={authorizationUrl:()=>'',exchange:async()=>({})};
 const backend=createAuthServer(new GoogleAuthService(identities,provider,base),base,undefined,bots,runs,undefined,undefined,'pi',undefined,undefined,undefined,routines);
 backend.listen(httpPort,'127.0.0.1');await once(backend,'listening');
 const login=async(subject:string)=>{
   const identity=await identities.signInGoogle({subject,email:`${subject}@example.test`,name:subject});
   const token=randomBytes(32).toString('base64url');
   await identities.createSession(createHash('sha256').update(token).digest('hex'),identity.userId,identity.tenantId,new Date(Date.now()+60_000));
   return{identity,cookie:`coke_grok_session=${token}`};
 };
 const request=(path:string,cookie='',init:RequestInit={})=>fetch(`${base}${path}`,{...init,headers:{cookie,...init.headers}});
 const runSession=(identity:Awaited<ReturnType<typeof login>>['identity'])=>({...identity,email:`${identity.name}@example.test`,name:identity.name,role:'owner' as const});
 try{
   const owner=await login('routine-owner'),other=await login('other-owner');
   const ownerSession=runSession(owner.identity),otherSession=runSession(other.identity);
   const bot=await bots.create(ownerSession,{name:'Sales Outbound',color:'#f19d39',shape:'drop'});
   const foreignBot=await bots.create(otherSession,{name:'Private Bot',color:'#abcdef',shape:'round'});
   const collection=`/api/bots/${bot.id}/routines`;
   assert.equal((await request(collection)).status,401);
   assert.equal((await request(`/api/bots/${foreignBot.id}/routines`,owner.cookie)).status,404);
   const weekly={requestId:randomUUID(),name:'Overnight outbound',instruction:'Prepare drafts for review. Do not send.',schedule:{kind:'weekly',weekday:0,hour:23,minute:0},timezone:'America/Los_Angeles'};
   const create=()=>request(collection,owner.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(weekly)});
   const createdResponse=await create();assert.equal(createdResponse.status,201);
   const created=(await createdResponse.json() as {routine:{id:string;when:string;nextRunAt:string;paused:boolean}}).routine;
   assert.equal(created.when,'Sundays at 11:00 PM');assert.equal(created.paused,false);assert.ok(Date.parse(created.nextRunAt)>Date.now());
   const duplicateResponse=await create();assert.equal(duplicateResponse.status,201);
   assert.equal((await duplicateResponse.json() as {routine:{id:string}}).routine.id,created.id,'Request retries should return the same saved routine');
   assert.equal((await request(collection,owner.cookie)).status,200);
   const listed=(await (await request(collection,owner.cookie)).json() as {routines:{id:string;instruction:string;runs:unknown[]}[]}).routines;
   assert.equal(listed.length,1);assert.equal(listed[0].instruction,weekly.instruction);assert.deepEqual(listed[0].runs,[]);
   assert.equal((await request(`/api/bots/${foreignBot.id}/routines/${created.id}`,other.cookie,{method:'PATCH',headers:{origin,'content-type':'application/json'},body:JSON.stringify({paused:true})})).status,404);
   const testResponse=await request(`${collection}/${created.id}/test`,owner.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});
   assert.equal(testResponse.status,202);
   const testRun=(await testResponse.json() as {run:{id:string;status:string}}).run;assert.equal(testRun.status,'queued');
   const testRuns=await runs.list(ownerSession,bot.id);assert.equal(testRuns?.find(run=>run.id===testRun.id)?.prompt,'Test routine: Overnight outbound\n\nPrepare drafts for review. Do not send.');
   const pauseResponse=await request(`${collection}/${created.id}`,owner.cookie,{method:'PATCH',headers:{origin,'content-type':'application/json'},body:JSON.stringify({paused:true})});assert.equal(pauseResponse.status,200);
   const paused=(await pauseResponse.json() as {routine:{paused:boolean}}).routine;assert.equal(paused.paused,true);
   assert.equal((await request(`${collection}/${created.id}`,owner.cookie,{method:'DELETE',headers:{origin}})).status,200);
   assert.deepEqual((await (await request(collection,owner.cookie)).json() as {routines:unknown[]}).routines,[]);

   const now=new Date('2026-01-01T00:00:00.000Z');
   const due=await routines.create(ownerSession,bot.id,{requestId:randomUUID(),name:'Five minute review',instruction:'Report a concise status.',schedule:{kind:'interval',minutes:5},timezone:'UTC'},now);
   assert.ok(due);
   const dispatchTime=new Date('2026-01-01T00:06:00.000Z');
   const dispatchCounts=await Promise.all([routines.dispatchDue(dispatchTime),routines.dispatchDue(dispatchTime)]);
   assert.equal(dispatchCounts.reduce((sum,count)=>sum+count,0),1,'Concurrent scheduler ticks must not double-queue an occurrence');
   const runRows=await runs.list(ownerSession,bot.id);
   const scheduledRun=runRows?.find(run=>run.prompt==='Scheduled routine: Five minute review\n\nReport a concise status.');assert.ok(scheduledRun);assert.equal(scheduledRun.status,'queued');
   assert.equal((await routines.dispatchDue(dispatchTime)),0,'A committed occurrence should not be queued again');
   const saved=(await routines.list(ownerSession,bot.id))?.find(routine=>routine.id===due.id);assert.equal(saved?.nextRunAt,'2026-01-01T00:10:00.000Z','Late dispatch should preserve the interval cadence');
   assert.equal(await routines.remove(otherSession,due.id),false,'A different tenant cannot delete the routine');

   const agentRun=await runs.create(ownerSession,bot.id,randomUUID(),'Create a scheduled weekly status summary.');assert.ok(agentRun);
   const claim=await runs.claimNext({...ownerSession,botId:bot.id},30);assert.ok(claim);
   const scope={owner:{tenantId:ownerSession.tenantId,userId:ownerSession.userId},botId:bot.id,runId:claim.run.id,leaseId:claim.leaseId};
   const agentInput={name:'Weekly status',instruction:'Summarize work for my review.',schedule:{kind:'weekly' as const,weekday:1,hour:9,minute:30},timezone:'Asia/Shanghai'};
   const agentCreated=await routines.createForRun(scope,agentInput);assert.ok(agentCreated);
   const agentDuplicate=await routines.createForRun(scope,{timezone:agentInput.timezone,schedule:{minute:30,kind:'weekly',hour:9,weekday:1},instruction:agentInput.instruction,name:agentInput.name});assert.equal(agentDuplicate?.id,agentCreated.id,'A reordered model-tool retry within one run must not create a duplicate');
   assert.equal((await routines.listForRun(scope))?.some(routine=>routine.id===agentCreated.id),true);
   const agentUpdated=await routines.updateForRun(scope,agentCreated.id,{...agentInput,name:'Weekly status review'});assert.equal(agentUpdated?.name,'Weekly status review');
   assert.equal(await routines.updateForRun({...scope,owner:{tenantId:otherSession.tenantId,userId:otherSession.userId}},agentCreated.id,agentInput),null,'A different tenant cannot use the live run lease');
   assert.equal(await runs.finish(claim.run.id,claim.leaseId,'completed','Routine saved.'),true);
   assert.equal(await routines.createForRun(scope,{...agentInput,name:'Late mutation'}),null,'A completed run lease cannot mutate routines');
 }finally{
   await new Promise<void>(resolve=>backend.close(()=>resolve()));
   await pool.end();await admin.query(`DROP DATABASE \`${database}\``);await admin.end();
 }
});
