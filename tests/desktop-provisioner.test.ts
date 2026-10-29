import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { DesktopProvisioner, type DesktopKubernetes, type KubernetesObject } from '../src/server/desktop-provisioner.ts';
import { desktopIdentity } from '../src/server/desktop-resources.ts';
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
 assert.equal(kube.creates,7);await provisioner.connect(owner,new AbortController().signal);assert.equal(kube.creates,7);assert.equal(kube.ready,2);
 const deploymentKey=kube.key('Deployment',identity.namespace,'desktop'),deployment=kube.objects.get(deploymentKey)! as any;
 deployment.spec.template.spec.containers[0].securityContext.runAsUser=0;
 await assert.rejects(provisioner.connect(owner,new AbortController().signal));assert.equal(kube.creates,7);assert.equal(kube.ready,2);
 assert.equal((kube.objects.get(deploymentKey)! as any).spec.template.spec.containers[0].securityContext.runAsUser,0);
});
test('provisioner refuses an unrelated namespace and honors cancellation',async()=>{
 const owner={tenantId:randomUUID(),userId:randomUUID()},key=randomBytes(32),identity=desktopIdentity(owner,key),kube=new FakeKube();
 kube.objects.set(kube.key('Namespace',null,identity.namespace),{apiVersion:'v1',kind:'Namespace',metadata:{name:identity.namespace,labels:{'app.kubernetes.io/managed-by':'other'}}});
 const provisioner=new DesktopProvisioner(kube,key,options);
 await assert.rejects(provisioner.connect(owner,new AbortController().signal));assert.equal(kube.creates,0);
 const abort=new AbortController();abort.abort();await assert.rejects(provisioner.connect(owner,abort.signal));assert.equal(kube.creates,0);
});
