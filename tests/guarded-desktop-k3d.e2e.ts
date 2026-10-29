import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {desktopIdentity,desktopResources} from '../src/server/desktop-resources.ts';
const image=process.env.COKE_GROK_DESKTOP_TEST_IMAGE;if(!image)throw new Error('Pinned desktop image required');
const identity=desktopIdentity({tenantId:randomUUID(),userId:randomUUID()},randomBytes(32));let created=false,forward:import('node:child_process').ChildProcess|undefined;
async function exec(args:string[],input?:string,timeout=120_000){const child=spawn('kubectl',args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{out+=chunk});child.stderr.resume();child.stdin.end(input);const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);try{const [code]=await once(child,'close') as [number|null];return {code:code??1,out}}finally{clearTimeout(timer)}}
async function run(args:string[],input?:string,timeout?:number){const r=await exec(args,input,timeout);if(r.code!==0)throw new Error(`Kubernetes test failed: ${args.slice(0,3).join(' ')}`);return r.out}
try{
 assert.equal((await run(['config','current-context'])).trim(),'k3d-tp1121-sandbox-dev');
 const resources=desktopResources(identity,{image,controlNamespace:'coke-grok-bot',gatewayCA:'-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----',guarded:true});
 await run(['create','-f','-'],JSON.stringify(resources[0]));created=true;await run(['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:resources.slice(1)}));
 await run(['-n',identity.namespace,'rollout','status','deployment/desktop','--timeout=150s'],undefined,160_000);
 const pod=(await run(['-n',identity.namespace,'get','pods','-l','app=grok-desktop','-o','jsonpath={.items[0].metadata.name}'])).trim(),taskId=randomUUID();
 const fixture=`<!doctype html><title>Guarded test</title><button onclick="document.getElementById('result').textContent='GUARDED_ACTION_OK'">Click test</button><p id="result">Waiting</p>`;
 await run(['-n',identity.namespace,'exec',pod,'-c','agent','--','node','-e',`const f=require('fs'),p='/workspace/tasks/${taskId}';f.mkdirSync(p,{recursive:true,mode:0o770});f.writeFileSync(p+'/guard.html',${JSON.stringify(fixture)},{mode:0o664})`]);
 forward=spawn('kubectl',['-n',identity.namespace,'port-forward','service/desktop',':8082'],{stdio:['ignore','pipe','pipe']});forward.stderr!.resume();
 const port=await new Promise<number>((resolve,reject)=>{let out='';forward!.stdout!.on('data',chunk=>{out+=String(chunk);const m=out.match(/127\.0\.0\.1:(\d+) -> 8082/);if(m)resolve(Number(m[1]))});forward!.once('exit',()=>reject(new Error('Port-forward exited')));setTimeout(()=>reject(new Error('Port-forward timed out')),15000).unref()});
 const request=(path:string,token:string,body?:unknown)=>fetch(`http://127.0.0.1:${port}${path}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 assert.equal((await request('/v1/guarded/snapshot',identity.workerToken)).status,403);
 assert.equal((await request('/v1/browser',identity.workerToken,{action:'inspect'})).status,403);
 assert.equal((await request('/v1/commands',identity.controlToken,{action:'click',actor:'agent',x:1,y:1})).status,403);
 const snap=async()=>{const response=await request('/v1/guarded/snapshot',identity.controlToken);assert.equal(response.status,200);return response.json() as Promise<{owner:string;url:string;screenshotSha256:string}>};
 const before=await snap();assert.equal(before.owner,'agent');
 assert.equal((await request('/v1/control',identity.controlToken,{owner:'user'})).status,200);
 assert.equal((await request('/v1/guarded/execute',identity.controlToken,{expected:before,action:{kind:'desktop',action:'click',x:1,y:1}})).status,400);
 assert.equal((await request('/v1/control',identity.controlToken,{owner:'agent'})).status,200);
 const current=await snap();
 assert.equal((await request('/v1/guarded/execute',identity.controlToken,{expected:{...current,screenshotSha256:'0'.repeat(64)},action:{kind:'desktop',action:'click',x:1,y:1}})).status,400);
 const open=await request('/v1/guarded/execute',identity.controlToken,{expected:await snap(),action:{kind:'browser',action:'open_artifact',taskId,path:'guard.html'}});assert.equal(open.status,200);
 await new Promise(resolve=>setTimeout(resolve,1500));
 const buttonState=await snap(), verification=await snap();
 console.log(`Consecutive unchanged-page snapshot hashes match: ${buttonState.screenshotSha256===verification.screenshotSha256}`);
 assert.equal(buttonState.screenshotSha256,verification.screenshotSha256);
 const click=await request('/v1/guarded/execute',identity.controlToken,{expected:buttonState,action:{kind:'browser',action:'click',taskId,by:'role',role:'button',target:'Click test'}});
 if(click.status!==200){const value=await click.json() as {error?:string};const reason=/state or ownership changed/i.test(value.error||'')?'screen changed':/matched .* controls/i.test(value.error||'')?'locator mismatch':'other';throw new Error(`Guarded click failed: HTTP ${click.status}; ${reason}`)}
 const view=await request('/v1/guarded/inspect',identity.controlToken);const observed=await view.json() as {text?:string};assert.ok(observed.text?.includes('GUARDED_ACTION_OK'));
 const bypass=await run(['-n',identity.namespace,'exec',pod,'-c','agent','--','node','-e',"fetch('http://127.0.0.1:9222/json/version',{signal:AbortSignal.timeout(3000)}).then(r=>process.stdout.write(r.ok?'reachable':'blocked')).catch(()=>process.stdout.write('blocked'))"]);
 console.log(`Guarded worker test passed: separate control token, stale snapshot and takeover denial, real Chromium click. Agent CDP bypass probe: ${bypass.trim()}.`);
}finally{forward?.kill('SIGTERM');if(created)await exec(['delete','namespace',identity.namespace,'--wait=false'],undefined,20_000)}
