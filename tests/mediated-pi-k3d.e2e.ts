/** Real Pi, isolated desktop, test-user approval and model. Never logs credentials. */
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
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
import {BotMemoryStore} from '../src/server/bot-memory-store.ts';
import {BotMemoryBridge} from '../src/server/bot-memory-bridge.ts';
import {RunScheduler} from '../src/server/run-scheduler.ts';
import {DshExecutor,PiExecutor} from '../src/server/pi-executor.ts';
import {ModelGateway} from '../src/server/model-gateway.ts';
import {ComputerBridge} from '../src/server/computer-bridge.ts';
import {HttpGuardedComputerWorker} from '../src/server/guarded-worker.ts';
import {desktopIdentity,splitDesktopResources} from '../src/server/desktop-resources.ts';
import {GoogleAuthService,type IdentityProvider} from '../src/server/google-auth.ts';
import {createAuthServer} from '../src/server/auth-http.ts';
import {UserComputer} from '../src/server/user-computer.ts';
const mysqlPort=Number(process.env.COKE_GROK_TEST_MYSQL_PORT),keyFile=process.env.COKE_GROK_MODEL_KEY_FILE,image=process.env.COKE_GROK_DESKTOP_TEST_IMAGE;
const memoryOnly=process.argv.includes('--memory-only');
if(!mysqlPort||!keyFile||!image)throw new Error('Disposable MySQL, private model key and pinned desktop image required');
const dir=await mkdtemp(join(tmpdir(),'grok-mediated-pi-')),db=`grok_mediated_${randomUUID().replaceAll('-','')}`;
let namespace='',namespaceCreated=false,dbCreated=false,admin:mysql.Connection|undefined,pool:mysql.Pool|undefined,server:import('node:http').Server|undefined,gatewayServer:import('node:http').Server|undefined,gateway:ModelGateway|undefined,scheduler:RunScheduler|undefined;
const forwards:import('node:child_process').ChildProcess[]=[];let modelCalls=0;
let dshComputerScreenshots=0,dshComputerInspections=0;
async function exec(command:string,args:string[],input?:string,timeout=120_000){const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.setEncoding('utf8');child.stdout.on('data',c=>{out=(out+c).slice(-100000)});child.stderr.resume();child.stdin.end(input);const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);try{const [code]=await once(child,'close') as [number|null];return {code:code??1,out}}finally{clearTimeout(timer)}}
async function run(command:string,args:string[],input?:string,timeout?:number){const result=await exec(command,args,input,timeout);if(result.code!==0)throw new Error(`${command} test operation failed`);return result.out}
async function portForward(service:string,target:number){const child=spawn('kubectl',['-n',namespace,'port-forward',`service/${service}`,`:${target}`],{stdio:['ignore','pipe','pipe']});forwards.push(child);child.stderr!.resume();return new Promise<number>((resolve,reject)=>{let out='';child.stdout!.on('data',c=>{out+=String(c);const m=out.match(new RegExp(`127\\.0\\.0\\.1:(\\d+) -> ${target}`));if(m)resolve(Number(m[1]))});child.once('exit',()=>reject(new Error('Port-forward exited')));setTimeout(()=>reject(new Error('Port-forward timeout')),15000).unref()})}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 assert.equal((await run('kubectl',['config','current-context'])).trim(),'k3d-tp1121-sandbox-dev');
 admin=await mysql.createConnection({host:'127.0.0.1',port:mysqlPort,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);dbCreated=true;pool=mysql.createPool({host:'127.0.0.1',port:mysqlPort,user:'root',database:db,timezone:'Z',connectionLimit:10});
 const ids=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool),approvals=new ApprovalStore(pool),memories=new BotMemoryStore(pool);await ids.migrate();await bots.migrate();await runs.migrate();await approvals.migrate();await memories.migrate();
 const owner=await ids.signInGoogle({subject:'mediated-owner',email:'mediated@example.test',name:'Mediated Owner'}),session={...owner,email:'mediated@example.test',name:'Mediated Owner',role:'owner'},bot=await bots.create(session,{name:'Mediated Bot',color:'#abcdef',shape:'round'});
 const cookie=randomBytes(32).toString('base64url');await ids.createSession(createHash('sha256').update(cookie).digest('hex'),owner.userId,owner.tenantId,new Date(Date.now()+600_000));
 const identity=desktopIdentity(owner,randomBytes(32));namespace=identity.namespace;
 const cert=join(dir,'cert.pem'),key=join(dir,'key.pem');await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=host.k3d.internal','-addext','subjectAltName=DNS:host.k3d.internal']);
 let workerPort=0;const workerTransport:typeof fetch=async(url,init)=>fetch(`http://127.0.0.1:${workerPort}${new URL(String(url)).pathname}`,init);
 const bridge=new ComputerBridge(runs,approvals,scope=>new HttpGuardedComputerWorker(scope.owner,new URL(`http://desktop.${namespace}.svc.cluster.local:8082/`),identity.controlToken,scope.runId,workerTransport));
 const captureScreenshot=bridge.screenshot.bind(bridge),inspectComputer=bridge.inspect.bind(bridge);
 bridge.screenshot=async(...args:Parameters<typeof bridge.screenshot>)=>{dshComputerScreenshots++;return captureScreenshot(...args)};
 bridge.inspect=async(...args:Parameters<typeof bridge.inspect>)=>{dshComputerInspections++;return inspectComputer(...args)};
 const memoryBridge=new BotMemoryBridge(memories),memoryCalls={list:0,remember:0,forget:0};
 const memoryList=memoryBridge.list.bind(memoryBridge),memoryRemember=memoryBridge.remember.bind(memoryBridge),memoryForget=memoryBridge.forget.bind(memoryBridge);
 memoryBridge.list=async(...args:Parameters<typeof memoryBridge.list>)=>{memoryCalls.list++;return memoryList(...args)};
 memoryBridge.remember=async(...args:Parameters<typeof memoryBridge.remember>)=>{memoryCalls.remember++;return memoryRemember(...args)};
 memoryBridge.forget=async(...args:Parameters<typeof memoryBridge.forget>)=>{memoryCalls.forget++;return memoryForget(...args)};
 gateway=new ModelGateway((await readFile(keyFile,'utf8')).trim(),'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1','deepseek-v4.1-flash',async(url,init)=>{modelCalls++;return fetch(url,init)},approvals,bridge,memoryBridge);
 gatewayServer=gateway.createServer({key:await readFile(key),cert:await readFile(cert)});gatewayServer.listen(0,'0.0.0.0');await once(gatewayServer,'listening');const gatewayAddr=gatewayServer.address();if(!gatewayAddr||typeof gatewayAddr==='string')throw new Error('No gateway port');
 const resources=splitDesktopResources(identity,{image,controlNamespace:'coke-grok-bot',gatewayCA:await readFile(cert,'utf8')});
 const agentDeployment=resources.find(x=>x.kind==='Deployment'&&(x.metadata as {name:string}).name==='agent') as any;agentDeployment.spec.template.spec.hostAliases=[{ip:'192.168.65.254',hostnames:['host.k3d.internal']}];
 const agentPolicy=resources.find(x=>x.kind==='NetworkPolicy'&&(x.metadata as {name:string}).name==='agent-isolation') as any;agentPolicy.spec.egress.push({to:[{ipBlock:{cidr:'192.168.65.254/32'}}],ports:[{protocol:'TCP',port:gatewayAddr.port}]});
 await run('kubectl',['create','-f','-'],JSON.stringify(resources[0]));namespaceCreated=true;await run('kubectl',['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:resources.slice(1)}));
 await run('kubectl',['-n',namespace,'rollout','status','deployment/agent','--timeout=150s'],undefined,160_000);await run('kubectl',['-n',namespace,'rollout','status','deployment/desktop','--timeout=150s'],undefined,160_000);
 const pod=(await run('kubectl',['-n',namespace,'get','pods','-l','app=grok-agent','-o','jsonpath={.items[0].metadata.name}'])).trim();workerPort=await portForward('desktop',8082);const agentPort=await portForward('agent',8083);
 const reserve=netServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const apiPort=(reserve.address() as import('node:net').AddressInfo).port;await new Promise<void>(resolve=>reserve.close(()=>resolve()));const origin=`http://127.0.0.1:${apiPort}`,base=origin+'/grok-bot',provider:IdentityProvider={authorizationUrl:()=>'',exchange:async()=>({})};
 const userComputer=new UserComputer(scope=>new HttpGuardedComputerWorker(scope,new URL(`http://desktop.${namespace}.svc.cluster.local:8082/`),identity.controlToken,randomUUID(),workerTransport));
 server=createAuthServer(new GoogleAuthService(ids,provider,base),base,undefined,bots,runs,approvals,userComputer);server.listen(apiPort,'127.0.0.1');await once(server,'listening');
 const apiCookie=`coke_grok_session=${cookie}`,path=`${base}/api/bots/${bot.id}/runs`,requestId=randomUUID();
 const submitRun=async(botId:string,prompt:string)=>{const response=await fetch(`${base}/api/bots/${botId}/runs`,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),prompt})});assert.equal(response.status,200);return (await response.json() as {run:{id:string}}).run};
 const awaitRun=async(botId:string,runId:string)=>{const url=`${base}/api/bots/${botId}/runs`;for(let i=0;i<240;i++){const response=await fetch(url,{headers:{cookie:apiCookie}}),rows=(await response.json() as {runs:{id:string;status:string;result:string|null}[]}).runs,found=rows.find(value=>value.id===runId);assert.ok(found);if(found.status==='completed')return found;if(found.status==='failed'||found.status==='unknown')throw new Error(`Memory E2E task ended ${found.status}; resultLength=${found.result?.length||0}; memoryCalls=${JSON.stringify(memoryCalls)}`);await sleep(1000)}throw new Error(`Memory E2E task timed out; memoryCalls=${JSON.stringify(memoryCalls)}`)};
 const userPost=(route:string,body:unknown)=>fetch(`${base}/api/computer/${route}`,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify(body)});
 const executor=new PiExecutor({connect:async()=>({agentUrl:new URL(`http://agent.${namespace}.svc.cluster.local:8083/`),agentToken:identity.agentToken})},gateway,`https://host.k3d.internal:${gatewayAddr.port}/v1`,'deepseek-v4.1-flash',async(url,init)=>fetch(`http://127.0.0.1:${agentPort}${new URL(String(url)).pathname}`,init),memories);
 const dshRequest:typeof fetch=async(url,init)=>fetch(`http://127.0.0.1:${agentPort}${new URL(String(url)).pathname}`,init);
 const dshExecutor=new DshExecutor({connect:async()=>({agentUrl:new URL(`http://agent.${namespace}.svc.cluster.local:8083/`),agentToken:identity.agentToken})},gateway,`https://host.k3d.internal:${gatewayAddr.port}/v1`,'deepseek-v4.1-flash',dshRequest,memories);
 if(!memoryOnly){
 const submit=await fetch(path,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify({requestId,prompt:'Use computer_browser to inspect the current page. The Submit test button increments a counter, so click it exactly once and never click it again. After that, inspect the page and report success only if it says MEDIATED_CLICK_OK.'})});assert.equal(submit.status,200);const {run:task}=await submit.json() as {run:{id:string}};
 const fixture=`<!doctype html><title>Mediated test</title><button onclick="document.getElementById('result').textContent='MEDIATED_CLICK_OK '+(++window.clickCount)">Submit test</button><p id="result">Waiting</p><script>window.clickCount=0</script>`;
 await run('kubectl',['-n',namespace,'exec',pod,'-c','agent','--','node','-e',`const f=require('fs'),p='/workspace/tasks/${task.id}';f.mkdirSync(p,{recursive:true,mode:0o770});f.writeFileSync(p+'/fixture.html',${JSON.stringify(fixture)},{mode:0o664})`]);
 const workerRequest=(path:string,body?:unknown)=>fetch(`http://127.0.0.1:${workerPort}${path}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${identity.controlToken}`,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const snap=await workerRequest('/v1/guarded/snapshot');assert.equal(snap.status,200);const open=await workerRequest('/v1/guarded/execute',{expected:await snap.json(),action:{kind:'browser',action:'open_artifact',taskId:task.id,path:'fixture.html'}});assert.equal(open.status,200);await sleep(1500);
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
 await scheduler.stop();
 scheduler=new RunScheduler(runs,dshExecutor,{concurrency:1,leaseSeconds:30});
 const dshSubmit=await fetch(path,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),prompt:'For this task use only computer_desktop screenshot and computer_desktop click. Do not use computer_terminal, computer_files, or any shell command. Inspect the actual desktop, find the large green button, and click it using coordinates from your screenshot. Wait for owner approval. Then use computer_browser inspect to confirm DSH_MEDIATED_CLICK_OK. Do not use computer_browser click. Report success only after you inspect the result.'})});assert.equal(dshSubmit.status,200);const {run:dshTask}=await dshSubmit.json() as {run:{id:string}};
 const dshFixture=`<!doctype html><title>DSH mediated computer</title><style>html,body{width:100%;height:100%;margin:0;background:#eef3f4;font:32px sans-serif}body{display:grid;place-items:center}button{width:620px;height:240px;border:0;border-radius:32px;background:#188b62;color:white;font-size:48px;font-weight:700}#result{position:fixed;top:40px;left:40px;font-weight:700}</style><p id="result">WAITING_FOR_DSH</p><button onclick="document.getElementById('result').textContent='DSH_MEDIATED_CLICK_OK'">Run DSH computer task</button>`;
 await run('kubectl',['-n',namespace,'exec',pod,'-c','agent','--','node','-e',`const f=require('fs'),p='/workspace/tasks/${dshTask.id}';f.mkdirSync(p,{recursive:true,mode:0o770});f.writeFileSync(p+'/dsh-computer.html',${JSON.stringify(dshFixture)},{mode:0o664})`]);
 const beforeDsh=await workerRequest('/v1/guarded/snapshot');assert.equal(beforeDsh.status,200);const openedDsh=await workerRequest('/v1/guarded/execute',{expected:await beforeDsh.json(),action:{kind:'browser',action:'open_artifact',taskId:dshTask.id,path:'dsh-computer.html'}});assert.equal(openedDsh.status,200);await sleep(1500);
 await scheduler.tick();let dshStatus='',dshApprovals=0;const dshActionEvidence:{kind:string;action:string;arguments:Record<string,unknown>;visibleResult:boolean}[]=[];
 for(let i=0;i<240;i++){
  const list=await fetch(`${base}/api/runs/${dshTask.id}/approvals`,{headers:{cookie:apiCookie}}),items=(await list.json() as {approvals:{id:string;status:string;action:string;hasScreenshot:boolean}[]}).approvals;
  for(const item of items.filter(value=>value.status==='pending')){
   const description=JSON.parse(item.action) as {kind:string;action:string;arguments:{x?:number;y?:number};screenshotSha256:string};assert.equal(description.kind,'desktop');assert.equal(description.action,'click');assert.ok(Number.isInteger(description.arguments.x)&&Number.isInteger(description.arguments.y));assert.equal(item.hasScreenshot,true);
   const screenshot=await fetch(`${base}/api/approvals/${item.id}/screenshot`,{headers:{cookie:apiCookie}});assert.equal(screenshot.status,200);assert.equal(screenshot.headers.get('content-type'),'image/png');const screenshotBytes=Buffer.from(await screenshot.arrayBuffer());assert.equal(createHash('sha256').update(screenshotBytes).digest('hex'),description.screenshotSha256);await writeFile(`/tmp/coke-grok-dsh-computer-approval-${dshApprovals+1}.png`,screenshotBytes);
   const computerState=await workerRequest('/v1/guarded/inspect'),computerView=await computerState.json() as {text?:string};dshActionEvidence.push({kind:description.kind,action:description.action,arguments:description.arguments,visibleResult:Boolean(computerView.text?.includes('DSH_MEDIATED_CLICK_OK'))});
   if(dshApprovals>0){await fetch(`${base}/api/approvals/${item.id}`,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify({decision:'denied'})});throw new Error(`DSH requested a second computer mutation; actions ${JSON.stringify(dshActionEvidence)}`)}
   const decision=await fetch(`${base}/api/approvals/${item.id}`,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify({decision:'approved'})});assert.equal(decision.status,200);dshApprovals++;
  }
  const result=await fetch(path,{headers:{cookie:apiCookie}}),rows=(await result.json() as {runs:{id:string;status:string}[]}).runs;dshStatus=rows.find(value=>value.id===dshTask.id)?.status||'';if(['completed','failed','unknown'].includes(dshStatus))break;await sleep(1000);
 }
 if(dshStatus!=='completed')throw new Error(`Mediated DSH task did not complete: ${dshStatus}; approved ${dshApprovals}; model calls ${modelCalls}`);
 assert.equal(dshApprovals,1);assert.ok(dshComputerScreenshots>0,'DSH must send a real cloud-computer screenshot to the model');assert.ok(dshComputerInspections>0,'DSH must inspect the actual Chromium page');const dshFinal=await workerRequest('/v1/guarded/inspect'),dshView=await dshFinal.json() as {text?:string};assert.ok(dshView.text?.includes('DSH_MEDIATED_CLICK_OK'));
 await scheduler.stop();scheduler=new RunScheduler(runs,executor,{concurrency:1,leaseSeconds:30});
 const piTerminalFile=`pi-terminal-${task.id}.txt`;
 const piTerminalSubmit=await fetch(path,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),prompt:`Use computer_terminal once to run exactly: printf 'PI_TERMINAL_OK' > ${piTerminalFile} in the shared directory. Wait for owner approval. Then use computer_files to read ${piTerminalFile} and report its exact contents.`})});assert.equal(piTerminalSubmit.status,200);const {run:piTerminalTask}=await piTerminalSubmit.json() as {run:{id:string}};
 await scheduler.tick();let piTerminalStatus='',piTerminalApprovals=0;
 for(let i=0;i<180;i++){
  const list=await fetch(`${base}/api/runs/${piTerminalTask.id}/approvals`,{headers:{cookie:apiCookie}}),items=(await list.json() as {approvals:{id:string;status:string;action:string;hasScreenshot:boolean}[]}).approvals;
  for(const item of items.filter(value=>value.status==='pending')){
   const description=JSON.parse(item.action) as {kind:string;action:string;arguments:{command:string;directory:string};screenshotSha256:string};
   assert.equal(description.kind,'terminal');assert.equal(description.action,'run');assert.equal(description.arguments.directory,'shared');assert.ok(description.arguments.command.includes(piTerminalFile));assert.ok(item.hasScreenshot);
   const screenshot=await fetch(`${base}/api/approvals/${item.id}/screenshot`,{headers:{cookie:apiCookie}});assert.equal(screenshot.status,200);assert.equal(createHash('sha256').update(Buffer.from(await screenshot.arrayBuffer())).digest('hex'),description.screenshotSha256);
   assert.equal((await fetch(`${base}/api/approvals/${item.id}`,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify({decision:'approved'})})).status,200);piTerminalApprovals++;
  }
  const result=await fetch(path,{headers:{cookie:apiCookie}}),rows=(await result.json() as {runs:{id:string;status:string;message?:string}[]}).runs;piTerminalStatus=rows.find(value=>value.id===piTerminalTask.id)?.status||'';if(['completed','failed','unknown'].includes(piTerminalStatus))break;await sleep(1000);
 }
 if(piTerminalStatus!=='completed')throw new Error(`Mediated Pi terminal task did not complete: ${piTerminalStatus}; approvals ${piTerminalApprovals}; model calls ${modelCalls}`);
 assert.equal(piTerminalApprovals,1);assert.equal((await run('kubectl',['-n',namespace,'exec',pod,'-c','agent','--','cat',`/workspace/shared/${piTerminalFile}`])).trim(),'PI_TERMINAL_OK');
 await scheduler.stop();scheduler=new RunScheduler(runs,dshExecutor,{concurrency:1,leaseSeconds:30});
 const dshTerminalFile=`dsh-terminal-${dshTask.id}.txt`;
 const dshTerminalSubmit=await fetch(path,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),prompt:`Use computer_terminal once to run exactly: printf 'DSH_TERMINAL_OK' > ${dshTerminalFile} in the shared directory. Wait for owner approval. Then use computer_files to read ${dshTerminalFile} and report its exact contents.`})});assert.equal(dshTerminalSubmit.status,200);const {run:dshTerminalTask}=await dshTerminalSubmit.json() as {run:{id:string}};
 await scheduler.tick();let dshTerminalStatus='',dshTerminalApprovals=0,dshTerminalWriteApproved=false;
 for(let i=0;i<180;i++){
  const list=await fetch(`${base}/api/runs/${dshTerminalTask.id}/approvals`,{headers:{cookie:apiCookie}}),items=(await list.json() as {approvals:{id:string;status:string;action:string;hasScreenshot:boolean}[]}).approvals;
  for(const item of items.filter(value=>value.status==='pending')){
   const description=JSON.parse(item.action) as {kind:string;action:string;arguments:{command:string;directory:string};screenshotSha256:string};
   assert.equal(description.kind,'terminal');assert.equal(description.action,'run');assert.equal(description.arguments.directory,'shared');
   const command=description.arguments.command.trim();
   const writesTarget=command.includes(dshTerminalFile)&&command.includes('DSH_TERMINAL_OK');
   const safePreparation=/^(?:pwd|ls(?: -la|-al)?(?: \/workspace\/shared)?)$/.test(command);
   assert.ok(writesTarget||safePreparation,'DSH must request the exact sentinel write or a harmless workspace inspection');
   if(writesTarget)dshTerminalWriteApproved=true;
   assert.ok(item.hasScreenshot);
   const screenshot=await fetch(`${base}/api/approvals/${item.id}/screenshot`,{headers:{cookie:apiCookie}});assert.equal(screenshot.status,200);assert.equal(createHash('sha256').update(Buffer.from(await screenshot.arrayBuffer())).digest('hex'),description.screenshotSha256);
   assert.equal((await fetch(`${base}/api/approvals/${item.id}`,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify({decision:'approved'})})).status,200);dshTerminalApprovals++;
  }
  const result=await fetch(path,{headers:{cookie:apiCookie}}),rows=(await result.json() as {runs:{id:string;status:string}[]}).runs;dshTerminalStatus=rows.find(value=>value.id===dshTerminalTask.id)?.status||'';if(['completed','failed','unknown'].includes(dshTerminalStatus))break;await sleep(1000);
 }
 if(dshTerminalStatus!=='completed')throw new Error(`Mediated DSH terminal task did not complete: ${dshTerminalStatus}; approvals ${dshTerminalApprovals}; model calls ${modelCalls}`);
 assert.ok(dshTerminalApprovals>=1);assert.equal(dshTerminalWriteApproved,true,'DSH must request owner approval for the sentinel write');assert.equal((await run('kubectl',['-n',namespace,'exec',pod,'-c','agent','--','cat',`/workspace/shared/${dshTerminalFile}`])).trim(),'DSH_TERMINAL_OK');
 await scheduler.stop();scheduler=new RunScheduler(runs,executor,{concurrency:1,leaseSeconds:30});
 const interruptedFile=`interrupted-${randomUUID()}.txt`;
 const interruptSubmit=await fetch(path,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),prompt:`Use computer_terminal once to run exactly: sleep 8 && printf SHOULD_NOT_FINISH > ${interruptedFile} in the task directory. Wait for owner approval before starting it.`})});assert.equal(interruptSubmit.status,200);const {run:interruptTask}=await interruptSubmit.json() as {run:{id:string}};
 await scheduler.tick();let interruptApproval:{id:string}|undefined;
 for(let i=0;i<120&&!interruptApproval;i++){
  const list=await fetch(`${base}/api/runs/${interruptTask.id}/approvals`,{headers:{cookie:apiCookie}}),items=(await list.json() as {approvals:{id:string;status:string;action:string}[]}).approvals;
  const pending=items.find(value=>value.status==='pending');if(pending){const description=JSON.parse(pending.action) as {kind:string;action:string;arguments:{command:string;directory:string}};assert.equal(description.kind,'terminal');assert.equal(description.arguments.directory,'task');assert.ok(description.arguments.command.includes('sleep 8'));interruptApproval={id:pending.id};break;}
  await sleep(500);
 }
 assert.ok(interruptApproval,'Agent must request owner approval before starting a terminal command');
 assert.equal((await userPost('control',{owner:'agent'})).status,200);
 assert.equal((await fetch(`${base}/api/approvals/${interruptApproval.id}`,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify({decision:'approved'})})).status,200);
 await sleep(2000);assert.equal((await userPost('control',{owner:'user'})).status,200);
 let interruptedTerminalStatus='';for(let i=0;i<30;i++){const result=await fetch(path,{headers:{cookie:apiCookie}}),rows=(await result.json() as {runs:{id:string;status:string}[]}).runs;interruptedTerminalStatus=rows.find(value=>value.id===interruptTask.id)?.status||'';if(interruptedTerminalStatus==='unknown')break;await sleep(1000)}assert.equal(interruptedTerminalStatus,'unknown');
 await sleep(8000);const noLateWrite=await exec('kubectl',['-n',namespace,'exec',pod,'-c','agent','--','test','!','-e',`/workspace/tasks/${interruptTask.id}/${interruptedFile}`]);assert.equal(noLateWrite.code,0,'User takeover must kill an approved command before it can finish');
 assert.equal((await userPost('control',{owner:'agent'})).status,200);
 await scheduler.tick();await sleep(1000);const confirmed=await fetch(path,{headers:{cookie:apiCookie}}),confirmedRows=(await confirmed.json() as {runs:{id:string;status:string}[]}).runs;assert.equal(confirmedRows.find(value=>value.id===interruptTask.id)?.status,'unknown');
 const recovery=await fetch(`${base}/api/runs/${interruptTask.id}/recovery`,{method:'POST',headers:{cookie:apiCookie,origin,'content-type':'application/json'},body:JSON.stringify({decision:'acknowledge'})});assert.equal(recovery.status,200,'Owner must explicitly acknowledge the interrupted task before later runs can start');
 await scheduler.stop();scheduler=new RunScheduler(runs,executor,{concurrency:1,leaseSeconds:30});
 }
 if(memoryOnly)scheduler=new RunScheduler(runs,executor,{concurrency:1,leaseSeconds:30});
 const piMarker=`GROK_MEMORY_PI_${randomUUID().replaceAll('-','').slice(0,16)}`;
 const piMemorySave=await submitRun(bot.id,`Please remember this lasting preference for this Bot: when I ask for an acceptance marker, use exactly ${piMarker}. This is a synthetic test value, not a secret. Confirm after saving it. Do not use the computer.`);
 await scheduler.tick();const piMemorySaved=await awaitRun(bot.id,piMemorySave.id);assert.ok(piMemorySaved.result?.includes(piMarker));const [piMemoryRows]=await pool.execute('SELECT memory_text FROM bot_memories WHERE bot_id=? AND memory_text LIKE ?',[bot.id,`%${piMarker}%`]) as [Array<{memory_text:string}>,unknown];assert.ok(piMemoryRows.length>0,'Pi must persist the direct-user memory through bot_memory');
 await scheduler.stop();scheduler=new RunScheduler(runs,dshExecutor,{concurrency:1,leaseSeconds:30});
 const dshMarker=`GROK_MEMORY_DSH_${randomUUID().replaceAll('-','').slice(0,16)}`;
 const dshMemorySave=await submitRun(bot.id,`Please remember this lasting preference for this Bot: when I ask for a voice-output marker, use exactly ${dshMarker}. This is a synthetic test value, not a secret. Confirm after saving it. Do not use the computer.`);
 await scheduler.tick();const dshMemorySaved=await awaitRun(bot.id,dshMemorySave.id);assert.ok(dshMemorySaved.result?.includes(dshMarker));const [dshMemoryRows]=await pool.execute('SELECT memory_text FROM bot_memories WHERE bot_id=? AND memory_text LIKE ?',[bot.id,`%${dshMarker}%`]) as [Array<{memory_text:string}>,unknown];assert.ok(dshMemoryRows.length>0,'DSH must persist the direct-user memory through its plugin');
 await scheduler.stop();scheduler=new RunScheduler(runs,executor,{concurrency:1,leaseSeconds:30});
 const recall=await submitRun(bot.id,'What exact acceptance marker and voice-output marker did I ask you to remember for this Bot? Use only durable memory from earlier tasks; report both exact values and nothing else.');
 await scheduler.tick();const recalled=await awaitRun(bot.id,recall.id);assert.ok(recalled.result?.includes(piMarker)&&recalled.result?.includes(dshMarker),'Pi must recover both Pi- and DSH-written memories across tasks');
 const isolatedBot=await bots.create(session,{name:'Memory Isolation Bot',color:'#abcdef',shape:'round'}),isolatedRun=await submitRun(isolatedBot.id,'Use bot_memory to list this Bot’s saved memories. If this Bot has none, answer exactly EMPTY. Do not use another Bot’s conversation or memory.');
 await scheduler.tick();const isolatedResult=await awaitRun(isolatedBot.id,isolatedRun.id);assert.match(isolatedResult.result||'',/EMPTY|no saved memories|no memories/i);
 const [isolatedRows]=await pool.execute('SELECT id FROM bot_memories WHERE bot_id=?',[isolatedBot.id]) as [Array<{id:string}>,unknown];assert.equal(isolatedRows.length,0,'another Bot must not inherit the first Bot’s private memories');
 console.log(memoryOnly?`Mediated Pi and DSH Bot Memory K3D tests passed with Bot isolation; model calls ${modelCalls}.`:`Mediated Pi and DSH K3D tests passed: separate Pods, real DeepSeek browser/desktop/terminal/shared-file tools, approval and takeover checks, plus persistent Pi/DSH Bot memory across runs and Bot isolation; model calls ${modelCalls}.`);
}finally{await scheduler?.stop();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));for(const p of forwards)p.kill('SIGTERM');gateway?.close();if(gatewayServer)await new Promise<void>(resolve=>gatewayServer!.close(()=>resolve()));if(namespaceCreated)await exec('kubectl',['delete','namespace',namespace,'--wait=false'],undefined,20_000);await pool?.end();if(dbCreated)await admin?.query(`DROP DATABASE \`${db}\``);await admin?.end();await rm(dir,{recursive:true,force:true})}
