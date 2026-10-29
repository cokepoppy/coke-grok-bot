/** Real worker, approval API and database; test identities and temporary data only. */
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {once} from 'node:events';
import {createServer as netServer} from 'node:net';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import {desktopIdentity,desktopResources} from '../src/server/desktop-resources.ts';
import {TenantStore} from '../src/server/tenant-store.ts';
import {BotStore} from '../src/server/bot-store.ts';
import {RunStore} from '../src/server/run-store.ts';
import {ApprovalStore} from '../src/server/approval-store.ts';
import {ComputerBroker} from '../src/server/computer-broker.ts';
import {HttpGuardedComputerWorker} from '../src/server/guarded-worker.ts';
import {GoogleAuthService,type IdentityProvider} from '../src/server/google-auth.ts';
import {createAuthServer} from '../src/server/auth-http.ts';
const image=process.env.COKE_GROK_DESKTOP_TEST_IMAGE,mysqlPort=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);if(!image||!mysqlPort)throw new Error('Pinned image and disposable MySQL port required');
const db=`grok_guard_test_${randomUUID().replaceAll('-','')}`;let namespace='',created=false,dbCreated=false,forward:import('node:child_process').ChildProcess|undefined,server:import('node:http').Server|undefined,pool:mysql.Pool|undefined,admin:mysql.Connection|undefined;
async function exec(args:string[],input?:string,timeout=120_000){const child=spawn('kubectl',args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{out+=chunk});child.stderr.resume();child.stdin.end(input);const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);try{const [code]=await once(child,'close') as [number|null];return {code:code??1,out}}finally{clearTimeout(timer)}}
async function kubectl(args:string[],input?:string,timeout?:number){const r=await exec(args,input,timeout);if(r.code!==0)throw new Error(`Kubernetes test operation failed: ${args.slice(0,3).join(' ')}`);return r.out}
try{
 assert.equal((await kubectl(['config','current-context'])).trim(),'k3d-tp1121-sandbox-dev');
 admin=await mysql.createConnection({host:'127.0.0.1',port:mysqlPort,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);dbCreated=true;pool=mysql.createPool({host:'127.0.0.1',port:mysqlPort,user:'root',database:db,timezone:'Z'});
 const ids=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool),approvals=new ApprovalStore(pool);await ids.migrate();await bots.migrate();await runs.migrate();await approvals.migrate();
 const owner=await ids.signInGoogle({subject:'guard-owner',email:'guard@example.test',name:'Guard Owner'}),session={...owner,email:'guard@example.test',name:'Guard Owner',role:'owner'},bot=await bots.create(session,{name:'Guard Bot',color:'#abcdef',shape:'round'}),run=await runs.create(session,bot.id,randomUUID(),'Guarded test');assert.ok(run);const claim=await runs.claimNext(session,60);assert.ok(claim);
 const cookie=randomBytes(32).toString('base64url');await ids.createSession(createHash('sha256').update(cookie).digest('hex'),owner.userId,owner.tenantId,new Date(Date.now()+120_000));
 const identity=desktopIdentity(owner,randomBytes(32));namespace=identity.namespace;const resources=desktopResources(identity,{image,controlNamespace:'coke-grok-bot',gatewayCA:'-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----',guarded:true});
 await kubectl(['create','-f','-'],JSON.stringify(resources[0]));created=true;await kubectl(['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:resources.slice(1)}));await kubectl(['-n',namespace,'rollout','status','deployment/desktop','--timeout=150s'],undefined,160_000);
 const pod=(await kubectl(['-n',namespace,'get','pods','-l','app=grok-desktop','-o','jsonpath={.items[0].metadata.name}'])).trim();
 const fixture=`<!doctype html><title>Approval test</title><button onclick="document.getElementById('result').textContent='APPROVED_CLICK_OK'">Submit test</button><p id="result">Waiting</p>`;
 await kubectl(['-n',namespace,'exec',pod,'-c','agent','--','node','-e',`const f=require('fs'),p='/workspace/tasks/${run.id}';f.mkdirSync(p,{recursive:true,mode:0o770});f.writeFileSync(p+'/guard.html',${JSON.stringify(fixture)},{mode:0o664})`]);
 forward=spawn('kubectl',['-n',namespace,'port-forward','service/desktop',':8082'],{stdio:['ignore','pipe','pipe']});forward.stderr!.resume();const workerPort=await new Promise<number>((resolve,reject)=>{let out='';forward!.stdout!.on('data',c=>{out+=String(c);const m=out.match(/127\.0\.0\.1:(\d+) -> 8082/);if(m)resolve(Number(m[1]))});forward!.once('exit',()=>reject(new Error('Worker port-forward exited')));setTimeout(()=>reject(new Error('Worker port-forward timeout')),15000).unref()});
 const local=`http://127.0.0.1:${workerPort}`,request=(path:string,body?:unknown)=>fetch(local+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${identity.controlToken}`,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 const snap=async()=>{const response=await request('/v1/guarded/snapshot');assert.equal(response.status,200);return response.json()};
 const open=await request('/v1/guarded/execute',{expected:await snap(),action:{kind:'browser',action:'open_artifact',taskId:run.id,path:'guard.html'}});assert.equal(open.status,200);await new Promise(resolve=>setTimeout(resolve,1500));
 const transport:typeof fetch=async(url,init)=>fetch(local+new URL(String(url)).pathname,init);
 const worker=new HttpGuardedComputerWorker(owner,new URL(`http://desktop.${namespace}.svc.cluster.local:8082/`),identity.controlToken,run.id,transport),broker=new ComputerBroker(approvals,worker),signal=new AbortController().signal;
 const action={kind:'browser',action:'click',by:'role',role:'button',target:'Submit test'},proposal=await broker.propose(run.id,claim.leaseId,action,signal);
 await assert.rejects(broker.execute(run.id,claim.leaseId,proposal.id,action,signal));
 const before=await request('/v1/guarded/inspect'),beforeBody=await before.json() as {text?:string};assert.ok(beforeBody.text?.includes('Waiting'));
 const reserve=netServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=(reserve.address() as import('node:net').AddressInfo).port;await new Promise<void>(resolve=>reserve.close(()=>resolve()));
 const origin=`http://127.0.0.1:${port}`,base=origin+'/grok-bot',provider:IdentityProvider={authorizationUrl:()=>'',exchange:async()=>({})};server=createAuthServer(new GoogleAuthService(ids,provider,base),base,undefined,bots,runs,approvals);server.listen(port,'127.0.0.1');await once(server,'listening');
 const approval=await fetch(`${base}/api/approvals/${proposal.id}`,{method:'POST',headers:{cookie:`coke_grok_session=${cookie}`,origin,'content-type':'application/json'},body:JSON.stringify({decision:'approved'})});assert.equal(approval.status,200);
 await broker.execute(run.id,claim.leaseId,proposal.id,action,signal);
 const view=await request('/v1/guarded/inspect'),observed=await view.json() as {text?:string};assert.ok(observed.text?.includes('APPROVED_CLICK_OK'));
 await assert.rejects(broker.execute(run.id,claim.leaseId,proposal.id,action,signal));
 const changedProposal=await broker.propose(run.id,claim.leaseId,action,signal);assert.equal(await approvals.decide(session,changedProposal.id,'approved'),'decided');assert.equal((await request('/v1/control',{owner:'user'})).status,200);await assert.rejects(broker.execute(run.id,claim.leaseId,changedProposal.id,action,signal));
 console.log('Guarded approval test passed: authenticated decision enabled one real Chromium click; unapproved, repeat and user-takeover actions were denied.');
}finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));forward?.kill('SIGTERM');if(created)await exec(['delete','namespace',namespace,'--wait=false'],undefined,20_000);await pool?.end();if(dbCreated)await admin?.query(`DROP DATABASE \`${db}\``);await admin?.end()}
