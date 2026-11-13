import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { DesktopProvisioner, matchesExpectedResource, type DesktopKubernetes, type KubernetesObject } from '../src/server/desktop-provisioner.ts';
import { desktopIdentity, desktopResources, splitDesktopResources } from '../src/server/desktop-resources.ts';
const options={image:`coke-grok-desktop:sha-${'a'.repeat(40)}`,controlNamespace:'coke-grok-bot',gatewayCA:'-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----'};
class FakeKube implements DesktopKubernetes {
 objects=new Map<string,KubernetesObject>(); creates=0;ready=0;
 key(kind:string,ns:string|null,name:string){return `${kind}:${ns||''}:${name}`}
 async get(kind:string,ns:string|null,name:string){return structuredClone(this.objects.get(this.key(kind,ns,name))||null)}
 async create(object:KubernetesObject){
  const meta=object.metadata as {name:string;namespace?:string},key=this.key(String(object.kind),meta.namespace||null,meta.name);
  if(this.objects.has(key))return false;this.creates++;
  const actual=structuredClone(object);
  if(actual.kind==='Secret'){const strings=actual.stringData as Record<string,string>;delete actual.stringData;actual.data=Object.fromEntries(Object.entries(strings).map(([k,v])=>[k,Buffer.from(v).toString('base64')]))}
  this.objects.set(key,actual);return true;
 }
 async waitForReady(){this.ready++}
}
test('provisioning is owner-scoped, idempotent and never overwrites existing resources',async()=>{
 const owner={tenantId:randomUUID(),userId:randomUUID()},key=randomBytes(32),identity=desktopIdentity(owner,key),kube=new FakeKube(),provisioner=new DesktopProvisioner(kube,key,options);
 const result=await provisioner.connect(owner,new AbortController().signal);
 assert.equal(result.agentUrl.href,`http://desktop.${identity.namespace}.svc.cluster.local:8083/`);assert.equal(result.agentToken,identity.agentToken);
 assert.equal(kube.creates,8);await provisioner.connect(owner,new AbortController().signal);assert.equal(kube.creates,8);assert.equal(kube.ready,2);
 const deploymentKey=kube.key('Deployment',identity.namespace,'desktop'),deployment=kube.objects.get(deploymentKey)! as any;
 deployment.spec.template.spec.containers[0].securityContext.runAsUser=0;
 await assert.rejects(provisioner.connect(owner,new AbortController().signal));assert.equal(kube.creates,8);assert.equal(kube.ready,2);
 assert.equal((kube.objects.get(deploymentKey)! as any).spec.template.spec.containers[0].securityContext.runAsUser,0);
});
test('provisioner refuses an unrelated namespace and honors cancellation',async()=>{
 const owner={tenantId:randomUUID(),userId:randomUUID()},key=randomBytes(32),identity=desktopIdentity(owner,key),kube=new FakeKube();
 kube.objects.set(kube.key('Namespace',null,identity.namespace),{apiVersion:'v1',kind:'Namespace',metadata:{name:identity.namespace,labels:{'app.kubernetes.io/managed-by':'other'}}});
 const provisioner=new DesktopProvisioner(kube,key,options);
 await assert.rejects(provisioner.connect(owner,new AbortController().signal));assert.equal(kube.creates,0);
 const abort=new AbortController();abort.abort();await assert.rejects(provisioner.connect(owner,abort.signal));assert.equal(kube.creates,0);
});
test('split provisioning waits for both Pods and returns the scoped Agent service',async()=>{
 const owner={tenantId:randomUUID(),userId:randomUUID()},key=randomBytes(32),identity=desktopIdentity(owner,key),kube=new FakeKube(),provisioner=new DesktopProvisioner(kube,key,{...options,agentImage:`coke-grok-desktop:sha-${'b'.repeat(40)}`,split:true});
 const result=await provisioner.connect(owner,new AbortController().signal);assert.equal(result.agentUrl.hostname,`agent.${identity.namespace}.svc.cluster.local`);
 assert.equal(kube.creates,11);assert.equal(kube.ready,2);await provisioner.connect(owner,new AbortController().signal);assert.equal(kube.creates,11);assert.equal(kube.ready,4);
 assert.match((kube.objects.get(kube.key('Deployment',identity.namespace,'desktop')) as any).spec.template.spec.containers[0].image,/a{40}$/);
 assert.match((kube.objects.get(kube.key('Deployment',identity.namespace,'agent')) as any).spec.template.spec.containers[0].image,/b{40}$/);
});
test('provisioner delegates namespace creation and rejects a different owner',async()=>{
 const owner={tenantId:randomUUID(),userId:randomUUID()},key=randomBytes(32),identity=desktopIdentity(owner,key),kube=new FakeKube(),signal=new AbortController().signal;let called=0;
 const bootstrap={ensure:async(selected:typeof owner)=>{called++;assert.deepEqual(selected,owner);return identity.namespace}};
 const provisioner=new DesktopProvisioner(kube,key,{...options,split:true,bootstrap});await provisioner.connect(owner,signal);
 assert.equal(called,1);assert.equal(kube.objects.has(kube.key('Namespace',null,identity.namespace)),false);assert.equal(kube.creates,10);
 const wrong=new DesktopProvisioner(new FakeKube(),key,{...options,split:true,bootstrap:{ensure:async()=>`grok-user-${'a'.repeat(32)}`}});await assert.rejects(wrong.connect(owner,signal),error=>error instanceof Error&&error.message==='OWNER_BINDING_MISMATCH');
});
test('existing owner namespaces adopt their current Agent and Desktop images into an immutable per-owner pin',async()=>{
 const owner={tenantId:randomUUID(),userId:randomUUID()},key=randomBytes(32),identity=desktopIdentity(owner,key),kube=new FakeKube();
 const desktopImage=`coke-grok-desktop:sha-${'a'.repeat(40)}`,agentImage='coke-grok-desktop:candidate-focus-screenshot-fix-20261107-r1';
 const legacy=splitDesktopResources(identity,{...options,image:desktopImage,agentImage:`coke-grok-desktop:sha-${'b'.repeat(40)}`});
 for(const resource of legacy){
  const meta=resource.metadata as {name:string};if(resource.kind==='ConfigMap'&&meta.name==='desktop-image-pin')continue;
  const actual=structuredClone(resource) as any;
  if(resource.kind==='Deployment'&&meta.name==='agent')actual.spec.template.spec.containers[0].image=agentImage;
  await kube.create(actual);
 }
 kube.creates=0;
 const provisioner=new DesktopProvisioner(kube,key,{...options,image:`coke-grok-desktop:sha-${'c'.repeat(40)}`,agentImage:`coke-grok-desktop:sha-${'d'.repeat(40)}`,split:true});
 await provisioner.connect(owner,new AbortController().signal);
 assert.equal(kube.creates,1);
 const pin=kube.objects.get(kube.key('ConfigMap',identity.namespace,'desktop-image-pin')) as any;
 assert.equal(pin.immutable,true);
 assert.deepEqual(pin.data,{desktopImage,agentImage});
 assert.equal(kube.ready,2);
 await new DesktopProvisioner(kube,key,{...options,image:`coke-grok-desktop:sha-${'e'.repeat(40)}`,agentImage:`coke-grok-desktop:sha-${'f'.repeat(40)}`,split:true}).connect(owner,new AbortController().signal);
 assert.equal(kube.creates,1);assert.equal(kube.ready,4);
});
test('legacy resource drift is rejected before creating an owner image pin',async()=>{
 const owner={tenantId:randomUUID(),userId:randomUUID()},key=randomBytes(32),identity=desktopIdentity(owner,key),kube=new FakeKube();
 const resources=splitDesktopResources(identity,{...options,agentImage:`coke-grok-desktop:sha-${'b'.repeat(40)}`});
 for(const resource of resources){const meta=resource.metadata as {name:string};if(resource.kind==='ConfigMap'&&meta.name==='desktop-image-pin')continue;await kube.create(resource)}
 const desktop=kube.objects.get(kube.key('Deployment',identity.namespace,'desktop')) as any;
 desktop.spec.template.spec.containers[0].securityContext.runAsUser=0;
 kube.creates=0;
 await assert.rejects(new DesktopProvisioner(kube,key,{...options,split:true}).connect(owner,new AbortController().signal),error=>error instanceof Error&&error.message==='RESOURCE_MISMATCH');
 assert.equal(kube.creates,0);assert.equal(kube.objects.has(kube.key('ConfigMap',identity.namespace,'desktop-image-pin')),false);assert.equal(kube.ready,0);
});
test('an existing owner image pin rejects later deployment image drift',async()=>{
 const owner={tenantId:randomUUID(),userId:randomUUID()},key=randomBytes(32),identity=desktopIdentity(owner,key),kube=new FakeKube();
 const provisioner=new DesktopProvisioner(kube,key,{...options,split:true});await provisioner.connect(owner,new AbortController().signal);
 const agent=kube.objects.get(kube.key('Deployment',identity.namespace,'agent')) as any;
 agent.spec.template.spec.containers[0].image=`coke-grok-desktop:sha-${'f'.repeat(40)}`;
 kube.creates=0;kube.ready=0;
 await assert.rejects(provisioner.connect(owner,new AbortController().signal),error=>error instanceof Error&&error.message==='RESOURCE_MISMATCH');
 assert.equal(kube.creates,0);assert.equal(kube.ready,0);
});
test('an owner image pin must be immutable before it can authorize provisioning',async()=>{
 const owner={tenantId:randomUUID(),userId:randomUUID()},key=randomBytes(32),identity=desktopIdentity(owner,key),kube=new FakeKube();
 const provisioner=new DesktopProvisioner(kube,key,{...options,split:true});await provisioner.connect(owner,new AbortController().signal);
 const pin=kube.objects.get(kube.key('ConfigMap',identity.namespace,'desktop-image-pin')) as any;
 pin.immutable=false;kube.creates=0;kube.ready=0;
 await assert.rejects(provisioner.connect(owner,new AbortController().signal),error=>error instanceof Error&&error.message==='RESOURCE_MISMATCH');
 assert.equal(kube.creates,0);assert.equal(kube.ready,0);
});
test('desktop provisioning accepts the legacy omitted eight-screen default without accepting other drift',()=>{
 const owner={tenantId:randomUUID(),userId:randomUUID()},key=randomBytes(32),identity=desktopIdentity(owner,key);
 const expected=desktopResources(identity,options).find(item=>item.kind==='Deployment'&&(item.metadata as {name:string}).name==='desktop') as KubernetesObject;
 const legacy=structuredClone(expected),legacySpec=legacy.spec as any;
 legacySpec.template.spec.containers[0].env=legacySpec.template.spec.containers[0].env.filter((item:any)=>item.name!=='COKE_DESKTOP_SCREEN_SLOTS');
 assert.equal(matchesExpectedResource(expected,legacy),true);
 legacySpec.template.spec.containers[0].env.find((item:any)=>item.name==='COKE_DESKTOP_RESOLUTION').value='1280x800';
 assert.equal(matchesExpectedResource(expected,legacy),false);
});
