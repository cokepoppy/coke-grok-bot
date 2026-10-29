import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const testId=randomBytes(6).toString('hex'),namespace=`grok-kube-test-${testId}`,image=`coke-grok-kube-client-test:${testId}`,dir=await mkdtemp(join(tmpdir(),'grok-kube-client-'));let created=false;
async function exec(command:string,args:string[],input?:string,timeout=120000){const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{out+=chunk});child.stderr.resume();child.stdin.end(input);const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);try{const [code]=await once(child,'close') as [number|null];return {code:code??1,out}}finally{clearTimeout(timer)}}
async function run(command:string,args:string[],input?:string,timeout?:number){const result=await exec(command,args,input,timeout);if(result.code!==0)throw new Error(`${command} test step failed`);return result.out}
try{
 assert.equal((await run('kubectl',['config','current-context'])).trim(),'k3d-tp1121-sandbox-dev');
 await run('node_modules/.bin/esbuild',['tests/kube-client-pod.ts','--bundle','--platform=node','--format=cjs','--target=node24',`--outfile=${dir}/test.cjs`]);
 await writeFile(join(dir,'Dockerfile'),'FROM node:24-bookworm-slim@sha256:2af38505da611a8d2729ed2b6235f04613a4d5cf8b9340d3ca7b0ac54d1462a5\nCOPY test.cjs /app/test.cjs\nUSER node\nCMD ["node","/app/test.cjs"]\n');
 await run('docker',['build','-t',image,dir]);await run('k3d',['image','import',image,'-c','tp1121-sandbox-dev']);
 await run('kubectl',['create','namespace',namespace]);created=true;
 const meta=(name:string)=>({name,namespace});
 const objects=[
  {apiVersion:'v1',kind:'ServiceAccount',metadata:meta('scoped-client')},
  {apiVersion:'v1',kind:'ConfigMap',metadata:meta('fixture'),data:{ok:'true'}},
  {apiVersion:'rbac.authorization.k8s.io/v1',kind:'Role',metadata:meta('config-reader'),rules:[{apiGroups:[''],resources:['configmaps'],resourceNames:['fixture'],verbs:['get']}]},
  {apiVersion:'rbac.authorization.k8s.io/v1',kind:'RoleBinding',metadata:meta('config-reader'),subjects:[{kind:'ServiceAccount',name:'scoped-client',namespace}],roleRef:{apiGroup:'rbac.authorization.k8s.io',kind:'Role',name:'config-reader'}},
  {apiVersion:'v1',kind:'Pod',metadata:meta('client-test'),spec:{serviceAccountName:'scoped-client',restartPolicy:'Never',securityContext:{runAsNonRoot:true,runAsUser:1000,seccompProfile:{type:'RuntimeDefault'}},containers:[{name:'test',image,imagePullPolicy:'Never',env:[{name:'TEST_NAMESPACE',value:namespace}],securityContext:{allowPrivilegeEscalation:false,readOnlyRootFilesystem:true,capabilities:{drop:['ALL']}},resources:{requests:{cpu:'10m',memory:'32Mi'},limits:{cpu:'500m',memory:'128Mi'}}}]}},
 ];
 await run('kubectl',['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:objects}));
 let phase='';for(let i=0;i<120;i++){phase=(await run('kubectl',['-n',namespace,'get','pod','client-test','-o','jsonpath={.status.phase}'])).trim();if(['Succeeded','Failed'].includes(phase))break;await new Promise(resolve=>setTimeout(resolve,1000))}
 if(phase!=='Succeeded')throw new Error(`Scoped Kubernetes test Pod did not succeed (${phase})`);
 const logs=await run('kubectl',['-n',namespace,'logs','client-test']);assert.equal(logs.trim(),'Scoped in-cluster Kubernetes client passed: permitted own ConfigMap, denied Secrets and other namespace.');console.log(logs.trim());
}finally{if(created)await exec('kubectl',['delete','namespace',namespace,'--wait=false'],undefined,20000);await rm(dir,{recursive:true,force:true})}
