/** Real Pi, isolated desktop, test-user approval and model. Never logs credentials. */
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer as netServer} from 'node:net';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import {TenantStore} from '../src/server/tenant-store.ts';
import {BotStore} from '../src/server/bot-store.ts';
import {RunStore} from '../src/server/run-store.ts';
import {ApprovalStore} from '../src/server/approval-store.ts';
import {RunScheduler} from '../src/server/run-scheduler.ts';
import {PiExecutor} from '../src/server/pi-executor.ts';
import {ModelGateway} from '../src/server/model-gateway.ts';
import {ComputerBridge} from '../src/server/computer-bridge.ts';
import {HttpGuardedComputerWorker} from '../src/server/guarded-worker.ts';
import {desktopIdentity,splitDesktopResources} from '../src/server/desktop-resources.ts';
import {GoogleAuthService,type IdentityProvider} from '../src/server/google-auth.ts';
import {createAuthServer} from '../src/server/auth-http.ts';
const mysqlPort=Number(process.env.COKE_GROK_TEST_MYSQL_PORT),keyFile=process.env.COKE_GROK_MODEL_KEY_FILE,image=process.env.COKE_GROK_DESKTOP_TEST_IMAGE;
if(!mysqlPort||!keyFile||!image)throw new Error('Disposable MySQL, private model key and pinned desktop image required');
const dir=await mkdtemp(join(tmpdir(),'grok-mediated-pi-')),db=`grok_mediated_${randomUUID().replaceAll('-','')}`;
let namespace='',namespaceCreated=false,dbCreated=false,admin:mysql.Connection|undefined,pool:mysql.Pool|undefined,server:import('node:http').Server|undefined,gatewayServer:import('node:http').Server|undefined,gateway:ModelGateway|undefined,scheduler:RunScheduler|undefined;
const forwards:import('node:child_process').ChildProcess[]=[];let modelCalls=0;
async function exec(command:string,args:string[],input?:string,timeout=120_000){const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.setEncoding('utf8');child.stdout.on('data',c=>{out=(out+c).slice(-100000)});child.stderr.resume();child.stdin.end(input);const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);try{const [code]=await once(child,'close') as [number|null];return {code:code??1,out}}finally{clearTimeout(timer)}}
async function run(command:string,args:string[],input?:string,timeout?:number){const result=await exec(command,args,input,timeout);if(result.code!==0)throw new Error(`${command} test operation failed`);return result.out}
async function portForward(service:string,target:number){const child=spawn('kubectl',['-n',namespace,'port-forward',`service/${service}`,`:${target}`],{stdio:['ignore','pipe','pipe']});forwards.push(child);child.stderr!.resume();return new Promise<number>((resolve,reject)=>{let out='';child.stdout!.on('data',c=>{out+=String(c);const m=out.match(new RegExp(`127\\.0\\.0\\.1:(\\d+) -> ${target}`));if(m)resolve(Number(m[1]))});child.once('exit',()=>reject(new Error('Port-forward exited')));setTimeout(()=>reject(new Error('Port-forward timeout')),15000).unref()})}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 assert.equal((await run('kubectl',['config','current-context'])).trim(),'k3d-tp1121-sandbox-dev');
 admin=await mysql.createConnection({host:'127.0.0.1',port:mysqlPort,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);dbCreated=true;pool=mysql.createPool({host:'127.0.0.1',port:mysqlPort,user:'root',database:db,timezone:'Z',connectionLimit:10});
 const ids=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool),approvals=new ApprovalStore(pool);await ids.migrate();await bots.migrate();await runs.migrate();await approvals.migrate();
 const owner=await ids.signInGoogle({subject:'mediated-owner',email:'mediated@example.test',name:'Mediated Owner'}),session={...owner,email:'mediated@example.test',name:'Mediated Owner',role:'owner'},bot=await bots.create(session,{name:'Mediated Bot',color:'#abcdef',shape:'round'});
 const cookie=randomBytes(32).toString('base64url');await ids.createSession(createHash('sha256').update(cookie).digest('hex'),owner.userId,owner.tenantId,new Date(Date.now()+600_000));
 const identity=desktopIdentity(owner,randomBytes(32));namespace=identity.namespace;
 const cert=join(dir,'cert.pem'),key=join(dir,'key.pem');await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=host.k3d.internal','-addext','subjectAltName=DNS:host.k3d.internal']);
 let workerPort=0;const workerTransport:typeof fetch=async(url,init)=>fetch(`http://127.0.0.1:${workerPort}${new URL(String(url)).pathname}`,init);
 const bridge=new ComputerBridge(runs,approvals,scope=>new HttpGuardedComputerWorker(scope.owner,new URL(`http://desktop.${namespace}.svc.cluster.local:8082/`),identity.controlToken,scope.runId,workerTransport));
 gateway=new ModelGateway((await readFile(keyFile,'utf8')).trim(),'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1','deepseek-v4.1-flash',async(url,init)=>{modelCalls++;return fetch(url,init)},approvals,bridge);
 gatewayServer=gateway.createServer({key:await readFile(key),cert:await readFile(cert)});gatewayServer.listen(0,'0.0.0.0');await once(gatewayServer,'listening');const gatewayAddr=gatewayServer.address();if(!gatewayAddr||typeof gatewayAddr==='string')throw new Error('No gateway port');
 const resources=splitDesktopResources(identity,{image,controlNamespace:'coke-grok-bot',gatewayCA:await readFile(cert,'utf8')});
 const agentDeployment=resources.find(x=>x.kind==='Deployment'&&(x.metadata as {name:string}).name==='agent') as any;agentDeployment.spec.template.spec.hostAliases=[{ip:'192.168.65.254',hostnames:['host.k3d.internal']}];
 const agentPolicy=resources.find(x=>x.kind==='NetworkPolicy'&&(x.metadata as {name:string}).name==='agent-isolation') as any;agentPolicy.spec.egress.push({to:[{ipBlock:{cidr:'192.168.65.254/32'}}],ports:[{protocol:'TCP',port:gatewayAddr.port}]});
 await run('kubectl',['create','-f','-'],JSON.stringify(resources[0]));namespaceCreated=true;await run('kubectl',['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:resources.slice(1)}));
 await run('kubectl',['-n',namespace,'rollout','status','deployment/agent','--timeout=150s'],undefined,160_000);await run('kubectl',['-n',namespace,'rollout','status','deployment/desktop','--timeout=150s'],undefined,160_000);
 const pod=(await run('kubectl',['-n',namespace,'get','pods','-l','app=grok-agent','-o','jsonpath={.items[0].metadata.name}'])).trim();workerPort=await portForward('desktop',8082);const agentPort=await portForward('agent',8083);
 const reserve=netServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const apiPort=(reserve.address() as import('node:net').AddressInfo).port;await new Promise<void>(resolve=>reserve.close(()=>resolve()));const origin=`http://127.0.0.1:${apiPort}`,base=origin+'/grok-bot',provider:IdentityProvider={authorizationUrl:()=>'',exchange:async()=>({})};server=createAuthServer(new GoogleAuthService(ids,provider,base),base,undefined,bots,runs,approvals);server.listen(apiPort,'127.0.0.1');await once(server,'listening');
 const apiCookie=`coke_grok_session=${cookie}`,path=`${base}/api/bots/${bot.id}/runs`,requestId=randomUUID();
 const submit=await fetch(path,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify({requestId,prompt:'Use computer_browser to inspect the current page and click the button named Submit test. Inspect the page again and report success only if it says MEDIATED_CLICK_OK.'})});assert.equal(submit.status,200);const {run:task}=await submit.json() as {run:{id:string}};
 const fixture=`<!doctype html><title>Mediated test</title><button onclick="document.getElementById('result').textContent='MEDIATED_CLICK_OK '+(++window.clickCount)">Submit test</button><p id="result">Waiting</p><script>window.clickCount=0</script>`;
 await run('kubectl',['-n',namespace,'exec',pod,'-c','agent','--','node','-e',`const f=require('fs'),p='/workspace/tasks/${task.id}';f.mkdirSync(p,{recursive:true,mode:0o770});f.writeFileSync(p+'/fixture.html',${JSON.stringify(fixture)},{mode:0o664})`]);
 const workerRequest=(path:string,body?:unknown)=>fetch(`http://127.0.0.1:${workerPort}${path}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${identity.controlToken}`,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const snap=await workerRequest('/v1/guarded/snapshot');assert.equal(snap.status,200);const open=await workerRequest('/v1/guarded/execute',{expected:await snap.json(),action:{kind:'browser',action:'open_artifact',taskId:task.id,path:'fixture.html'}});assert.equal(open.status,200);await sleep(1500);
 const executor=new PiExecutor({connect:async()=>({agentUrl:new URL(`http://agent.${namespace}.svc.cluster.local:8083/`),agentToken:identity.agentToken})},gateway,`https://host.k3d.internal:${gatewayAddr.port}/v1`,'deepseek-v4.1-flash',async(url,init)=>fetch(`http://127.0.0.1:${agentPort}${new URL(String(url)).pathname}`,init));
 scheduler=new RunScheduler(runs,executor,{concurrency:1,leaseSeconds:30});await scheduler.tick();let approved=0,status='';
 for(let i=0;i<220;i++){
  const list=await fetch(`${base}/api/runs/${task.id}/approvals`,{headers:{cookie:apiCookie}}),items=(await list.json() as {approvals:{id:string;status:string;action:string;hasScreenshot:boolean}[]}).approvals;
  for(const item of items.filter(x=>x.status==='pending')){
   const description=JSON.parse(item.action) as {kind:string;action:string;arguments:{target?:string};screenshotSha256:string};assert.equal(description.kind,'browser');assert.equal(description.action,'click');assert.equal(description.arguments.target,'Submit test');assert.equal(item.hasScreenshot,true);
   const screenshot=await fetch(`${base}/api/approvals/${item.id}/screenshot`,{headers:{cookie:apiCookie}});assert.equal(screenshot.status,200);assert.equal(screenshot.headers.get('content-type'),'image/png');assert.equal(createHash('sha256').update(Buffer.from(await screenshot.arrayBuffer())).digest('hex'),description.screenshotSha256);
   const before=await workerRequest('/v1/guarded/inspect'),view=await before.json() as {text?:string};assert.ok(view.text?.includes('Waiting'));assert.equal(view.text?.includes('MEDIATED_CLICK_OK'),false);
   const decision=await fetch(`${base}/api/approvals/${item.id}`,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify({decision:'approved'})});assert.equal(decision.status,200);approved++;
  }
  const result=await fetch(path,{headers:{cookie:apiCookie}}),rows=(await result.json() as {runs:{id:string;status:string}[]}).runs;status=rows.find(x=>x.id===task.id)?.status||'';if(['completed','failed','unknown'].includes(status))break;await sleep(1000);
 }
 if(status!=='completed')throw new Error(`Mediated Pi task did not complete: ${status}; approved ${approved}; model calls ${modelCalls}`);
 assert.equal(approved,1);const final=await workerRequest('/v1/guarded/inspect'),view=await final.json() as {text?:string};assert.ok(view.text?.includes('MEDIATED_CLICK_OK'));
 const eventResponse=await fetch(`${base}/api/runs/${task.id}/events`,{headers:{cookie:apiCookie}}),events=await eventResponse.json() as {events:{status:string}[]};assert.deepEqual(events.events.map(x=>x.status),['queued','running','completed']);
 const next=await fetch(path,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),prompt:'Use computer_browser to inspect the current page and click the button named Submit test once. Return a short result.'})});assert.equal(next.status,200);const second=(await next.json() as {run:{id:string}}).run;
 let pending=false;
 for(let i=0;i<120;i++){
  await scheduler.tick();const list=await fetch(`${base}/api/runs/${second.id}/approvals`,{headers:{cookie:apiCookie}}),items=(await list.json() as {approvals:{status:string}[]}).approvals;
  if(items.some(x=>x.status==='pending')){pending=true;break}
  const result=await fetch(path,{headers:{cookie:apiCookie}}),row=(await result.json() as {runs:{id:string;status:string}[]}).runs.find(x=>x.id===second.id);if(row?.status==='unknown'||row?.status==='failed'||row?.status==='completed')break;await sleep(1000);
 }
 assert.equal(pending,true);
 assert.equal((await workerRequest('/v1/control',{owner:'user'})).status,200);
 let interrupted='';for(let i=0;i<30;i++){const result=await fetch(path,{headers:{cookie:apiCookie}}),rows=(await result.json() as {runs:{id:string;status:string}[]}).runs;interrupted=rows.find(x=>x.id===second.id)?.status||'';if(interrupted==='unknown')break;await sleep(1000)}assert.equal(interrupted,'unknown');
 assert.equal((await workerRequest('/v1/control',{owner:'agent'})).status,200);
 const afterTakeover=await workerRequest('/v1/guarded/inspect'),afterView=await afterTakeover.json() as {text?:string};assert.ok(afterView.text?.includes('MEDIATED_CLICK_OK 1'));assert.equal(afterView.text?.includes('MEDIATED_CLICK_OK 2'),false);
 await scheduler.tick();await sleep(1000);const confirmed=await fetch(path,{headers:{cookie:apiCookie}}),confirmedRows=(await confirmed.json() as {runs:{id:string;status:string}[]}).runs;assert.equal(confirmedRows.find(x=>x.id===second.id)?.status,'unknown');
 console.log(`Mediated Pi test passed: separate K3D Pods, approval before one real browser click, and running-task takeover without a second click; model calls ${modelCalls}.`);
}finally{await scheduler?.stop();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));for(const p of forwards)p.kill('SIGTERM');gateway?.close();if(gatewayServer)await new Promise<void>(resolve=>gatewayServer!.close(()=>resolve()));if(namespaceCreated)await exec('kubectl',['delete','namespace',namespace,'--wait=false'],undefined,20_000);await pool?.end();if(dbCreated)await admin?.query(`DROP DATABASE \`${db}\``);await admin?.end();await rm(dir,{recursive:true,force:true})}
