import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {desktopIdentity} from '../src/server/desktop-resources.ts';

const image=process.env.COKE_GROK_DESKTOP_TEST_IMAGE;if(!image||!/^coke-grok-desktop:sha-[a-f0-9]{40}$/.test(image))throw new Error('Pinned test desktop image required');
const id=randomBytes(6).toString('hex'),control=`grok-broker-test-${id}`,role=`grok-broker-test-${id}`,testImage=`grok-broker-integration:${id}`,owner={tenantId:randomUUID(),userId:randomUUID()},signingKey=randomBytes(32),identity=desktopIdentity(owner,signingKey),dir=await mkdtemp(join(tmpdir(),'grok-broker-k3d-'));
let controlCreated=false,desktopCreated=false,roleCreated=false,bindingCreated=false;
async function exec(command:string,args:string[],input?:string,timeout=120_000){const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.setEncoding('utf8');child.stdout.on('data',c=>{out=(out+c).slice(-100000)});child.stderr.resume();child.stdin.end(input);const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);try{const [code]=await once(child,'close') as [number|null];return {code:code??1,out}}finally{clearTimeout(timer)}}
async function run(command:string,args:string[],input?:string,timeout?:number){const result=await exec(command,args,input,timeout);if(result.code!==0)throw new Error(`${command} integration test operation failed`);return result.out}
try{
 assert.equal((await run('kubectl',['config','current-context'])).trim(),'k3d-tp1121-sandbox-dev');
 await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1']);
 await run('node_modules/.bin/esbuild',['tests/desktop-broker-k3d-pod.ts','--bundle','--platform=node','--format=esm','--target=node24',`--outfile=${dir}/test.mjs`]);
 await writeFile(join(dir,'Dockerfile'),'FROM node:24-bookworm-slim@sha256:2af38505da611a8d2729ed2b6235f04613a4d5cf8b9340d3ca7b0ac54d1462a5\nCOPY test.mjs /app/test.mjs\nUSER node\nCMD ["node","/app/test.mjs"]\n');
 await run('docker',['build','-t',testImage,dir]);await run('k3d',['image','import',testImage,'-c','tp1121-sandbox-dev']);
 await run('kubectl',['create','namespace',control]);controlCreated=true;
 const labels={'app.kubernetes.io/managed-by':'coke-grok-bot','coke-grok-bot.io/owner-hash':identity.ownerHash};
 await run('kubectl',['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'Namespace',metadata:{name:identity.namespace,labels}}));desktopCreated=true;
 const clusterRole={apiVersion:'rbac.authorization.k8s.io/v1',kind:'ClusterRole',metadata:{name:role},rules:[{apiGroups:[''],resources:['namespaces'],resourceNames:[identity.namespace],verbs:['get']}]};
 await run('kubectl',['create','-f','-'],JSON.stringify(clusterRole));roleCreated=true;
 const clusterBinding={apiVersion:'rbac.authorization.k8s.io/v1',kind:'ClusterRoleBinding',metadata:{name:role},subjects:[{kind:'ServiceAccount',name:'broker',namespace:control}],roleRef:{apiGroup:'rbac.authorization.k8s.io',kind:'ClusterRole',name:role}};
 await run('kubectl',['create','-f','-'],JSON.stringify(clusterBinding));bindingCreated=true;
 const meta=(name:string,namespace=control)=>({name,namespace}),secret=(value:Buffer|string)=>Buffer.from(value).toString('base64');
 const objects=[
  {apiVersion:'v1',kind:'ServiceAccount',metadata:meta('broker')},
  {apiVersion:'v1',kind:'Secret',metadata:meta('test-secret'),type:'Opaque',data:{'signing-key':secret(signingKey),'broker-token':secret(randomBytes(32).toString('base64url')),'cert.pem':secret(await readFile(join(dir,'cert.pem'))),'key.pem':secret(await readFile(join(dir,'key.pem')))}},
  {apiVersion:'rbac.authorization.k8s.io/v1',kind:'Role',metadata:meta('desktop-provisioner',identity.namespace),rules:[{apiGroups:[''],resources:['persistentvolumeclaims','secrets','configmaps','services'],verbs:['get','create']},{apiGroups:['apps'],resources:['deployments'],verbs:['get','create']},{apiGroups:['networking.k8s.io'],resources:['networkpolicies'],verbs:['get','create']}]},
  {apiVersion:'rbac.authorization.k8s.io/v1',kind:'RoleBinding',metadata:meta('desktop-provisioner',identity.namespace),subjects:[{kind:'ServiceAccount',name:'broker',namespace:control}],roleRef:{apiGroup:'rbac.authorization.k8s.io',kind:'Role',name:'desktop-provisioner'}},
  {apiVersion:'v1',kind:'Pod',metadata:meta('broker-test'),spec:{serviceAccountName:'broker',restartPolicy:'Never',securityContext:{runAsNonRoot:true,runAsUser:1000,seccompProfile:{type:'RuntimeDefault'}},containers:[{name:'test',image:testImage,imagePullPolicy:'Never',env:[{name:'TEST_TENANT_ID',value:owner.tenantId},{name:'TEST_USER_ID',value:owner.userId},{name:'TEST_DESKTOP_IMAGE',value:image},{name:'TEST_CONTROL_NAMESPACE',value:control}],securityContext:{allowPrivilegeEscalation:false,readOnlyRootFilesystem:true,capabilities:{drop:['ALL']}},resources:{requests:{cpu:'20m',memory:'64Mi'},limits:{cpu:'1',memory:'256Mi'}},volumeMounts:[{name:'test-secret',mountPath:'/run/test-secret',readOnly:true}]}],volumes:[{name:'test-secret',secret:{secretName:'test-secret'}}]}},
 ];
 await run('kubectl',['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:objects}));
 let phase='';for(let i=0;i<240;i++){phase=(await run('kubectl',['-n',control,'get','pod','broker-test','-o','jsonpath={.status.phase}'])).trim();if(['Succeeded','Failed'].includes(phase))break;await new Promise(resolve=>setTimeout(resolve,1000))}
 if(phase!=='Succeeded'){const log=await exec('kubectl',['-n',control,'logs','broker-test']);throw new Error(`Scoped broker test did not succeed (${phase}): ${log.out.slice(-2000)}`)}
 const log=await run('kubectl',['-n',control,'logs','broker-test']);assert.equal(log.trim(),'Scoped broker K3D test passed: own desktop creation and idempotent access; other namespace reads and writes denied.');console.log(log.trim());
}finally{
 if(bindingCreated)await exec('kubectl',['delete','clusterrolebinding',role,'--wait=false'],undefined,20_000);
 if(roleCreated)await exec('kubectl',['delete','clusterrole',role,'--wait=false'],undefined,20_000);
 if(desktopCreated)await exec('kubectl',['delete','namespace',identity.namespace,'--wait=false'],undefined,20_000);
 if(controlCreated)await exec('kubectl',['delete','namespace',control,'--wait=false'],undefined,20_000);
 await rm(dir,{recursive:true,force:true});
}
