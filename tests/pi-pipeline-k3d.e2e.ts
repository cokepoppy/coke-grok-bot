/** Authenticated browser -> MySQL -> real Pi/model/file pipeline in disposable resources. */
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer as netServer} from 'node:net';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import {chromium} from 'playwright-core';
import {TenantStore} from '../src/server/tenant-store.ts';
import {BotStore} from '../src/server/bot-store.ts';
import {RunStore} from '../src/server/run-store.ts';
import {ApprovalStore} from '../src/server/approval-store.ts';
import {RunScheduler} from '../src/server/run-scheduler.ts';
import {DshExecutor,PiExecutor} from '../src/server/pi-executor.ts';
import {ModelGateway} from '../src/server/model-gateway.ts';
import {desktopIdentity,desktopResources} from '../src/server/desktop-resources.ts';
import {GoogleAuthService,type IdentityProvider} from '../src/server/google-auth.ts';
import {createAuthServer} from '../src/server/auth-http.ts';
const mysqlPort=Number(process.env.COKE_GROK_TEST_MYSQL_PORT),keyFile=process.env.COKE_GROK_MODEL_KEY_FILE,image=process.env.COKE_GROK_DESKTOP_TEST_IMAGE;
if(!mysqlPort||!keyFile||!image)throw new Error('Test MySQL, private model key file and pinned desktop image are required');
const dir=await mkdtemp(join(tmpdir(),'grok-pi-pipeline-')),db=`grok_pipeline_${randomUUID().replaceAll('-','')}`;
let namespace='',namespaceCreated=false,gateway:ModelGateway|undefined,gatewayServer:import('node:http').Server|undefined,apiServer:import('node:http').Server|undefined,forward:import('node:child_process').ChildProcess|undefined,vite:import('node:child_process').ChildProcess|undefined,browser:import('playwright-core').Browser|undefined,context:import('playwright-core').BrowserContext|undefined,scheduler:RunScheduler|undefined,pool:mysql.Pool|undefined,admin:mysql.Connection|undefined,dbCreated=false;
let calls=0;
async function exec(command:string,args:string[],input?:string,timeout=120_000){const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{out=(out+chunk).slice(-100_000)});child.stderr.resume();child.stdin.end(input);const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);try{const [code]=await once(child,'close') as [number|null];return {code:code??1,out}}finally{clearTimeout(timer)}}
async function run(command:string,args:string[],input?:string,timeout?:number){const r=await exec(command,args,input,timeout);if(r.code!==0)throw new Error(`${command} test operation failed`);return r.out}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const server=netServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as import('node:net').AddressInfo).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port}
try{
 assert.equal((await run('kubectl',['config','current-context'])).trim(),'k3d-tp1121-sandbox-dev');
 admin=await mysql.createConnection({host:'127.0.0.1',port:mysqlPort,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);dbCreated=true;
 pool=mysql.createPool({host:'127.0.0.1',port:mysqlPort,user:'root',database:db,timezone:'Z',connectionLimit:8});const identities=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool),approvals=new ApprovalStore(pool);await identities.migrate();await bots.migrate();await runs.migrate();await approvals.migrate();
 const owner=await identities.signInGoogle({subject:'pipeline-test',email:'pipeline@example.test',name:'Pipeline Test'}),session={...owner,email:'pipeline@example.test',name:'Pipeline Test',role:'owner'};
 const bot=await bots.create(session,{name:'Pipeline Bot',color:'#abcdef',shape:'round'}),cookieToken=randomBytes(32).toString('base64url');await identities.createSession(createHash('sha256').update(cookieToken).digest('hex'),owner.userId,owner.tenantId,new Date(Date.now()+600_000));
 const desktop=desktopIdentity(owner,randomBytes(32));namespace=desktop.namespace;
 const cert=join(dir,'cert.pem'),privateKey=join(dir,'key.pem');await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',privateKey,'-out',cert,'-days','1','-subj','/CN=host.k3d.internal','-addext','subjectAltName=DNS:host.k3d.internal']);
 gateway=new ModelGateway((await readFile(keyFile,'utf8')).trim(),'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1','deepseek-v4.1-flash',async(url,init)=>{calls++;return fetch(url,init)});
 gatewayServer=gateway.createServer({key:await readFile(privateKey),cert:await readFile(cert)});gatewayServer.listen(0,'0.0.0.0');await once(gatewayServer,'listening');const gatewayAddress=gatewayServer.address();if(!gatewayAddress||typeof gatewayAddress==='string')throw new Error('No gateway port');
 const resources=desktopResources(desktop,{image,controlNamespace:'coke-grok-bot',gatewayCA:await readFile(cert,'utf8')});
 const deployment=resources.find(x=>x.kind==='Deployment') as any;deployment.spec.template.spec.hostAliases=[{ip:'192.168.65.254',hostnames:['host.k3d.internal']}];
 const policy=resources.find(x=>x.kind==='NetworkPolicy') as any;policy.spec.egress.push({to:[{ipBlock:{cidr:'192.168.65.254/32'}}],ports:[{protocol:'TCP',port:gatewayAddress.port}]});
 await run('kubectl',['create','-f','-'],JSON.stringify(resources[0]));namespaceCreated=true;await run('kubectl',['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:resources.slice(1)}));
 await run('kubectl',['-n',namespace,'rollout','status','deployment/desktop','--timeout=150s'],undefined,160_000);
 const pod=(await run('kubectl',['-n',namespace,'get','pods','-l','app=grok-desktop','-o','jsonpath={.items[0].metadata.name}'])).trim();
 forward=spawn('kubectl',['-n',namespace,'port-forward','service/desktop',':8083'],{stdio:['ignore','pipe','pipe']});forward.stderr!.resume();
 const agentPort=await new Promise<number>((resolve,reject)=>{let text='';forward!.stdout!.on('data',chunk=>{text+=String(chunk);const match=text.match(/127\.0\.0\.1:(\d+) -> 8083/);if(match)resolve(Number(match[1]))});forward!.once('exit',()=>reject(new Error('Agent port-forward exited')));setTimeout(()=>reject(new Error('Agent port-forward timed out')),15000).unref()});
 const apiPort=await freePort();let frontPort=await freePort();while(frontPort===apiPort)frontPort=await freePort();const origin=`http://127.0.0.1:${frontPort}`,base=origin+'/grok-bot/',provider:IdentityProvider={authorizationUrl:()=>'',exchange:async()=>({})};apiServer=createAuthServer(new GoogleAuthService(identities,provider,base),base,undefined,bots,runs,approvals,undefined,'pi');apiServer.listen(apiPort,'127.0.0.1');await once(apiServer,'listening');
 vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(frontPort),'--strictPort'],{env:{...process.env,VITE_REQUIRE_AUTH:'true',VITE_BASE_PATH:'/grok-bot/',VITE_AUTH_PROXY_TARGET:`http://127.0.0.1:${apiPort}`},stdio:'ignore'});
 const publicUrl=`${base}`;for(let i=0;i<100;i++){try{if((await fetch(publicUrl)).ok)break}catch{}if(i===99)throw new Error('Vite did not start');await sleep(100)}
 const executor=new PiExecutor({connect:async()=>({agentUrl:new URL(`http://desktop.${namespace}.svc.cluster.local:8083/`),agentToken:desktop.agentToken})},gateway,`https://host.k3d.internal:${gatewayAddress.port}/v1`,'deepseek-v4.1-flash',async(url,init)=>fetch(`http://127.0.0.1:${agentPort}${new URL(String(url)).pathname}`,init));
 scheduler=new RunScheduler(runs,executor,{concurrency:1,leaseSeconds:30});
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});context=await browser.newContext();await context.addCookies([{name:'coke_grok_session',value:cookieToken,url:publicUrl,httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage();page.setDefaultTimeout(15_000);await page.goto(publicUrl);const composer=page.getByLabel('Message Pipeline Bot');await composer.waitFor({state:'visible'});let composerEnabled=false;for(let i=0;i<150;i++){if(await composer.isEnabled()){composerEnabled=true;break}await sleep(100)}assert.equal(composerEnabled,true);
 const prompt='Use the file writing tool to create proof.txt containing exactly PIPELINE_PI_OK in the task directory.';await composer.fill(prompt);const submission=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().includes(`/api/bots/${bot.id}/runs`));await page.getByRole('button',{name:'Send task'}).click();const submitResponse=await submission;assert.equal(submitResponse.status(),200);const {run:created}=await submitResponse.json() as {run:{id:string;status:string}};assert.equal(created.status,'queued');await scheduler.tick();
 await page.getByText('Completed',{exact:true}).waitFor({timeout:230_000});await page.reload();await page.getByText('Completed',{exact:true}).waitFor({timeout:30_000});
 const proof=await run('kubectl',['-n',namespace,'exec',pod,'-c','desktop','--','node','-e',`const f=require('fs');process.stdout.write(f.readFileSync('/workspace/tasks/${created.id}/proof.txt','utf8').trim()==='PIPELINE_PI_OK'?'verified':'mismatch')`]);assert.equal(proof,'verified');
 const cookie=`coke_grok_session=${cookieToken}`,eventsResponse=await fetch(`${publicUrl}api/runs/${created.id}/events`,{headers:{cookie}}),events=await eventsResponse.json() as {events:{status:string}[]};assert.deepEqual(events.events.map(x=>x.status),['queued','running','completed']);assert.ok(calls>0);
 await scheduler.stop();
 await new Promise<void>(resolve=>apiServer!.close(()=>resolve()));apiServer=createAuthServer(new GoogleAuthService(identities,provider,base),base,undefined,bots,runs,approvals,undefined,'dsh');apiServer.listen(apiPort,'127.0.0.1');await once(apiServer,'listening');await page.reload();await page.waitForFunction(()=>document.querySelector('.preview-notice')?.textContent?.includes('DeepSeek Harness'));
 let dshFailureCategory='not-reported';
 const dshRequest:typeof fetch=async(url,init)=>{
  const response=await fetch(`http://127.0.0.1:${agentPort}${new URL(String(url)).pathname}`,init);
  if(!response.ok){
   const body=await response.clone().json().catch(()=>null) as {error?:unknown}|null;
   const error=typeof body?.error==='string'?body.error:'';
   if(/ERR_MODULE_NOT_FOUND|Cannot find package/.test(error))dshFailureCategory='missing DSH dependency';
   else if(/ENOENT|spawn.*dsh/i.test(error))dshFailureCategory='DSH executable unavailable';
   else if(/profile|bundle|plugin/i.test(error))dshFailureCategory='DSH profile initialization failed';
   else if(/401|403|AUTH|authorization/i.test(error))dshFailureCategory='model authorization failed';
   else if(/DeepSeek Harness returned no assistant text/i.test(error))dshFailureCategory='DSH returned no assistant text';
   else if(/timeout|ETIMEDOUT/i.test(error))dshFailureCategory='DSH timed out';
   else if(/fetch failed|ECONN|network|socket/i.test(error))dshFailureCategory='model gateway connection failed';
   else {
    const safe=error.replaceAll(desktop.agentToken,'[redacted]').replace(/\b(?:sk-|[A-Za-z0-9_-]{32,})[A-Za-z0-9_-]*/g,'[redacted]').replace(/https?:\/\/\S+/g,'[url]').replace(/[\r\n\t]+/g,' ').slice(0,240);
    dshFailureCategory=`Agent HTTP ${response.status}: ${safe||'no safe diagnostic'}`;
   }
  }
  return response;
 };
 const dshExecutor=new DshExecutor({connect:async()=>({agentUrl:new URL(`http://desktop.${namespace}.svc.cluster.local:8083/`),agentToken:desktop.agentToken})},gateway,`https://host.k3d.internal:${gatewayAddress.port}/v1`,'deepseek-v4.1-flash',dshRequest);
 scheduler=new RunScheduler(runs,dshExecutor,{concurrency:1,leaseSeconds:30});
 const dshPrompt='Return exactly this JSON task result: {"status":"done","message":"DSH_REAL_MODEL_OK"}. Do not use tools.';
 await composer.fill(dshPrompt);const dshSubmission=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().includes(`/api/bots/${bot.id}/runs`));await page.getByRole('button',{name:'Send task'}).click();const dshSubmitResponse=await dshSubmission;assert.equal(dshSubmitResponse.status(),200);const {run:dshCreated}=await dshSubmitResponse.json() as {run:{id:string;status:string}};assert.equal(dshCreated.status,'queued');
 const dshCallsBefore=calls;await scheduler.tick();let dshResult;for(let i=0;i<230;i++){dshResult=(await runs.list(session,bot.id))?.find(item=>item.id===dshCreated.id);if(dshResult&&['completed','failed','unknown'].includes(dshResult.status))break;await sleep(1000)}assert.ok(dshResult,'DeepSeek Harness did not reach a terminal run state');assert.equal(dshResult.status,'completed',`DeepSeek Harness run ended ${dshResult.status}; ${dshFailureCategory}; provider calls ${calls-dshCallsBefore}`);assert.ok(dshResult.result?.includes('DSH_REAL_MODEL_OK'),'DeepSeek Harness result did not contain its requested marker');assert.ok(calls>dshCallsBefore,'DeepSeek Harness must call the configured real model');await page.getByText('DSH_REAL_MODEL_OK',{exact:true}).waitFor({timeout:30_000});await page.reload();await page.getByText('DSH_REAL_MODEL_OK',{exact:true}).waitFor({timeout:30_000});
 const dshEventsResponse=await fetch(`${publicUrl}api/runs/${dshCreated.id}/events`,{headers:{cookie}}),dshEvents=await dshEventsResponse.json() as {events:{status:string}[]};assert.deepEqual(dshEvents.events.map(x=>x.status),['queued','running','completed']);
 console.log(`Real Pi and DeepSeek Harness browser pipelines passed: authenticated test UI submissions, MySQL queue, K3D desktop, real model results and persisted terminal events; provider calls ${calls}.`);
}finally{
 await scheduler?.stop();await context?.close();await browser?.close();if(vite&&vite.exitCode===null&&vite.signalCode===null){vite.kill('SIGTERM');await Promise.race([once(vite,'close'),sleep(3000)]);if(vite.exitCode===null&&vite.signalCode===null)vite.kill('SIGKILL')}if(apiServer)await new Promise<void>(resolve=>apiServer!.close(()=>resolve()));forward?.kill('SIGTERM');gateway?.close();if(gatewayServer)await new Promise<void>(resolve=>gatewayServer!.close(()=>resolve()));
 if(namespaceCreated)await exec('kubectl',['delete','namespace',namespace,'--wait=true','--timeout=90s'],undefined,100_000);await pool?.end();if(dbCreated)await admin?.query(`DROP DATABASE \`${db}\``);await admin?.end();await rm(dir,{recursive:true,force:true});
}
