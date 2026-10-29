import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { TenantStore, type Session } from '../src/server/tenant-store.ts';
import { BotStore } from '../src/server/bot-store.ts';
import { RunStore } from '../src/server/run-store.ts';
const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);
if (!port) throw new Error('Disposable MySQL port required');
test('a run result is owner-scoped and transition events persist in order',async()=>{
 const db=`grok_events_${randomUUID().replaceAll('-','')}`;
 const admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'}); await admin.query(`CREATE DATABASE \`${db}\``);
 const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:db,timezone:'Z'});
 try {
  const identities=new TenantStore(pool); await identities.migrate(); const bots=new BotStore(pool); await bots.migrate(); const runs=new RunStore(pool); await runs.migrate();
  const a=await identities.signInGoogle({subject:'a',email:'a@example.test',name:'A'}), b=await identities.signInGoogle({subject:'b',email:'b@example.test',name:'B'});
  const session=(x:typeof a):Session=>({...x,email:'test@example.test',name:'Test',role:'owner'});
  const bot=await bots.create(session(a),{name:'Bot',color:'#abcdef',shape:'round'});
  const run=await runs.create(session(a),bot.id,randomUUID(),'Hello'); assert.ok(run);
  const claim=await runs.claimNext(session(a),60); assert.ok(claim); assert.equal(await runs.finish(run.id,claim.leaseId,'completed','Finished'),true);
  assert.deepEqual((await runs.events(session(a),run.id))?.map(x=>[x.status,x.detail]),[['queued',null],['running',null],['completed','Finished']]);
  assert.equal((await runs.list(session(a),bot.id))?.[0].result,'Finished');
  assert.equal(await runs.events(session(b),run.id),null);
 } finally { await pool.end(); await admin.query(`DROP DATABASE \`${db}\``); await admin.end(); }
});
