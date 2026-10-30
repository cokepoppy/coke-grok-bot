import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {desktopOwnerHash} from '../src/server/desktop-resources.ts';
import {namespaceBootstrapResources,personalDesktopBinding} from '../src/server/namespace-bootstrap-resources.ts';

const image=process.env.COKE_GROK_DESKTOP_TEST_IMAGE;if(!image||!/^coke-grok-desktop:sha-[a-f0-9]{40}$/.test(image))throw new Error('Pinned test desktop image required');
const id=randomBytes(6).toString('hex'),control=`grok-dynamic-test-${id}`,policyPrefix=`grok-dynamic-${id}`,bootstrapRole=`grok-bootstrap-${id}`,brokerRole=`grok-desktop-${id}`,testImage=`grok-dynamic-integration:${id}`,owner={tenantId:randomUUID(),userId:randomUUID()},desktop=`grok-user-${desktopOwnerHash(owner)}`,dir=await mkdtemp(join(tmpdir(),'grok-dynamic-k3d-'));
const options={controlNamespace:control,bootstrapServiceAccount:'bootstrap',brokerServiceAccount:'broker',bootstrapRole,brokerRole,policyPrefix},principal=`system:serviceaccount:${control}:bootstrap`;
let controlCreated=false,desktopEligible=false;const created:{kind:string;name:string}[]=[];
async function exec(command:string,args:string[],input?:string,timeout=120_000){const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});let out='';for(const stream of [child.stdout,child.stderr]){stream.setEncoding('utf8');stream.on('data',c=>{out=(out+c).slice(-20000)})}child.stdin.end(input);const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);try{const [code]=await once(child,'close') as [number|null];return {code:code??1,out}}finally{clearTimeout(timer)}}
async function run(command:string,args:string[],input?:string,timeout?:number){const result=await exec(command,args,input,timeout);if(result.code!==0)throw new Error(`${command} test operation failed: ${result.out.slice(-1000)}`);return result.out}
const dryRun=(object:unknown)=>exec('kubectl',[`--as=${principal}`,'create','-f','-','--dry-run=server'],JSON.stringify(object));
async function waitDenied(object:unknown){for(let i=0;i<40;i++){const result=await dryRun(object);if(result.code!==0&&result.out.includes('ValidatingAdmissionPolicy'))return;await new Promise(resolve=>setTimeout(resolve,500))}throw new Error('Admission policy did not enforce the test identity')}
try{
 assert.equal((await run('kubectl',['config','current-context'])).trim(),'k3d-tp1121-sandbox-dev');
 const before=await exec('kubectl',['get','namespace',desktop,'--ignore-not-found','-o','name']);assert.equal(before.code,0);assert.equal(before.out.trim(),'');desktopEligible=true;
 const serviceHost=`coke-grok-namespace-bootstrap.${control}.svc.cluster.local`;
 await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'bootstrap-key.pem'),'-out',join(dir,'bootstrap-cert.pem'),'-days','1','-subj','/CN=bootstrap-test','-addext',`subjectAltName=DNS:${serviceHost}`]);
 await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'broker-key.pem'),'-out',join(dir,'broker-cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1']);
 for(const [source,target] of [['tests/namespace-service-k3d-pod.ts','bootstrap'],['tests/dynamic-provisioner-k3d-pod.ts','broker']])await run('node_modules/.bin/esbuild',[source,'--bundle','--platform=node','--format=esm','--target=node24',`--outfile=${dir}/${target}.mjs`]);
 await writeFile(join(dir,'Dockerfile'),'FROM node:24-bookworm-slim@sha256:2af38505da611a8d2729ed2b6235f04613a4d5cf8b9340d3ca7b0ac54d1462a5\nCOPY bootstrap.mjs broker.mjs /app/\nUSER node\nCMD ["node","/app/bootstrap.mjs"]\n');
 await run('docker',['build','-t',testImage,dir]);await run('k3d',['image','import',testImage,'-c','tp1121-sandbox-dev']);
 await run('kubectl',['create','namespace',control]);controlCreated=true;
 const meta=(name:string)=>({name,namespace:control}),asBase64=(value:Buffer|string)=>Buffer.from(value).toString('base64'),bootstrapToken=randomBytes(32).toString('base64url');
 const secretObjects=[
  {apiVersion:'v1',kind:'ServiceAccount',metadata:meta('bootstrap')},{apiVersion:'v1',kind:'ServiceAccount',metadata:meta('broker')},
  {apiVersion:'v1',kind:'Secret',metadata:meta('bootstrap-test-secret'),type:'Opaque',data:{'cert.pem':asBase64(await readFile(join(dir,'bootstrap-cert.pem'))),'key.pem':asBase64(await readFile(join(dir,'bootstrap-key.pem'))),token:asBase64(bootstrapToken)}},
  {apiVersion:'v1',kind:'Secret',metadata:meta('broker-test-secret'),type:'Opaque',data:{'bootstrap-cert.pem':asBase64(await readFile(join(dir,'bootstrap-cert.pem'))),'bootstrap-token':asBase64(bootstrapToken),'broker-cert.pem':asBase64(await readFile(join(dir,'broker-cert.pem'))),'broker-key.pem':asBase64(await readFile(join(dir,'broker-key.pem'))),'broker-token':asBase64(randomBytes(32).toString('base64url')),'signing-key':asBase64(randomBytes(32))}},
 ];
 await run('kubectl',['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:secretObjects}));
 for(const object of namespaceBootstrapResources(options)){const kind=String(object.kind),name=String((object.metadata as {name:string}).name);await run('kubectl',['create','-f','-'],JSON.stringify(object));created.push({kind,name})}
 await waitDenied({apiVersion:'v1',kind:'Namespace',metadata:{name:`other-${id}`}});
 const wrongBinding=personalDesktopBinding(desktop,options) as any;wrongBinding.metadata.namespace='coke-grok-bot';await waitDenied(wrongBinding);
 const commonSecurity={runAsNonRoot:true,runAsUser:1000,seccompProfile:{type:'RuntimeDefault'}},containerSecurity={allowPrivilegeEscalation:false,readOnlyRootFilesystem:true,capabilities:{drop:['ALL']}};
 const bootstrapPod={apiVersion:'v1',kind:'Pod',metadata:{...meta('bootstrap'),labels:{app:'bootstrap'}},spec:{serviceAccountName:'bootstrap',restartPolicy:'Never',securityContext:commonSecurity,containers:[{name:'bootstrap',image:testImage,imagePullPolicy:'Never',env:[{name:'TEST_CONTROL_NAMESPACE',value:control},{name:'TEST_BROKER_ROLE',value:brokerRole}],ports:[{containerPort:3004,name:'https'}],readinessProbe:{tcpSocket:{port:3004},periodSeconds:2},securityContext:containerSecurity,volumeMounts:[{name:'secret',mountPath:'/run/test-secret',readOnly:true}]}],volumes:[{name:'secret',secret:{secretName:'bootstrap-test-secret'}}]}};
 const service={apiVersion:'v1',kind:'Service',metadata:meta('coke-grok-namespace-bootstrap'),spec:{selector:{app:'bootstrap'},ports:[{port:3004,targetPort:'https'}]}};
 await run('kubectl',['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:[bootstrapPod,service]}));
 await run('kubectl',['-n',control,'wait','--for=condition=Ready','pod/bootstrap','--timeout=120s'],undefined,130_000);
 const brokerPod={apiVersion:'v1',kind:'Pod',metadata:meta('broker-test'),spec:{serviceAccountName:'broker',restartPolicy:'Never',securityContext:commonSecurity,containers:[{name:'broker',image:testImage,imagePullPolicy:'Never',command:['node','/app/broker.mjs'],env:[{name:'TEST_TENANT_ID',value:owner.tenantId},{name:'TEST_USER_ID',value:owner.userId},{name:'TEST_DESKTOP_IMAGE',value:image},{name:'TEST_CONTROL_NAMESPACE',value:control},{name:'TEST_BOOTSTRAP_URL',value:`https://${serviceHost}:3004/`}],securityContext:containerSecurity,resources:{requests:{cpu:'20m',memory:'64Mi'},limits:{cpu:'1',memory:'256Mi'}},volumeMounts:[{name:'secret',mountPath:'/run/test-secret',readOnly:true}]}],volumes:[{name:'secret',secret:{secretName:'broker-test-secret'}}]}};
 await run('kubectl',['create','-f','-'],JSON.stringify(brokerPod));
 let phase='';for(let i=0;i<240;i++){phase=(await run('kubectl',['-n',control,'get','pod','broker-test','-o','jsonpath={.status.phase}'])).trim();if(['Succeeded','Failed'].includes(phase))break;await new Promise(resolve=>setTimeout(resolve,1000))}
 if(phase!=='Succeeded'){const log=await exec('kubectl',['-n',control,'logs','broker-test']);throw new Error(`Dynamic broker test did not succeed (${phase}): ${log.out.slice(-2000)}`)}
 const log=await run('kubectl',['-n',control,'logs','broker-test']);assert.equal(log.trim(),'Dynamic provisioning K3D test passed: separate service accounts, TLS namespace bootstrap, personal desktop creation and repeated access.');console.log(log.trim());
}finally{
 for(const object of created.reverse())await exec('kubectl',['delete',object.kind,object.name,'--wait=false'],undefined,20_000);
 if(desktopEligible)await exec('kubectl',['delete','namespace',desktop,'--wait=false','--ignore-not-found'],undefined,20_000);
 if(controlCreated)await exec('kubectl',['delete','namespace',control,'--wait=false'],undefined,20_000);
 await rm(dir,{recursive:true,force:true});
}
