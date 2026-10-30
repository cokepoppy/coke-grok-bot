import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {namespaceBootstrapResources,personalDesktopBinding} from '../src/server/namespace-bootstrap-resources.ts';
import {NamespaceBootstrap} from '../src/server/namespace-bootstrap.ts';
import {desktopOwnerHash} from '../src/server/desktop-resources.ts';
import type {KubernetesObject} from '../src/server/desktop-provisioner.ts';

const id=randomBytes(6).toString('hex'),control=`grok-bootstrap-test-${id}`,policyPrefix=`grok-bootstrap-${id}`,bootstrapRole=`grok-bootstrap-${id}`,brokerRole=`grok-desktop-${id}`,owner={tenantId:randomUUID(),userId:randomUUID()},ownerHash=desktopOwnerHash(owner),desktop=`grok-user-${ownerHash}`;
const secondOwner={tenantId:randomUUID(),userId:randomUUID()},secondDesktop=`grok-user-${desktopOwnerHash(secondOwner)}`;
const options={controlNamespace:control,bootstrapServiceAccount:'bootstrap',brokerServiceAccount:'broker',bootstrapRole,brokerRole,policyPrefix};
const principal=`system:serviceaccount:${control}:bootstrap`,broker=`system:serviceaccount:${control}:broker`;
let controlCreated=false,desktopCreated=false,secondDesktopEligible=false;const created:{kind:string;name:string}[]=[];
async function exec(args:string[],input?:string,timeout=30_000){const child=spawn('kubectl',args,{stdio:['pipe','pipe','pipe']});let out='';for(const stream of [child.stdout,child.stderr]){stream.setEncoding('utf8');stream.on('data',c=>{out=(out+c).slice(-20000)})}child.stdin.end(input);const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);try{const [code]=await once(child,'close') as [number|null];return {code:code??1,out}}finally{clearTimeout(timer)}}
async function run(args:string[],input?:string){const result=await exec(args,input);if(result.code!==0)throw new Error(`Kubernetes test operation failed: ${result.out.slice(-1000)}`);return result.out}
const createAs=(object:unknown,dry=true)=>exec([`--as=${principal}`,'create','-f','-',...(dry?['--dry-run=server']:[])],JSON.stringify(object));
const labels={'app.kubernetes.io/managed-by':'coke-grok-bot','coke-grok-bot.io/owner-hash':ownerHash};
const namespace={apiVersion:'v1',kind:'Namespace',metadata:{name:desktop,labels}};
try{
 assert.equal((await run(['config','current-context'])).trim(),'k3d-tp1121-sandbox-dev');
 await run(['create','namespace',control]);controlCreated=true;
 await run(['create','-f','-'],JSON.stringify({apiVersion:'v1',kind:'List',items:[{apiVersion:'v1',kind:'ServiceAccount',metadata:{name:'bootstrap',namespace:control}},{apiVersion:'v1',kind:'ServiceAccount',metadata:{name:'broker',namespace:control}}]}));
 const resources=namespaceBootstrapResources(options);
 // Install both admission policies and bindings before granting any privileges to the test identity.
 for(const object of resources){
  const kind=String(object.kind),name=String((object.metadata as {name:string}).name);await run(['create','-f','-'],JSON.stringify(object));created.push({kind,name});
 }
 const invalidNamespace={...namespace,metadata:{name:`hostile-${id}`,labels}};
 let denied=false;for(let i=0;i<30;i++){const result=await createAs(invalidNamespace);if(result.code!==0&&result.out.includes('ValidatingAdmissionPolicy')){denied=true;break}await new Promise(resolve=>setTimeout(resolve,500))}assert.equal(denied,true,'namespace admission did not enforce the test identity');
 const wrongHash={...namespace,metadata:{name:desktop,labels:{...labels,'coke-grok-bot.io/owner-hash':'0'.repeat(32)}}};assert.notEqual((await createAs(wrongHash)).code,0);
 const withAnnotation={...namespace,metadata:{name:desktop,labels,annotations:{'test.example/unwanted':'true'}}};assert.notEqual((await createAs(withAnnotation)).code,0);
 const withFinalizer={...namespace,spec:{finalizers:['example.test/retain']}};const rejectedFinalizer=await createAs(withFinalizer);assert.notEqual(rejectedFinalizer.code,0);assert.match(rejectedFinalizer.out,/ValidatingAdmissionPolicy/);
 const createdNamespace=await createAs(namespace,false);if(createdNamespace.code!==0)throw new Error(`Allowed namespace was rejected: ${createdNamespace.out.slice(-1000)}`);desktopCreated=true;
 const binding=personalDesktopBinding(desktop,options),wrongSubject=structuredClone(binding) as any;wrongSubject.subjects[0].name='default';
 let bindingPolicyReady=false;for(let i=0;i<30;i++){const result=await createAs(wrongSubject);if(result.code!==0&&result.out.includes('ValidatingAdmissionPolicy')){bindingPolicyReady=true;break}await new Promise(resolve=>setTimeout(resolve,500))}assert.equal(bindingPolicyReady,true,'role binding admission did not enforce the test identity');
 const wrongRole=structuredClone(binding) as any;wrongRole.roleRef.name='cluster-admin';assert.notEqual((await createAs(wrongRole)).code,0);
 const existingProject=structuredClone(binding) as any;existingProject.metadata.namespace='coke-grok-bot';const rejectedProject=await createAs(existingProject);assert.notEqual(rejectedProject.code,0);assert.match(rejectedProject.out,/ValidatingAdmissionPolicy/);
 const kube={get:async(kind:string,namespace:string|null,name:string)=>{const args=[`--as=${principal}`,...(namespace?['-n',namespace]:[]),'get',kind,name,'--ignore-not-found','-o','json'];const result=await exec(args);if(result.code!==0)throw new Error('Scoped bootstrap get failed');return result.out.trim()?JSON.parse(result.out) as KubernetesObject:null},create:async(object:KubernetesObject)=>{const result=await createAs(object,false);if(result.code!==0)throw new Error('Scoped bootstrap create failed');return true}};
 const bootstrap=new NamespaceBootstrap(kube,options),signal=AbortSignal.timeout(20_000);assert.equal(await bootstrap.ensure(owner,signal),desktop);assert.equal(await bootstrap.ensure(owner,signal),desktop);
 const beforeSecond=await exec(['get','namespace',secondDesktop,'--ignore-not-found','-o','name']);assert.equal(beforeSecond.code,0);assert.equal(beforeSecond.out.trim(),'');secondDesktopEligible=true;
 assert.equal(await bootstrap.ensure(secondOwner,signal),secondDesktop);assert.equal(await bootstrap.ensure(secondOwner,signal),secondDesktop);
 assert.equal((await exec([`--as=${broker}`,'auth','can-i','create','deployments','-n',desktop])).out.trim(),'yes');
 assert.equal((await exec([`--as=${broker}`,'auth','can-i','get','secrets','-n','coke-grok-bot'])).out.trim(),'no');
 assert.equal((await exec([`--as=${principal}`,'auth','can-i','delete','namespaces'])).out.trim().split('\n').at(-1),'no');
 assert.equal((await exec([`--as=${principal}`,'auth','can-i','get','secrets','-n','coke-grok-bot'])).out.trim(),'no');
 console.log('Namespace bootstrap K3D test passed: only the labeled personal namespace and designated broker binding were admitted; other-project access denied.');
}finally{
 for(const object of created.reverse())await exec(['delete',object.kind,object.name,'--wait=false']);
 if(desktopCreated)await exec(['delete','namespace',desktop,'--wait=false']);
 if(secondDesktopEligible)await exec(['delete','namespace',secondDesktop,'--wait=false','--ignore-not-found']);
 if(controlCreated)await exec(['delete','namespace',control,'--wait=false']);
}
