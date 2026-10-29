/** Isolated desktop/Agent network and shared-PVC test. No user data or credentials are used. */
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {desktopIdentity,splitDesktopResources} from '../src/server/desktop-resources.ts';
const image=process.env.COKE_GROK_DESKTOP_TEST_IMAGE;if(!image)throw new Error('Pinned desktop image required');
const identity=desktopIdentity({tenantId:randomUUID(),userId:randomUUID()},randomBytes(32));let created=false,forward:import('node:child_process').ChildProcess|undefined;
async function exec(args:string[],input?:string,timeout=120_000){const child=spawn('kubectl',args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.setEncoding('utf8');child.stdout.on('data',c=>{out+=c});child.stderr.resume();child.stdin.end(input);const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);try{const [code]=await once(child,'close') as [number|null];return {code:code??1,out}}finally{clearTimeout(timer)}}
async function run(args:string[],input?:string,timeout?:number){const r=await exec(args,input,timeout);if(r.code!==0)throw new Error(`Kubernetes test failed: ${args.slice(0,3).join(' ')}`);return r.out}
try{
 assert.equal((await run(['config','current-context'])).trim(),'k3d-tp1121-sandbox-dev');
 const resources=splitDesktopResources(identity,{image,controlNamespace:'coke-grok-bot',gatewayCA:'-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----'});
 await run(['create','-f','-'],JSON.stringify(resources[0]));created=true;await run(['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:resources.slice(1)}));
 await run(['-n',identity.namespace,'rollout','status','deployment/agent','--timeout=150s'],undefined,160_000);
 await run(['-n',identity.namespace,'rollout','status','deployment/desktop','--timeout=150s'],undefined,160_000);
 const find=async(label:string,field:string)=>(await run(['-n',identity.namespace,'get','pods','-l',`app=${label}`,'-o',`jsonpath={.items[0].${field}}`])).trim();
 const desktop=await find('grok-desktop','metadata.name'),agent=await find('grok-agent','metadata.name'),desktopIP=await find('grok-desktop','status.podIP'),agentIP=await find('grok-agent','status.podIP');assert.notEqual(desktopIP,agentIP);
 const agentCheck=await run(['-n',identity.namespace,'exec',agent,'-c','agent','--','sh','-c','id -u; test ! -r /workspace/.desktop-home/.config/chromium && printf profile-protected']);assert.equal(agentCheck.trim(),'1001\nprofile-protected');
 await run(['-n',identity.namespace,'exec',agent,'-c','agent','--','node','-e',"require('fs').writeFileSync('/workspace/shared-test.txt','SHARED_OK',{mode:0o664})"]);
 const shared=await run(['-n',identity.namespace,'exec',desktop,'-c','desktop','--','node','-e',"process.stdout.write(require('fs').readFileSync('/workspace/shared-test.txt','utf8'))"]);assert.equal(shared,'SHARED_OK');
 const direct=await run(['-n',identity.namespace,'exec',agent,'-c','agent','--','node','-e',`fetch('http://${desktopIP}:8082/healthz',{signal:AbortSignal.timeout(3000)}).then(r=>process.stdout.write(r.ok?'reachable':'blocked')).catch(()=>process.stdout.write('blocked'))`]);assert.equal(direct,'blocked');
 const cdp=await run(['-n',identity.namespace,'exec',agent,'-c','agent','--','node','-e',"fetch('http://127.0.0.1:9222/json/version',{signal:AbortSignal.timeout(3000)}).then(r=>process.stdout.write(r.ok?'reachable':'blocked')).catch(()=>process.stdout.write('blocked'))"]);assert.equal(cdp,'blocked');
 const controlPresent=await run(['-n',identity.namespace,'exec',agent,'-c','agent','--','node','-e',"process.stdout.write(process.env.COKE_GROK_CONTROL_TOKEN?'present':'absent')"]);assert.equal(controlPresent,'absent');
 forward=spawn('kubectl',['-n',identity.namespace,'port-forward','service/desktop',':8082'],{stdio:['ignore','pipe','pipe']});forward.stderr!.resume();
 const port=await new Promise<number>((resolve,reject)=>{let out='';forward!.stdout!.on('data',c=>{out+=String(c);const m=out.match(/127\.0\.0\.1:(\d+) -> 8082/);if(m)resolve(Number(m[1]))});forward!.once('exit',()=>reject(new Error('Port-forward exited')));setTimeout(()=>reject(new Error('Port-forward timeout')),15000).unref()});
 const change=(owner:string)=>fetch(`http://127.0.0.1:${port}/v1/control`,{method:'POST',headers:{authorization:`Bearer ${identity.controlToken}`,'content-type':'application/json'},body:JSON.stringify({owner}),signal:AbortSignal.timeout(5000)});
 assert.equal((await change('user')).status,200);assert.equal((await change('agent')).status,200);
 await run(['-n',identity.namespace,'rollout','restart','deployment/agent']);await run(['-n',identity.namespace,'rollout','status','deployment/agent','--timeout=150s'],undefined,160_000);
 const newAgent=await find('grok-agent','metadata.name'),persisted=await run(['-n',identity.namespace,'exec',newAgent,'-c','agent','--','node','-e',"process.stdout.write(require('fs').readFileSync('/workspace/shared-test.txt','utf8'))"]);assert.equal(persisted,'SHARED_OK');
 console.log('Separate-Pod K3D test passed: shared PVC, profile privacy, direct worker and loopback CDP denial, takeover and Agent restart.');
}finally{forward?.kill('SIGTERM');if(created)await exec(['delete','namespace',identity.namespace,'--wait=false'],undefined,20_000)}
