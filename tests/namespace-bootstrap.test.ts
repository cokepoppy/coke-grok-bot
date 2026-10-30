import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NamespaceBootstrap} from '../src/server/namespace-bootstrap.ts';
import {namespaceBootstrapResources} from '../src/server/namespace-bootstrap-resources.ts';
import type {KubernetesObject} from '../src/server/desktop-provisioner.ts';

test('personal namespace bootstrap creates only owner resources and refuses changed bindings',async()=>{
 const objects=new Map<string,KubernetesObject>(),created:string[]=[];
 const key=(kind:string,namespace:string|null,name:string)=>`${kind}:${namespace||''}:${name}`;
 const kube={get:async(kind:string,namespace:string|null,name:string)=>objects.get(key(kind,namespace,name))||null,create:async(object:KubernetesObject)=>{const meta=object.metadata as {name:string;namespace?:string};const id=key(String(object.kind),meta.namespace||null,meta.name);if(objects.has(id))return false;objects.set(id,structuredClone(object));created.push(id);return true}};
 const bootstrap=new NamespaceBootstrap(kube,{controlNamespace:'control',brokerServiceAccount:'broker',brokerRole:'desktop-role'}),owner={tenantId:randomUUID(),userId:randomUUID()},signal=new AbortController().signal;
 const namespace=await bootstrap.ensure(owner,signal);assert.match(namespace,/^grok-user-[a-f0-9]{32}$/);assert.equal(created.length,2);
 assert.equal(await bootstrap.ensure(owner,signal),namespace);assert.equal(created.length,2);
 const binding=objects.get(key('RoleBinding',namespace,'desktop-provisioner'))!;binding.roleRef={apiGroup:'rbac.authorization.k8s.io',kind:'ClusterRole',name:'cluster-admin'};
 await assert.rejects(bootstrap.ensure(owner,signal),/does not match/);assert.equal(created.length,2);
 binding.roleRef={apiGroup:'rbac.authorization.k8s.io',kind:'ClusterRole',name:'desktop-role'};
 const namespaceObject=objects.get(key('Namespace',null,namespace))!,metadata=namespaceObject.metadata as {annotations?:Record<string,string>};metadata.annotations={'unexpected':'value'};
 await assert.rejects(bootstrap.ensure(owner,signal),/does not match/);delete metadata.annotations;
 const abort=new AbortController();abort.abort();await assert.rejects(bootstrap.ensure(owner,abort.signal),/cancelled/);
 assert.throws(()=>namespaceBootstrapResources({controlNamespace:'bad"principal',bootstrapServiceAccount:'bootstrap',brokerServiceAccount:'broker',bootstrapRole:'bootstrap-role',brokerRole:'desktop-role',policyPrefix:'policy'}));
 assert.throws(()=>namespaceBootstrapResources({controlNamespace:'control',bootstrapServiceAccount:'same',brokerServiceAccount:'same',bootstrapRole:'bootstrap-role',brokerRole:'desktop-role',policyPrefix:'policy'}));
});
