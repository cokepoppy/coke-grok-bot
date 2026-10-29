import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const ns=`grok-net-test-${randomBytes(6).toString('hex')}`,image='coke-grok-auth:sha-5b66393';let created=false;
async function exec(args:string[],input?:string,timeout=120000){const child=spawn('kubectl',args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{out+=chunk});child.stderr.resume();child.stdin.end(input);const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);try{const [code]=await once(child,'close') as [number|null];return {code:code??1,out}}finally{clearTimeout(timer)}}
async function run(args:string[],input?:string,timeout?:number){const r=await exec(args,input,timeout);if(r.code!==0)throw new Error(`Kubernetes test step failed: ${args.slice(0,3).join(' ')}`);return r.out}
try{
 assert.equal((await run(['config','current-context'])).trim(),'k3d-tp1121-sandbox-dev');await run(['create','namespace',ns]);created=true;
 const pod=(name:string,role:string,command:string)=>({apiVersion:'v1',kind:'Pod',metadata:{name,namespace:ns,labels:{role}},spec:{automountServiceAccountToken:false,restartPolicy:'Never',containers:[{name:'node',image,imagePullPolicy:'Never',command:['node','-e',command],securityContext:{runAsNonRoot:true,runAsUser:1000,allowPrivilegeEscalation:false,capabilities:{drop:['ALL']}},resources:{requests:{cpu:'5m',memory:'32Mi'},limits:{cpu:'250m',memory:'128Mi'}}}]}});
 const objects=[pod('target','target',"require('http').createServer((q,r)=>r.end('ok')).listen(8080,'0.0.0.0')"),pod('allowed','allowed',"setInterval(()=>{},10000)"),pod('denied','denied',"setInterval(()=>{},10000)"),
 {apiVersion:'v1',kind:'Service',metadata:{name:'target',namespace:ns},spec:{selector:{role:'target'},ports:[{port:8080,targetPort:8080}]}},
 {apiVersion:'networking.k8s.io/v1',kind:'NetworkPolicy',metadata:{name:'allow-only-control',namespace:ns},spec:{podSelector:{matchLabels:{role:'target'}},policyTypes:['Ingress'],ingress:[{from:[{podSelector:{matchLabels:{role:'allowed'}}}],ports:[{protocol:'TCP',port:8080}]}]}}];
 await run(['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:objects}));await run(['-n',ns,'wait','--for=condition=Ready','pod/target','pod/allowed','pod/denied','--timeout=90s'],undefined,100000);
 const attempt=async(name:string)=>exec(['-n',ns,'exec',name,'--','node','-e',"fetch('http://target:8080/',{signal:AbortSignal.timeout(2500)}).then(r=>r.text()).then(s=>process.exit(s==='ok'?0:1)).catch(()=>process.exit(2))"]);
 // Policy setup may converge after readiness. Only bounded polling of the same test resources.
 let allowed=false,denied=false;for(let i=0;i<10;i++){allowed=(await attempt('allowed')).code===0;denied=(await attempt('denied')).code===2;if(allowed&&denied)break;await new Promise(resolve=>setTimeout(resolve,1000))}
 assert.equal(allowed,true);assert.equal(denied,true);console.log('K3D network policy passed: allowed test Pod connected; denied test Pod could not reach the target.');
}finally{if(created)await exec(['delete','namespace',ns,'--wait=false'],undefined,20000)}
