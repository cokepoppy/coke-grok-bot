/** Real Pi/model/file pipeline in a disposable K3D namespace and MySQL database. */
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
import {RunScheduler} from '../src/server/run-scheduler.ts';
import {PiExecutor} from '../src/server/pi-executor.ts';
import {ModelGateway} from '../src/server/model-gateway.ts';
import {desktopIdentity,desktopResources} from '../src/server/desktop-resources.ts';
import {GoogleAuthService,type IdentityProvider} from '../src/server/google-auth.ts';
import {createAuthServer} from '../src/server/auth-http.ts';
const mysqlPort=Number(process.env.COKE_GROK_TEST_MYSQL_PORT),keyFile=process.env.COKE_GROK_MODEL_KEY_FILE,image=process.env.COKE_GROK_DESKTOP_TEST_IMAGE;
if(!mysqlPort||!keyFile||!image)throw new Error('Test MySQL, private model key file and pinned desktop image are required');
const dir=await mkdtemp(join(tmpdir(),'grok-pi-pipeline-')),db=`grok_pipeline_${randomUUID().replaceAll('-','')}`;
let namespace='',namespaceCreated=false,gateway:ModelGateway|undefined,gatewayServer:import('node:http').Server|undefined,apiServer:import('node:http').Server|undefined,forward:import('node:child_process').ChildProcess|undefined,scheduler:RunScheduler|undefined,pool:mysql.Pool|undefined,admin:mysql.Connection|undefined,dbCreated=false;
let calls=0;
async function exec(command:string,args:string[],input?:string,timeout=120_000){const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{out=(out+chunk).slice(-100_000)});child.stderr.resume();child.stdin.end(input);const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);try{const [code]=await once(child,'close') as [number|null];return {code:code??1,out}}finally{clearTimeout(timer)}}
async function run(command:string,args:string[],input?:string,timeout?:number){const r=await exec(command,args,input,timeout);if(r.code!==0)throw new Error(`${command} test operation failed`);return r.out}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 assert.equal((await run('kubectl',['config','current-context'])).trim(),'k3d-tp1121-sandbox-dev');
 admin=await mysql.createConnection({host:'127.0.0.1',port:mysqlPort,user:'root'});await admin.query(`CREATE DATABASE \`${db}\``);dbCreated=true;
 pool=mysql.createPool({host:'127.0.0.1',port:mysqlPort,user:'root',database:db,timezone:'Z',connectionLimit:8});const identities=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool);await identities.migrate();await bots.migrate();await runs.migrate();
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
 const reserve=netServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const apiPort=(reserve.address() as import('node:net').AddressInfo).port;await new Promise<void>(resolve=>reserve.close(()=>resolve()));
 const origin=`http://127.0.0.1:${apiPort}`,base=origin+'/grok-bot',provider:IdentityProvider={authorizationUrl:()=>'',exchange:async()=>({})};apiServer=createAuthServer(new GoogleAuthService(identities,provider,base),base,undefined,bots,runs);apiServer.listen(apiPort,'127.0.0.1');await once(apiServer,'listening');
 const executor=new PiExecutor({connect:async()=>({agentUrl:new URL(`http://desktop.${namespace}.svc.cluster.local:8083/`),agentToken:desktop.agentToken})},gateway,`https://host.k3d.internal:${gatewayAddress.port}/v1`,'deepseek-v4.1-flash',async(url,init)=>fetch(`http://127.0.0.1:${agentPort}${new URL(String(url)).pathname}`,init));
 scheduler=new RunScheduler(runs,executor,{concurrency:1,leaseSeconds:30});
 const cookie=`coke_grok_session=${cookieToken}`,path=`${base}/api/bots/${bot.id}/runs`,requestId=randomUUID();
 const response=await fetch(path,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({requestId,prompt:'Use the file writing tool to create proof.txt containing exactly PIPELINE_PI_OK in the task directory.'})});assert.equal(response.status,200);
 const {run:created}=await response.json() as {run:{id:string;status:string}};assert.equal(created.status,'queued');await scheduler.tick();
 let state='';for(let i=0;i<220;i++){const get=await fetch(path,{headers:{cookie}});const value=await get.json() as {runs:{id:string;status:string}[]};state=value.runs.find(x=>x.id===created.id)?.status||'';if(['completed','failed','unknown'].includes(state))break;await sleep(1000)}
 if(state!=='completed')throw new Error(`Real Pi run did not complete: ${state}; model calls ${calls}`);
 const proof=await run('kubectl',['-n',namespace,'exec',pod,'-c','desktop','--','node','-e',`const f=require('fs');process.stdout.write(f.readFileSync('/workspace/tasks/${created.id}/proof.txt','utf8').trim()==='PIPELINE_PI_OK'?'verified':'mismatch')`]);assert.equal(proof,'verified');
 const eventsResponse=await fetch(`${base}/api/runs/${created.id}/events`,{headers:{cookie}}),events=await eventsResponse.json() as {events:{status:string}[]};assert.deepEqual(events.events.map(x=>x.status),['queued','running','completed']);assert.ok(calls>0);
 console.log(`Real Pi pipeline passed: authenticated test session, HTTP submission, MySQL queue, K3D desktop, actual model and file, persisted terminal events; provider calls ${calls}.`);
}finally{
 await scheduler?.stop();if(apiServer)await new Promise<void>(resolve=>apiServer!.close(()=>resolve()));forward?.kill('SIGTERM');gateway?.close();if(gatewayServer)await new Promise<void>(resolve=>gatewayServer!.close(()=>resolve()));
 if(namespaceCreated)await exec('kubectl',['delete','namespace',namespace,'--wait=false'],undefined,20_000);await pool?.end();if(dbCreated)await admin?.query(`DROP DATABASE \`${db}\``);await admin?.end();await rm(dir,{recursive:true,force:true});
}
