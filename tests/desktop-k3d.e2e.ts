/** Disposable K3D desktop integration. No credentials or runtime responses are logged. */
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { desktopIdentity, desktopResources } from '../src/server/desktop-resources.ts';
import { ModelGateway } from '../src/server/model-gateway.ts';

const keyFile = process.env.COKE_GROK_MODEL_KEY_FILE;
if (!keyFile) throw new Error('Private model key file is required');
const image = process.env.COKE_GROK_DESKTOP_TEST_IMAGE;
if (!image) throw new Error('Pinned desktop test image is required');
const temp = await mkdtemp(join(tmpdir(),'grok-desktop-test-'));
const desktop = desktopIdentity({tenantId:randomUUID(),userId:randomUUID()},randomBytes(32));
const screenId=randomUUID();
let created = false, server: import('node:http').Server | undefined, gateway: ModelGateway | undefined, forwarding: import('node:child_process').ChildProcess | undefined;
let calls = 0;
async function exec(command:string,args:string[],input?:string, timeout=120_000):Promise<{code:number;out:string}> {
 const child=spawn(command,args,{stdio:['pipe','pipe','pipe']}); let out='';
 child.stdout.setEncoding('utf8'); child.stdout.on('data',chunk=>{out=(out+chunk).slice(-100_000)}); child.stderr.resume(); child.stdin.end(input);
 const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
 try { const [code]=await once(child,'close') as [number|null]; return {code:code??1,out}; } finally {clearTimeout(timer)}
}
async function kubectl(args:string[],input?:string,timeout?:number) { const r=await exec('kubectl',args,input,timeout); if(r.code!==0) throw new Error(`Kubernetes command failed: ${args.slice(0,3).join(' ')}`); return r.out; }
function locateSolidColor(bytes:Buffer,color:[number,number,number]) {
 const {width,height,data}=PNG.sync.read(bytes);let count=0,sumX=0,sumY=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const index=(y*width+x)*4;if(data[index]===color[0]&&data[index+1]===color[1]&&data[index+2]===color[2]){count++;sumX+=x;sumY+=y}}
 assert.ok(count>100,`expected a visible ${color.join(',')} target in the desktop screenshot`);
 return {x:Math.round(sumX/count),y:Math.round(sumY/count),width,height};
}
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
 const response=await fetch(`http://127.0.0.1:${port}/v1/tasks/run`,{method:'POST',headers:{authorization:`Bearer ${desktop.agentToken}`,'content-type':'application/json'},body:JSON.stringify({engine:'pi',taskId,botId:screenId,screenId,cwd:`tasks/${taskId}`,prompt:'Use a file writing tool to create proof.txt containing exactly DESKTOP_PI_OK in this task directory. After the tool succeeds, return exactly this JSON object: {"status":"done","message":"Completed"}.',modelConfig:{apiKey:capability,baseUrl:`https://host.k3d.internal:${address.port}/v1`,model:'deepseek-v4.1-flash'}}),signal:AbortSignal.timeout(220_000)});
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
 const browserResponse=await fetch(`http://127.0.0.1:${port}/v1/tasks/run`,{method:'POST',headers:{authorization:`Bearer ${desktop.agentToken}`,'content-type':'application/json'},body:JSON.stringify({engine:'pi',taskId:browserId,botId:screenId,screenId,cwd:`tasks/${browserId}`,prompt:'Use the computer_browser tool, not a shell, to open the task artifact browser-test.html with open_artifact. Inspect the page, then click the button named Mark complete. Inspect the page again and confirm it shows BROWSER_CLICK_VERIFIED. After it succeeds, return exactly {"status":"done","message":"Completed"}.',modelConfig:{apiKey:capability,baseUrl:`https://host.k3d.internal:${address.port}/v1`,model:'deepseek-v4.1-flash'}}),signal:AbortSignal.timeout(220_000)});
 if(!browserResponse.ok) throw new Error(`Browser Agent task failed: HTTP ${browserResponse.status}; provider calls ${calls}`);
 const browserDecision=await browserResponse.json() as {status?:string}; assert.equal(browserDecision.status,'done');
 const browserProof=await kubectl(['-n',desktop.namespace,'exec',pod,'-c','agent','--','node','-e',`const f=require('fs'),p='/workspace/tasks/${browserId}/.coke-dots-agent-runtime/pi-sessions';const rows=f.readdirSync(p).flatMap(n=>f.readFileSync(p+'/'+n,'utf8').trim().split('\\n').map(x=>JSON.parse(x)));const actions=rows.flatMap(x=>x.message?.content||[]).filter(x=>x.type==='toolCall'&&x.name==='computer_browser').map(x=>x.arguments?.action);process.stdout.write(JSON.stringify(['open_artifact','click','inspect'].map(a=>actions.includes(a))))`]);
 assert.deepEqual(JSON.parse(browserProof),[true,true,true]);
 const workerForward=spawn('kubectl',['-n',desktop.namespace,'port-forward','service/desktop',':8082'],{stdio:['ignore','pipe','pipe']});
 try {
  const workerPort=await new Promise<number>((resolve,reject)=>{let text='';workerForward.stdout!.on('data',chunk=>{text+=String(chunk);const m=text.match(/127\.0\.0\.1:(\d+) -> 8082/);if(m)resolve(Number(m[1]))});workerForward.once('exit',()=>reject(new Error('worker port-forward exited')));setTimeout(()=>reject(new Error('worker port-forward timeout')),15000).unref()});
  const inspect=await fetch(`http://127.0.0.1:${workerPort}/v1/browser`,{method:'POST',headers:{authorization:`Bearer ${desktop.workerToken}`,'content-type':'application/json','x-coke-grok-screen-id':screenId},body:JSON.stringify({action:'inspect',taskId:browserId})});
  const value=await inspect.json() as {ready?:boolean;text?:string}; assert.equal(value.ready,true); assert.ok(value.text?.includes('BROWSER_CLICK_VERIFIED'));
  const visualId=randomUUID();
  const visualFixture=`<!doctype html><title>Visual computer test</title><style>body{background:#fff;font:32px sans-serif;padding:80px}button{font:36px sans-serif;width:450px;height:160px;background:#155ab5;color:white}</style><button onclick="document.getElementById('result').textContent='VISUAL_CLICK_VERIFIED'">Click visual test</button><p id="result">Waiting</p>`;
  await kubectl(['-n',desktop.namespace,'exec',pod,'-c','agent','--','node','-e',`const f=require('fs'),p='/workspace/tasks/${visualId}';f.mkdirSync(p,{recursive:true,mode:0o770});f.writeFileSync(p+'/visual-test.html',${JSON.stringify(visualFixture)},{mode:0o664})`]);
  const visualResponse=await fetch(`http://127.0.0.1:${port}/v1/tasks/run`,{method:'POST',headers:{authorization:`Bearer ${desktop.agentToken}`,'content-type':'application/json'},body:JSON.stringify({engine:'pi',taskId:visualId,botId:screenId,screenId,cwd:`tasks/${visualId}`,prompt:'Open visual-test.html using computer_browser open_artifact. Then use computer_desktop screenshot to visually locate the blue button and use computer_desktop click at its screen coordinates. Do not use a browser click or a shell for the click. Take another screenshot to check the result. Then return exactly {"status":"done","message":"Completed"}.',modelConfig:{apiKey:capability,baseUrl:`https://host.k3d.internal:${address.port}/v1`,model:'deepseek-v4.1-flash'}}),signal:AbortSignal.timeout(220_000)});
  if(!visualResponse.ok) throw new Error(`Visual desktop task failed: HTTP ${visualResponse.status}; provider calls ${calls}`);
  const visualDecision=await visualResponse.json() as {status?:string}; assert.equal(visualDecision.status,'done');
  const visualProof=await kubectl(['-n',desktop.namespace,'exec',pod,'-c','agent','--','node','-e',`const f=require('fs'),p='/workspace/tasks/${visualId}/.coke-dots-agent-runtime/pi-sessions';const rows=f.readdirSync(p).flatMap(n=>f.readFileSync(p+'/'+n,'utf8').trim().split('\\n').map(x=>JSON.parse(x)));const actions=rows.flatMap(x=>x.message?.content||[]).filter(x=>x.type==='toolCall'&&x.name==='computer_desktop').map(x=>x.arguments?.action);process.stdout.write(JSON.stringify(['screenshot','click'].map(a=>actions.includes(a))))`]);
  assert.deepEqual(JSON.parse(visualProof),[true,true]);
  const after=await fetch(`http://127.0.0.1:${workerPort}/v1/browser`,{method:'POST',headers:{authorization:`Bearer ${desktop.workerToken}`,'content-type':'application/json','x-coke-grok-screen-id':screenId},body:JSON.stringify({action:'inspect',taskId:visualId})});
  const visualState=await after.json() as {ready?:boolean;text?:string}; assert.equal(visualState.ready,true); assert.ok(visualState.text?.includes('VISUAL_CLICK_VERIFIED'));
  // A user's Bots share one persistent browser profile, while their visible
  // pages, screenshots, coordinates, and takeover state remain screen-scoped.
  const secondScreen=randomUUID(),fixtureScriptPath=`/tmp/grok-bot-screen-fixture-${browserId}.cjs`;
  const fixtureScript=`const http=require('node:http');http.createServer((req,res)=>{if(req.url==='/healthz'){res.writeHead(204);return res.end()}const label=req.url==='/bot-a'||req.url==='/bot-a-verify'?'BOT_A_SCREEN':'BOT_B_SCREEN';const controls='<form onsubmit="event.preventDefault();document.getElementById(&quot;result&quot;).textContent=&quot;SCREEN_INPUT_OK&quot;"><input aria-label="Desktop input" style="position:fixed;left:120px;top:180px;width:360px;height:54px;background:rgb(255,230,20);font:24px sans-serif"><button type="submit" style="position:fixed;left:520px;top:180px;width:200px;height:54px;background:rgb(21,90,181);color:white">Submit</button></form><p id="result">WAITING_FOR_INPUT</p>';const html='<!doctype html><title>'+label+'</title><h1>'+label+'</h1><p id="state"></p>'+controls+'<script>const key="grok-bot-shared-screen-test",cookie="grok-bot-shared-screen-test=ok",had=localStorage.getItem(key)==="ok"&&document.cookie.split("; ").includes(cookie);if(localStorage.getItem(key)!=="ok")localStorage.setItem(key,"ok");if(!document.cookie.split("; ").includes(cookie))document.cookie=cookie+"; path=/";document.getElementById("state").textContent=had?"SHARED_STATE_OK":"INITIALIZED_SHARED_STATE"</script>';res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)}).listen(18111,'0.0.0.0')`;
  await kubectl(['-n',desktop.namespace,'exec',pod,'-c','agent','--','node','-e',`require('node:fs').writeFileSync(${JSON.stringify(fixtureScriptPath)},${JSON.stringify(fixtureScript)})`]);
  await kubectl(['-n',desktop.namespace,'exec',pod,'-c','agent','--','sh','-c',`nohup node ${fixtureScriptPath} >/tmp/grok-bot-screen-fixture-${browserId}.log 2>&1 </dev/null &`]);
  let fixtureReady=false;
  for(let attempt=0;attempt<30;attempt++){
   const probe=await kubectl(['-n',desktop.namespace,'exec',pod,'-c','agent','--','node','-e',"fetch('http://127.0.0.1:18111/healthz',{signal:AbortSignal.timeout(500)}).then(r=>process.stdout.write(String(r.status))).catch(()=>process.exitCode=1)"]).catch(()=> '');
   if(probe==='204'){fixtureReady=true;break} await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(fixtureReady,true,'shared screen fixture should be reachable by Chromium inside the cloud computer');
  const screenRequest=(path:string,scope:string,body?:unknown)=>fetch(`http://127.0.0.1:${workerPort}${path}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${desktop.workerToken}`,'x-coke-grok-screen-id':scope,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const navigateScreen=async(scope:string,path:string)=>{const result=await screenRequest('/v1/browser',scope,{action:'navigate',url:`http://127.0.0.1:18111/${path}`});assert.equal(result.status,200)};
  await navigateScreen(screenId,'bot-a');
  await navigateScreen(secondScreen,'bot-b');
  const inspectScreen=async(scope:string)=>{const result=await screenRequest('/v1/browser',scope,{action:'inspect'});assert.equal(result.status,200);return result.json() as Promise<{url:string;title:string;text:string}>};
  const [screenA,screenB]=await Promise.all([inspectScreen(screenId),inspectScreen(secondScreen)]);
  assert.ok(screenA.url.endsWith('/bot-a'));assert.equal(screenA.title,'BOT_A_SCREEN');
  assert.ok(screenB.url.endsWith('/bot-b'));assert.equal(screenB.title,'BOT_B_SCREEN');assert.ok(screenB.text.includes('SHARED_STATE_OK'),'Bot B should inherit the owner-shared cookie and localStorage');
  const imageA=await screenRequest('/v1/screenshot',screenId),imageB=await screenRequest('/v1/screenshot',secondScreen);
  assert.equal(imageA.headers.get('content-type'),'image/png');assert.equal(imageB.headers.get('content-type'),'image/png');
  const imageABytes=Buffer.from(await imageA.arrayBuffer()),imageBBytes=Buffer.from(await imageB.arrayBuffer());
  assert.deepEqual([locateSolidColor(imageABytes,[255,230,20]).width,locateSolidColor(imageABytes,[255,230,20]).height],[1440,900],'Computer User should see a real 1440x900 X11 crop');
  assert.deepEqual([locateSolidColor(imageBBytes,[255,230,20]).width,locateSolidColor(imageBBytes,[255,230,20]).height],[1440,900],'each Bot screenshot should be cropped to its own desktop region');
  assert.equal(imageABytes.length>0,true);assert.equal(imageBBytes.length>0,true);assert.notDeepEqual(imageABytes,imageBBytes,'Bot pages should produce their own rendered screenshots');
  const userAction=async(scope:string,screen:Buffer)=>{
   assert.equal((await screenRequest('/v1/control',scope,{owner:'user'})).status,200);
   const point=locateSolidColor(screen,[255,230,20]);
   const action=async(body:unknown)=>{const response=await screenRequest('/v1/commands',scope,{...(body as object),actor:'user'});assert.equal(response.status,200)};
   await action({action:'click',x:point.x,y:point.y});await action({action:'type',text:'COMPUTER_USER_OK'});await action({action:'press',key:'Enter'});
   assert.equal((await screenRequest('/v1/control',scope,{owner:'agent'})).status,200);
   const state=await inspectScreen(scope);assert.ok(state.text.includes('SCREEN_INPUT_OK'),'real desktop click, type and key input should reach the Bot screen');
  };
  await Promise.all([userAction(screenId,imageABytes),userAction(secondScreen,imageBBytes)]);
  await navigateScreen(screenId,'bot-a-verify');
  assert.ok((await inspectScreen(screenId)).text.includes('SHARED_STATE_OK'));
  assert.equal((await screenRequest('/v1/control',screenId,{owner:'user'})).status,200);
  assert.equal((await screenRequest('/v1/browser',screenId,{action:'inspect'})).status,400,'taking over Bot A should stop its Agent browser actions');
  assert.equal((await inspectScreen(secondScreen)).title,'BOT_B_SCREEN','taking over Bot A must leave Bot B available');
  const control=async (owner:'user'|'agent')=>fetch(`http://127.0.0.1:${workerPort}/v1/control`,{method:'POST',headers:{authorization:`Bearer ${desktop.workerToken}`,'content-type':'application/json','x-coke-grok-screen-id':screenId},body:JSON.stringify({owner})});
  assert.equal((await control('user')).status,200);
  const forbidden=await fetch(`http://127.0.0.1:${workerPort}/v1/browser`,{method:'POST',headers:{authorization:`Bearer ${desktop.workerToken}`,'content-type':'application/json','x-coke-grok-screen-id':screenId},body:JSON.stringify({action:'click',by:'role',role:'button',target:'Click visual test',taskId:visualId})});
  assert.equal(forbidden.status,400);
  const beforeWaiting=calls;
  const waitId=randomUUID();
  const waiting=await fetch(`http://127.0.0.1:${port}/v1/tasks/run`,{method:'POST',headers:{authorization:`Bearer ${desktop.agentToken}`,'content-type':'application/json'},body:JSON.stringify({engine:'pi',taskId:waitId,botId:screenId,screenId,cwd:`tasks/${waitId}`,prompt:'Wait',modelConfig:{apiKey:capability,baseUrl:`https://host.k3d.internal:${address.port}/v1`,model:'deepseek-v4.1-flash'}})});
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
 if(created) await exec('kubectl',['delete','namespace',desktop.namespace,'--wait=true','--timeout=90s'],undefined,100_000);
 await rm(temp,{recursive:true,force:true});
}
