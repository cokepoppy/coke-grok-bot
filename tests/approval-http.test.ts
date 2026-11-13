import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import mysql from 'mysql2/promise';
import { mysqlTestCredentials } from './helpers/mysql-test-credentials.ts';
import {TenantStore} from '../src/server/tenant-store.ts';
import {BotStore} from '../src/server/bot-store.ts';
import {RunStore} from '../src/server/run-store.ts';
import {ApprovalStore} from '../src/server/approval-store.ts';
import {GoogleAuthService,type IdentityProvider} from '../src/server/google-auth.ts';
import {createAuthServer} from '../src/server/auth-http.ts';
const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);if(!port)throw new Error('Disposable MySQL port required');
const mysqlCredentials = mysqlTestCredentials(port);
test('action approval cards and decisions are disabled; sign-in takeover is handled by Computer',async()=>{
 const db=`grok_approve_http_${randomUUID().replaceAll('-','')}`,admin=await mysql.createConnection(mysqlCredentials);await admin.query(`CREATE DATABASE \`${db}\``);
 const pool=mysql.createPool({...mysqlCredentials,database:db,timezone:'Z'}),ids=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool),approvals=new ApprovalStore(pool);await ids.migrate();await bots.migrate();await runs.migrate();await approvals.migrate();
 const net=await import('node:net'),reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const httpPort=(reservation.address() as import('node:net').AddressInfo).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 const origin=`http://127.0.0.1:${httpPort}`,base=origin+'/grok-bot',provider:IdentityProvider={authorizationUrl:()=>'',exchange:async()=>({})};const server=createAuthServer(new GoogleAuthService(ids,provider,base),base,undefined,bots,runs,approvals);server.listen(httpPort,'127.0.0.1');await once(server,'listening');
 const login=async(subject:string)=>{const id=await ids.signInGoogle({subject,email:`${subject}@example.test`,name:subject}),token=randomBytes(32).toString('base64url');await ids.createSession(createHash('sha256').update(token).digest('hex'),id.userId,id.tenantId,new Date(Date.now()+60000));return {...id,email:`${subject}@example.test`,name:subject,role:'owner',cookie:`coke_grok_session=${token}`} };
 try{
  const a=await login('a'),b=await login('b'),bot=await bots.create(a,{name:'A',shape:'round',color:'#abcdef'}),run=await runs.create(a,bot.id,randomUUID(),'task');assert.ok(run);
  const request=(path:string,cookie='',init:RequestInit={})=>fetch(base+path,{...init,headers:{cookie,...init.headers}}),listPath=`/api/runs/${run.id}/approvals`,approvalId=randomUUID(),decisionPath=`/api/approvals/${approvalId}`;
  const decide=(cookie:string,from=origin)=>request(decisionPath,cookie,{method:'POST',headers:{origin:from,'content-type':'application/json'},body:JSON.stringify({decision:'approved'})});
  assert.equal((await request(listPath)).status,401);assert.equal((await request(listPath,b.cookie)).status,404);
  const list=await request(listPath,a.cookie);assert.equal(list.status,200);assert.deepEqual((await list.json() as {approvals:unknown[]}).approvals,[]);
  assert.equal((await request(`/api/approvals/${approvalId}/screenshot`,a.cookie)).status,404);
  assert.equal((await decide(a.cookie,'https://evil.example')).status,403);
  const decision=await decide(a.cookie);assert.equal(decision.status,410);assert.match((await decision.json() as {error:string}).error,/Per-action approvals are disabled/);
  assert.equal((await request(decisionPath,a.cookie)).status,405);
  const [rows]=await pool.execute<import('mysql2/promise').RowDataPacket[]>('SELECT COUNT(*) AS count FROM run_approvals');assert.equal(Number(rows[0]?.count),0);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();await admin.query(`DROP DATABASE \`${db}\``);await admin.end()}
});
