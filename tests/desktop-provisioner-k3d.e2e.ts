import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { DesktopProvisioner,type DesktopKubernetes,type KubernetesObject } from '../src/server/desktop-provisioner.ts';
import { desktopIdentity,splitDesktopResources } from '../src/server/desktop-resources.ts';
const image=process.env.COKE_GROK_DESKTOP_TEST_IMAGE;if(!image)throw new Error('Pinned desktop image required');
const legacyImage=process.env.COKE_GROK_DESKTOP_TEST_LEGACY_IMAGE??image;
const key=randomBytes(32),createdNamespaces=new Set<string>(),controlNamespace='coke-grok-bot',gatewayCA='-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
async function exec(args:string[],input?:string,timeout=120_000){
 const child=spawn('kubectl',args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{out+=chunk});child.stderr.resume();child.stdin.end(input);
 const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);try{const [code]=await once(child,'close') as [number|null];return {code:code??1,out}}finally{clearTimeout(timer)}
}
const kube:DesktopKubernetes={
 async get(kind,namespace,name){const r=await exec([...(namespace?['-n',namespace]:[]),'get',kind,name,'--ignore-not-found','-o','json']);if(r.code!==0)throw new Error('Kubernetes read failed');return r.out.trim()?JSON.parse(r.out):null},
 async create(object){const r=await exec(['create','-f','-'],JSON.stringify(object));if(r.code!==0)throw new Error(`Kubernetes create failed: ${object.kind}`);if(object.kind==='Namespace')createdNamespaces.add(String((object.metadata as {name:string}).name));return true},
 async waitForReady(namespace,name){const r=await exec(['-n',namespace,'rollout','status',`deployment/${name}`,'--timeout=150s'],undefined,160_000);if(r.code!==0)throw new Error('Desktop deployment did not become ready')}
};
async function cleanupNamespace(namespace:string):Promise<void>{
 const removed=await exec(['delete','namespace',namespace,'--wait=true','--timeout=90s'],undefined,100_000);
 assert.equal(removed.code,0,`failed to delete E2E-owned namespace ${namespace}`);
 const remaining=await exec(['get','namespace',namespace,'--ignore-not-found','-o','name']);
 assert.equal(remaining.out.trim(),'','E2E-owned namespace remained after cleanup');
 createdNamespaces.delete(namespace);
}
try{
 const context=await exec(['config','current-context']);assert.equal(context.out.trim(),'k3d-tp1121-sandbox-dev');
 const provisioner=new DesktopProvisioner(kube,key,{image,controlNamespace,gatewayCA,split:true});
 const owner={tenantId:randomUUID(),userId:randomUUID()},identity=desktopIdentity(owner,key),signal=new AbortController().signal;
 const first=await provisioner.connect(owner,signal);assert.equal(first.agentUrl.hostname,`agent.${identity.namespace}.svc.cluster.local`);
 const second=await provisioner.connect(owner,signal);assert.equal(second.agentUrl.href,first.agentUrl.href);
 console.log('K3D desktop provisioner passed: new owner creation, readiness and idempotent re-read.');
 await cleanupNamespace(identity.namespace);

 const legacyOwner={tenantId:randomUUID(),userId:randomUUID()},legacyIdentity=desktopIdentity(legacyOwner,key);
 const legacyResources=splitDesktopResources(legacyIdentity,{image:legacyImage,agentImage:legacyImage,controlNamespace,gatewayCA});
 for(const resource of legacyResources){
  const metadata=resource.metadata as {name?:string};
  if(resource.kind==='ConfigMap'&&metadata.name==='desktop-image-pin')continue;
  await kube.create(resource,signal);
 }
 assert.equal(await kube.get('ConfigMap',legacyIdentity.namespace,'desktop-image-pin',signal),null,'legacy namespace must begin without an image pin');
 const preexistingAgent=await kube.get('Deployment',legacyIdentity.namespace,'agent',signal) as any;
 const preexistingDesktop=await kube.get('Deployment',legacyIdentity.namespace,'desktop',signal) as any;
 assert.equal(preexistingAgent.spec.template.spec.containers[0].image,legacyImage);
 assert.equal(preexistingDesktop.spec.template.spec.containers[0].image,legacyImage);
 const adopted=await provisioner.connect(legacyOwner,signal);assert.equal(adopted.agentUrl.hostname,`agent.${legacyIdentity.namespace}.svc.cluster.local`);
 const pin=await kube.get('ConfigMap',legacyIdentity.namespace,'desktop-image-pin',signal) as any;
 assert.equal(pin?.immutable,true);assert.deepEqual(pin?.data,{desktopImage:legacyImage,agentImage:legacyImage});
 const restartedProvisioner=new DesktopProvisioner(kube,key,{image:`coke-grok-desktop:sha-${'a'.repeat(40)}`,agentImage:`coke-grok-desktop:sha-${'b'.repeat(40)}`,controlNamespace,gatewayCA,split:true});
 await restartedProvisioner.connect(legacyOwner,signal);
 const retainedAgent=await kube.get('Deployment',legacyIdentity.namespace,'agent',signal) as any;
 const retainedDesktop=await kube.get('Deployment',legacyIdentity.namespace,'desktop',signal) as any;
 assert.equal(retainedAgent.spec.template.spec.containers[0].image,legacyImage,'Broker default changes must not roll a pinned Agent');
 assert.equal(retainedDesktop.spec.template.spec.containers[0].image,legacyImage,'Broker default changes must not roll a pinned Desktop');
 console.log('K3D desktop provisioner passed: legacy image adoption, immutable pin and reconnect after Broker defaults change.');
}finally{
 for(const namespace of createdNamespaces)await cleanupNamespace(namespace);
}
