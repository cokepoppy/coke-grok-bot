/** Disposable K3D desktop integration. No credentials or runtime responses are logged. */
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { desktopIdentity, desktopResources } from '../src/server/desktop-resources.ts';
import { ModelGateway } from '../src/server/model-gateway.ts';

const keyFile = process.env.COKE_GROK_MODEL_KEY_FILE;
if (!keyFile) throw new Error('Private model key file is required');
const image = process.env.COKE_GROK_DESKTOP_TEST_IMAGE;
if (!image) throw new Error('Pinned desktop test image is required');
const temp = await mkdtemp(join(tmpdir(),'grok-desktop-test-'));
const desktop = desktopIdentity({tenantId:randomUUID(),userId:randomUUID()},randomBytes(32));
let created = false, server: import('node:http').Server | undefined, gateway: ModelGateway | undefined, forwarding: import('node:child_process').ChildProcess | undefined;
let calls = 0;
async function exec(command:string,args:string[],input?:string, timeout=120_000):Promise<{code:number;out:string}> {
 const child=spawn(command,args,{stdio:['pipe','pipe','pipe']}); let out='';
 child.stdout.setEncoding('utf8'); child.stdout.on('data',chunk=>{out=(out+chunk).slice(-100_000)}); child.stderr.resume(); child.stdin.end(input);
 const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
 try { const [code]=await once(child,'close') as [number|null]; return {code:code??1,out}; } finally {clearTimeout(timer)}
}
async function kubectl(args:string[],input?:string,timeout?:number) { const r=await exec('kubectl',args,input,timeout); if(r.code!==0) throw new Error(`Kubernetes command failed: ${args.slice(0,3).join(' ')}`); return r.out; }
try {
 assert.equal((await kubectl(['config','current-context'])).trim(),'k3d-tp1121-sandbox-dev');
 const cert=join(temp,'cert.pem'), privateKey=join(temp,'key.pem');
 assert.equal((await exec('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',privateKey,'-out',cert,'-days','1','-subj','/CN=host.k3d.internal','-addext','subjectAltName=DNS:host.k3d.internal'])).code,0);
 const providerKey=(await readFile(keyFile,'utf8')).trim();
 gateway=new ModelGateway(providerKey,'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1','deepseek-v4.1-flash',async (url,init)=>{calls++;return fetch(url,init)});
 server=gateway.createServer({key:await readFile(privateKey),cert:await readFile(cert)}); server.listen(0,'0.0.0.0'); await once(server,'listening');
 const address=server.address(); if(!address || typeof address==='string') throw new Error('No gateway port');
 const capability=gateway.issue({ttlMs:600_000,calls:24});
 const resources=desktopResources(desktop,{image,controlNamespace:'coke-grok-bot',gatewayCA:await readFile(cert,'utf8')});
 // Test-only Mac gateway; production should use its internal Service DNS name.
 const deployment=resources.find(resource=>resource.kind==='Deployment') as any;
 deployment.spec.template.spec.hostAliases=[{ip:'192.168.65.254',hostnames:['host.k3d.internal']}];
 const policy=resources.find(resource=>resource.kind==='NetworkPolicy') as any;
 policy.spec.egress.push({to:[{ipBlock:{cidr:'192.168.65.254/32'}}],ports:[{protocol:'TCP',port:address.port}]});
 await kubectl(['apply','-f','-'],JSON.stringify(resources[0])); created=true;
 await kubectl(['apply','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:resources.slice(1)}));
 await kubectl(['-n',desktop.namespace,'rollout','status','deployment/desktop','--timeout=150s'],undefined,160_000);
 const pod=(await kubectl(['-n',desktop.namespace,'get','pods','-l','app=grok-desktop','-o','jsonpath={.items[0].metadata.name}'])).trim();
 const isolation=await kubectl(['-n',desktop.namespace,'exec',pod,'-c','agent','--','sh','-c','id -u; test ! -r /workspace/.desktop-home/.config/chromium && printf profile-protected']);
 assert.equal(isolation.trim(),'1001\nprofile-protected');
 const network=await kubectl(['-n',desktop.namespace,'exec',pod,'-c','agent','--','node','-e',`require('https').get('https://host.k3d.internal:${address.port}/v1/chat/completions',r=>{process.stdout.write('HTTP '+r.statusCode);r.resume()}).on('error',e=>process.stdout.write(['ENOTFOUND','ECONNREFUSED','EAI_AGAIN','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT'].includes(e.code)?e.code:'OTHER'))`]);
 if(network!=='HTTP 404') throw new Error(`Isolated gateway connectivity failed: ${network}`);
 forwarding=spawn('kubectl',['-n',desktop.namespace,'port-forward','service/desktop',':8083',':8082'],{stdio:['ignore','pipe','pipe']});
 const port=await new Promise<number>((resolve,reject)=>{ let text=''; forwarding!.stdout!.on('data',chunk=>{text+=String(chunk);const match=text.match(/127\.0\.0\.1:(\d+) -> 8083/);if(match)resolve(Number(match[1]))}); forwarding!.once('exit',()=>reject(new Error('port-forward exited')));setTimeout(()=>reject(new Error('port-forward timeout')),15000).unref()});
 const taskId=randomUUID();
 const response=await fetch(`http://127.0.0.1:${port}/v1/tasks/run`,{method:'POST',headers:{authorization:`Bearer ${desktop.agentToken}`,'content-type':'application/json'},body:JSON.stringify({engine:'pi',taskId,cwd:`tasks/${taskId}`,prompt:'Use a file writing tool to create proof.txt containing exactly DESKTOP_PI_OK in this task directory. After the tool succeeds, return exactly this JSON object: {"status":"done","message":"Completed"}.',modelConfig:{apiKey:capability,baseUrl:`https://host.k3d.internal:${address.port}/v1`,model:'deepseek-v4.1-flash'}}),signal:AbortSignal.timeout(220_000)});
 if(!response.ok) {
  const body=await response.json().catch(()=>({})) as {error?:unknown};
  const error=typeof body.error==='string'?body.error:'';
  const reason=/EACCES|permission denied/i.test(error)?'filesystem permission':/EROFS/i.test(error)?'read-only filesystem':/ENOENT/i.test(error)?'missing file':/ENOTFOUND|EAI_AGAIN/i.test(error)?'DNS':/ECONNREFUSED|ECONNRESET|fetch failed/i.test(error)?'network':/certificate|TLS/i.test(error)?'TLS':/did not return a structured result/i.test(error)?'missing structured decision':/invalid task decision/i.test(error)?'invalid task decision':/session/i.test(error)?'session':/invalid.*model|model.*invalid/i.test(error)?'model configuration':/control state/i.test(error)?'desktop control':/exited with code/i.test(error)?'adapter process':/task working directory/i.test(error)?'task directory':'other';
  const diagnostic=await kubectl(['-n',desktop.namespace,'exec',pod,'-c','agent','--','node','-e',`const f=require('fs'),p='/workspace/tasks/${taskId}/.coke-dots-agent-runtime/pi-sessions';try{const names=f.readdirSync(p);const rows=names.flatMap(n=>f.readFileSync(p+'/'+n,'utf8').trim().split('\\n').map(x=>JSON.parse(x)));const messages=rows.map(x=>x.message).filter(Boolean);process.stdout.write(JSON.stringify(messages.map(m=>({role:['user','assistant','toolResult'].includes(m.role)?m.role:'other',stop:['stop','toolUse','error','aborted','length'].includes(m.stopReason)?m.stopReason:null,hasText:Array.isArray(m.content)&&m.content.some(c=>c.type==='text'&&!!c.text),hasTool:Array.isArray(m.content)&&m.content.some(c=>c.type==='toolCall'),isError:m.isError===true,hasJson:Array.isArray(m.content)&&m.content.some(c=>c.type==='text'&&/\{[\s\S]*\}/.test(c.text||'')),hasDone:Array.isArray(m.content)&&m.content.some(c=>c.type==='text'&&/\"status\"\s*:\s*\"done\"/.test(c.text||''))}))))}catch{process.stdout.write('unavailable')}`]);
  console.log(`Pi session structure: ${diagnostic}`);
  throw new Error(`Agent runtime request failed: HTTP ${response.status}; ${reason}; upstream calls ${calls}`);
 }
 const decision=await response.json() as {status?:string}; assert.equal(decision.status,'done'); assert.ok(calls>0);
 const check=await kubectl(['-n',desktop.namespace,'exec',pod,'-c','desktop','--','node','-e',`const fs=require('fs');process.stdout.write(fs.readFileSync('/workspace/tasks/${taskId}/proof.txt','utf8').trim()==='DESKTOP_PI_OK'?'verified':'mismatch')`]);
 assert.equal(check,'verified');
 const browserId=randomUUID();
 const fixture=`<!doctype html><title>Agent browser test</title><button onclick="document.getElementById('result').textContent='BROWSER_CLICK_VERIFIED'">Mark complete</button><p id="result">Waiting</p>`;
 await kubectl(['-n',desktop.namespace,'exec',pod,'-c','agent','--','node','-e',`const f=require('fs'),p='/workspace/tasks/${browserId}';f.mkdirSync(p,{recursive:true,mode:0o770});f.writeFileSync(p+'/browser-test.html',${JSON.stringify(fixture)},{mode:0o664})`]);
 const browserResponse=await fetch(`http://127.0.0.1:${port}/v1/tasks/run`,{method:'POST',headers:{authorization:`Bearer ${desktop.agentToken}`,'content-type':'application/json'},body:JSON.stringify({engine:'pi',taskId:browserId,cwd:`tasks/${browserId}`,prompt:'Use the computer_browser tool, not a shell, to open the task artifact browser-test.html with open_artifact. Inspect the page, then click the button named Mark complete. Inspect the page again and confirm it shows BROWSER_CLICK_VERIFIED. After it succeeds, return exactly {"status":"done","message":"Completed"}.',modelConfig:{apiKey:capability,baseUrl:`https://host.k3d.internal:${address.port}/v1`,model:'deepseek-v4.1-flash'}}),signal:AbortSignal.timeout(220_000)});
 if(!browserResponse.ok) throw new Error(`Browser Agent task failed: HTTP ${browserResponse.status}; provider calls ${calls}`);
 const browserDecision=await browserResponse.json() as {status?:string}; assert.equal(browserDecision.status,'done');
 const browserProof=await kubectl(['-n',desktop.namespace,'exec',pod,'-c','agent','--','node','-e',`const f=require('fs'),p='/workspace/tasks/${browserId}/.coke-dots-agent-runtime/pi-sessions';const rows=f.readdirSync(p).flatMap(n=>f.readFileSync(p+'/'+n,'utf8').trim().split('\\n').map(x=>JSON.parse(x)));const actions=rows.flatMap(x=>x.message?.content||[]).filter(x=>x.type==='toolCall'&&x.name==='computer_browser').map(x=>x.arguments?.action);process.stdout.write(JSON.stringify(['open_artifact','click','inspect'].map(a=>actions.includes(a))))`]);
 assert.deepEqual(JSON.parse(browserProof),[true,true,true]);
 const workerForward=spawn('kubectl',['-n',desktop.namespace,'port-forward','service/desktop',':8082'],{stdio:['ignore','pipe','pipe']});
 try {
  const workerPort=await new Promise<number>((resolve,reject)=>{let text='';workerForward.stdout!.on('data',chunk=>{text+=String(chunk);const m=text.match(/127\.0\.0\.1:(\d+) -> 8082/);if(m)resolve(Number(m[1]))});workerForward.once('exit',()=>reject(new Error('worker port-forward exited')));setTimeout(()=>reject(new Error('worker port-forward timeout')),15000).unref()});
  const inspect=await fetch(`http://127.0.0.1:${workerPort}/v1/browser`,{method:'POST',headers:{authorization:`Bearer ${desktop.workerToken}`,'content-type':'application/json'},body:JSON.stringify({action:'inspect',taskId:browserId})});
  const value=await inspect.json() as {ready?:boolean;text?:string}; assert.equal(value.ready,true); assert.ok(value.text?.includes('BROWSER_CLICK_VERIFIED'));
  const visualId=randomUUID();
  const visualFixture=`<!doctype html><title>Visual computer test</title><style>body{background:#fff;font:32px sans-serif;padding:80px}button{font:36px sans-serif;width:450px;height:160px;background:#155ab5;color:white}</style><button onclick="document.getElementById('result').textContent='VISUAL_CLICK_VERIFIED'">Click visual test</button><p id="result">Waiting</p>`;
  await kubectl(['-n',desktop.namespace,'exec',pod,'-c','agent','--','node','-e',`const f=require('fs'),p='/workspace/tasks/${visualId}';f.mkdirSync(p,{recursive:true,mode:0o770});f.writeFileSync(p+'/visual-test.html',${JSON.stringify(visualFixture)},{mode:0o664})`]);
  const visualResponse=await fetch(`http://127.0.0.1:${port}/v1/tasks/run`,{method:'POST',headers:{authorization:`Bearer ${desktop.agentToken}`,'content-type':'application/json'},body:JSON.stringify({engine:'pi',taskId:visualId,cwd:`tasks/${visualId}`,prompt:'Open visual-test.html using computer_browser open_artifact. Then use computer_desktop screenshot to visually locate the blue button and use computer_desktop click at its screen coordinates. Do not use a browser click or a shell for the click. Take another screenshot to check the result. Then return exactly {"status":"done","message":"Completed"}.',modelConfig:{apiKey:capability,baseUrl:`https://host.k3d.internal:${address.port}/v1`,model:'deepseek-v4.1-flash'}}),signal:AbortSignal.timeout(220_000)});
  if(!visualResponse.ok) throw new Error(`Visual desktop task failed: HTTP ${visualResponse.status}; provider calls ${calls}`);
  const visualDecision=await visualResponse.json() as {status?:string}; assert.equal(visualDecision.status,'done');
  const visualProof=await kubectl(['-n',desktop.namespace,'exec',pod,'-c','agent','--','node','-e',`const f=require('fs'),p='/workspace/tasks/${visualId}/.coke-dots-agent-runtime/pi-sessions';const rows=f.readdirSync(p).flatMap(n=>f.readFileSync(p+'/'+n,'utf8').trim().split('\\n').map(x=>JSON.parse(x)));const actions=rows.flatMap(x=>x.message?.content||[]).filter(x=>x.type==='toolCall'&&x.name==='computer_desktop').map(x=>x.arguments?.action);process.stdout.write(JSON.stringify(['screenshot','click'].map(a=>actions.includes(a))))`]);
  assert.deepEqual(JSON.parse(visualProof),[true,true]);
  const after=await fetch(`http://127.0.0.1:${workerPort}/v1/browser`,{method:'POST',headers:{authorization:`Bearer ${desktop.workerToken}`,'content-type':'application/json'},body:JSON.stringify({action:'inspect',taskId:visualId})});
  const visualState=await after.json() as {ready?:boolean;text?:string}; assert.equal(visualState.ready,true); assert.ok(visualState.text?.includes('VISUAL_CLICK_VERIFIED'));
  const control=async (owner:'user'|'agent')=>fetch(`http://127.0.0.1:${workerPort}/v1/control`,{method:'POST',headers:{authorization:`Bearer ${desktop.workerToken}`,'content-type':'application/json'},body:JSON.stringify({owner})});
  assert.equal((await control('user')).status,200);
  const forbidden=await fetch(`http://127.0.0.1:${workerPort}/v1/browser`,{method:'POST',headers:{authorization:`Bearer ${desktop.workerToken}`,'content-type':'application/json'},body:JSON.stringify({action:'click',by:'role',role:'button',target:'Click visual test',taskId:visualId})});
  assert.equal(forbidden.status,400);
  const beforeWaiting=calls;
  const waitId=randomUUID();
  const waiting=await fetch(`http://127.0.0.1:${port}/v1/tasks/run`,{method:'POST',headers:{authorization:`Bearer ${desktop.agentToken}`,'content-type':'application/json'},body:JSON.stringify({engine:'pi',taskId:waitId,cwd:`tasks/${waitId}`,prompt:'Wait',modelConfig:{apiKey:capability,baseUrl:`https://host.k3d.internal:${address.port}/v1`,model:'deepseek-v4.1-flash'}})});
  const waitResult=await waiting.json() as {status?:string;pausedForControl?:boolean}; assert.equal(waiting.status,200); assert.equal(waitResult.status,'waiting'); assert.equal(waitResult.pausedForControl,true); assert.equal(calls,beforeWaiting);
  assert.equal((await control('agent')).status,200);
 } finally {workerForward.kill('SIGTERM')}
 await kubectl(['-n',desktop.namespace,'rollout','restart','deployment/desktop']);
 await kubectl(['-n',desktop.namespace,'rollout','status','deployment/desktop','--timeout=150s'],undefined,160_000);
 const pod2=(await kubectl(['-n',desktop.namespace,'get','pods','-l','app=grok-desktop','-o','jsonpath={.items[0].metadata.name}'])).trim();
 const persisted=await kubectl(['-n',desktop.namespace,'exec',pod2,'-c','desktop','--','node','-e',`const fs=require('fs');process.stdout.write(fs.readFileSync('/workspace/tasks/${taskId}/proof.txt','utf8').trim()==='DESKTOP_PI_OK'?'verified':'mismatch')`]);
 assert.equal(persisted,'verified');
 console.log(`Desktop K3D test passed: split UID, protected browser profile, real Pi file, browser and screenshot-driven desktop click tasks, and PVC persistence after restart; provider requests ${calls}.`);
} finally {
 forwarding?.kill('SIGTERM'); gateway?.close(); if(server) await new Promise<void>(resolve=>server!.close(()=>resolve()));
 if(created) await exec('kubectl',['delete','namespace',desktop.namespace,'--wait=false'],undefined,20_000);
 await rm(temp,{recursive:true,force:true});
}
