import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { TenantStore, type Session } from '../src/server/tenant-store.ts';
import { BotStore } from '../src/server/bot-store.ts';
import { RunStore } from '../src/server/run-store.ts';
import { RunScheduler } from '../src/server/run-scheduler.ts';
const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);
if(!port) throw new Error('Disposable MySQL port required');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn:()=>Promise<boolean>) { for(let i=0;i<150;i++){if(await fn())return;await pause(20)} throw new Error('Condition timed out') }
test('scheduler isolates computers, serializes each owner and preserves uncertain outcomes across restart',async()=>{
 const db=`grok_sched_${randomUUID().replaceAll('-','')}`, admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});
 await admin.query(`CREATE DATABASE \`${db}\``); const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:db,timezone:'Z',connectionLimit:8});
 let scheduler:RunScheduler|undefined;
 try{
  const ids=new TenantStore(pool);await ids.migrate();const bots=new BotStore(pool);await bots.migrate();const runs=new RunStore(pool);await runs.migrate();
  const mkSession=async (subject:string):Promise<Session>=>({...await ids.signInGoogle({subject,email:`${subject}@example.test`,name:subject}),email:`${subject}@example.test`,name:subject,role:'owner'});
  const a=await mkSession('alice'),b=await mkSession('bob');
  const a1=await bots.create(a,{name:'A1',shape:'hex',color:'#aabbcc'}),a2=await bots.create(a,{name:'A2',shape:'hex',color:'#aabbcc'}),b1=await bots.create(b,{name:'B',shape:'hex',color:'#aabbcc'});
  const first=await runs.create(a,a1.id,randomUUID(),'first'); const second=await runs.create(a,a2.id,randomUUID(),'second'); const other=await runs.create(b,b1.id,randomUUID(),'other'); assert.ok(first&&second&&other);
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);const calls:string[]=[];
  scheduler=new RunScheduler(runs,{execute:async (_owner,run)=>{calls.push(run.prompt);if(run.prompt==='first')await gate;if(run.prompt==='other')throw new Error('transport outcome unknown');return {status:'completed',result:'done'}}},{concurrency:2,leaseSeconds:6});
  await Promise.all([scheduler.tick(),scheduler.tick()]);
  await until(async()=>calls.length===2);assert.deepEqual(new Set(calls),new Set(['first','other']));
  await until(async()=>(await runs.list(b,b1.id))?.[0].status==='unknown');
  await scheduler.tick();assert.equal(calls.includes('second'),false);
  release();await until(async()=>(await runs.list(a,a1.id))?.[0].status==='completed');
  await scheduler.tick();await until(async()=>(await runs.list(a,a2.id))?.[0].status==='completed');
  await scheduler.stop();scheduler=undefined;
  const restartCalls:string[]=[];scheduler=new RunScheduler(runs,{execute:async (_owner,run)=>{restartCalls.push(run.prompt);return {status:'completed',result:'done'}}},{concurrency:2,leaseSeconds:6});
  await scheduler.tick();await pause(50);assert.deepEqual(restartCalls,[]);
  assert.deepEqual((await runs.events(b,other.id))?.map(e=>e.status),['queued','running','unknown']);
 }finally{await scheduler?.stop();await pool.end();await admin.query(`DROP DATABASE \`${db}\``);await admin.end()}
});

test('stopping a worker aborts a running task and records unknown',async()=>{
 const db=`grok_stop_${randomUUID().replaceAll('-','')}`,admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);
 const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:db,timezone:'Z'});let scheduler:RunScheduler|undefined;
 try{
  const ids=new TenantStore(pool);await ids.migrate();const bots=new BotStore(pool);await bots.migrate();const runs=new RunStore(pool);await runs.migrate();
  const identity=await ids.signInGoogle({subject:'c',email:'c@example.test',name:'C'}), s:Session={...identity,email:'c@example.test',name:'C',role:'owner'};
  const bot=await bots.create(s,{name:'C',shape:'hex',color:'#aabbcc'}),run=await runs.create(s,bot.id,randomUUID(),'stop');assert.ok(run);
  let started=false;scheduler=new RunScheduler(runs,{execute:async (_owner,_run,signal)=>{started=true;await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));return {status:'completed',result:'late'}}},{concurrency:1,leaseSeconds:6});
  await scheduler.tick();await until(async()=>started);await scheduler.stop();scheduler=undefined;
  assert.equal((await runs.list(s,bot.id))?.[0].status,'unknown');
  assert.deepEqual((await runs.events(s,run.id))?.map(e=>e.status),['queued','running','unknown']);
 }finally{await scheduler?.stop();await pool.end();await admin.query(`DROP DATABASE \`${db}\``);await admin.end()}
});

test('a long run renews its lease, while a second scheduler cannot claim the same computer',async()=>{
 const db=`grok_lease_${randomUUID().replaceAll('-','')}`,admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);
 const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:db,timezone:'Z',connectionLimit:8});let scheduler1:RunScheduler|undefined,scheduler2:RunScheduler|undefined;
 try{
  const ids=new TenantStore(pool);await ids.migrate();const bots=new BotStore(pool);await bots.migrate();const runs=new RunStore(pool);await runs.migrate();
  const identity=await ids.signInGoogle({subject:'lease',email:'lease@example.test',name:'Lease'}),s:Session={...identity,email:'lease@example.test',name:'Lease',role:'owner'};
  const bot=await bots.create(s,{name:'Lease',shape:'hex',color:'#aabbcc'}),run=await runs.create(s,bot.id,randomUUID(),'long run');assert.ok(run);
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),called:string[]=[];
  const executor={execute:async()=>{called.push('started');await gate;return {status:'completed' as const,result:'done'}}};
  scheduler1=new RunScheduler(runs,executor,{concurrency:1,leaseSeconds:3});scheduler2=new RunScheduler(runs,executor,{concurrency:1,leaseSeconds:3});
  await Promise.all([scheduler1.tick(),scheduler2.tick()]);await until(async()=>called.length===1);
  await pause(4000);assert.equal(await runs.markExpiredUnknown(),0);assert.equal((await runs.list(s,bot.id))?.[0].status,'running');
  await scheduler2.tick();assert.equal(called.length,1);release();await until(async()=>(await runs.list(s,bot.id))?.[0].status==='completed');
 }finally{await scheduler1?.stop();await scheduler2?.stop();await pool.end();await admin.query(`DROP DATABASE \`${db}\``);await admin.end()}
});
