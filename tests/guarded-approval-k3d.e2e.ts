/** Real worker, approval API and database; test identities and temporary data only. */
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import type {RowDataPacket} from 'mysql2/promise';
import { mysqlTestCredentials } from './helpers/mysql-test-credentials.ts';
import {desktopIdentity,desktopResources} from '../src/server/desktop-resources.ts';
import {TenantStore} from '../src/server/tenant-store.ts';
import {BotStore} from '../src/server/bot-store.ts';
import {RunStore} from '../src/server/run-store.ts';
import {ApprovalStore} from '../src/server/approval-store.ts';
import {ComputerBridge} from '../src/server/computer-bridge.ts';
import {HttpGuardedComputerWorker} from '../src/server/guarded-worker.ts';
import {SafeDiagnosticError} from '../src/server/safe-diagnostics.ts';
const image=process.env.COKE_GROK_DESKTOP_TEST_IMAGE,mysqlPort=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);if(!image||!mysqlPort)throw new Error('Pinned image and disposable MySQL port required');
const mysqlCredentials=mysqlTestCredentials(mysqlPort);
const db=`grok_guard_test_${randomUUID().replaceAll('-','')}`;let namespace='',created=false,dbCreated=false,forward:import('node:child_process').ChildProcess|undefined,pool:mysql.Pool|undefined,admin:mysql.Connection|undefined;
async function exec(args:string[],input?:string,timeout=120_000){const child=spawn('kubectl',args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{out+=chunk});child.stderr.resume();child.stdin.end(input);const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);try{const [code]=await once(child,'close') as [number|null];return {code:code??1,out}}finally{clearTimeout(timer)}}
async function kubectl(args:string[],input?:string,timeout?:number){const r=await exec(args,input,timeout);if(r.code!==0)throw new Error(`Kubernetes test operation failed: ${args.slice(0,3).join(' ')}`);return r.out}
try{
 assert.equal((await kubectl(['config','current-context'])).trim(),'k3d-tp1121-sandbox-dev');
 admin=await mysql.createConnection(mysqlCredentials);await admin.query(`CREATE DATABASE \`${db}\``);dbCreated=true;pool=mysql.createPool({...mysqlCredentials,database:db,timezone:'Z'});
 const ids=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool),approvals=new ApprovalStore(pool);await ids.migrate();await bots.migrate();await runs.migrate();await approvals.migrate();
 const owner=await ids.signInGoogle({subject:'guard-owner',email:'guard@example.test',name:'Guard Owner'}),session={...owner,email:'guard@example.test',name:'Guard Owner',role:'owner'},bot=await bots.create(session,{name:'Guard Bot',color:'#abcdef',shape:'round'}),run=await runs.create(session,bot.id,randomUUID(),'Guarded test');assert.ok(run);const claim=await runs.claimNext(session,60);assert.ok(claim);
 const identity=desktopIdentity(owner,randomBytes(32));namespace=identity.namespace;const resources=desktopResources(identity,{image,controlNamespace:'coke-grok-bot',gatewayCA:'-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----',guarded:true});
 await kubectl(['create','-f','-'],JSON.stringify(resources[0]));created=true;await kubectl(['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:resources.slice(1)}));await kubectl(['-n',namespace,'rollout','status','deployment/desktop','--timeout=150s'],undefined,160_000);
 const pod=(await kubectl(['-n',namespace,'get','pods','-l','app=grok-desktop','-o','jsonpath={.items[0].metadata.name}'])).trim();
 const fixture=`<!doctype html><title>Approval test</title><button onclick="document.getElementById('result').textContent='APPROVED_CLICK_OK'">Submit test</button><p id="result">Waiting</p>`;
 await kubectl(['-n',namespace,'exec',pod,'-c','agent','--','node','-e',`const f=require('fs'),p='/workspace/tasks/${run.id}';f.mkdirSync(p,{recursive:true,mode:0o770});f.writeFileSync(p+'/guard.html',${JSON.stringify(fixture)},{mode:0o664})`]);
 forward=spawn('kubectl',['-n',namespace,'port-forward','service/desktop',':8082'],{stdio:['ignore','pipe','pipe']});forward.stderr!.resume();const workerPort=await new Promise<number>((resolve,reject)=>{let out='';forward!.stdout!.on('data',c=>{out+=String(c);const m=out.match(/127\.0\.0\.1:(\d+) -> 8082/);if(m)resolve(Number(m[1]))});forward!.once('exit',()=>reject(new Error('Worker port-forward exited')));setTimeout(()=>reject(new Error('Worker port-forward timeout')),15000).unref()});
 const local=`http://127.0.0.1:${workerPort}`,request=(path:string,body?:unknown)=>fetch(local+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${identity.controlToken}`,'x-coke-grok-screen-id':bot.id,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 const snap=async()=>{const response=await request('/v1/guarded/snapshot');assert.equal(response.status,200);return response.json()};
 const open=await request('/v1/guarded/execute',{expected:await snap(),action:{kind:'browser',action:'open_artifact',taskId:run.id,path:'guard.html'}});assert.equal(open.status,200);await new Promise(resolve=>setTimeout(resolve,1500));
 const transport:typeof fetch=async(url,init)=>fetch(local+new URL(String(url)).pathname,init);
 const worker=new HttpGuardedComputerWorker(owner,bot.id,new URL(`http://desktop.${namespace}.svc.cluster.local:8082/`),identity.controlToken,run.id,transport),bridge=new ComputerBridge(runs,approvals,()=>worker),signal=new AbortController().signal;
 const scope={owner:{tenantId:owner.tenantId,userId:owner.userId},botId:bot.id,runId:run.id,leaseId:claim.leaseId,browserTask:true},action={kind:'browser',action:'click',by:'role',role:'button',target:'Submit test'};
 const direct=await bridge.propose(scope,action,signal);assert.equal(direct.status,'completed');
 const view=await request('/v1/guarded/inspect'),observed=await view.json() as {text?:string};assert.ok(observed.text?.includes('APPROVED_CLICK_OK'));
 const [approvalRows]=await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS count FROM run_approvals');assert.equal(Number(approvalRows[0]?.count),0);
 assert.equal((await request('/v1/control',{owner:'user'})).status,200);await assert.rejects(bridge.propose(scope,action,signal),error=>error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_OWNER_USER');
 console.log('Guarded computer test passed: the requested Chromium click ran without creating an action approval; user control blocked follow-up automation.');
}finally{forward?.kill('SIGTERM');if(created)await exec(['delete','namespace',namespace,'--wait=true','--timeout=90s'],undefined,100_000);await pool?.end();if(dbCreated)await admin?.query(`DROP DATABASE \`${db}\``);await admin?.end()}
