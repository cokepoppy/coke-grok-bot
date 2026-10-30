import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { desktopIdentity, desktopResources, splitDesktopResources } from '../src/server/desktop-resources.ts';

test('desktop identities separate users and tenants and resources do not expose the provider key', () => {
 const signingKey=randomBytes(32), tenantId=randomUUID(), userId=randomUUID();
 const identity=desktopIdentity({tenantId,userId},signingKey);
 assert.deepEqual(desktopIdentity({tenantId,userId},signingKey),identity);
 assert.notEqual(desktopIdentity({tenantId,userId:randomUUID()},signingKey).namespace,identity.namespace);
 assert.notEqual(desktopIdentity({tenantId:randomUUID(),userId},signingKey).namespace,identity.namespace);
 assert.notEqual(identity.workerToken,identity.agentToken);
 assert.throws(()=>desktopIdentity({tenantId,userId},randomBytes(8)));
 const resources=desktopResources(identity,{image:`coke-grok-desktop:sha-${'a'.repeat(40)}`,controlNamespace:'coke-grok-bot',gatewayCA:'-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----'});
 const deployment=resources.find(item=>item.kind==='Deployment') as any;
 const pod=deployment.spec.template.spec;
 assert.equal(pod.automountServiceAccountToken,false);
 assert.equal(pod.containers[0].securityContext.runAsUser,1000);
 assert.equal(pod.containers[1].securityContext.runAsUser,1001);
 assert.equal(pod.containers[1].securityContext.readOnlyRootFilesystem,true);
 assert.deepEqual(pod.containers[1].env.find((entry:any)=>entry.name==='DOTS_DESKTOP_AGENT_ADAPTERS').value.split(','),['pi','dsh']);
 assert.deepEqual(Object.keys(JSON.parse(pod.containers[1].env.find((entry:any)=>entry.name==='DOTS_AGENT_KERNELS_JSON').value)).sort(),['dsh','pi']);
 assert.equal(JSON.stringify(resources).includes('COKE_GROK_MODEL_KEY'),false);
 assert.throws(()=>desktopResources(identity,{image:'coke-grok-desktop:latest',controlNamespace:'coke-grok-bot',gatewayCA:'BEGIN CERTIFICATE'}));
});
test('experimental layout separates the Agent network from the desktop',()=>{
 const identity=desktopIdentity({tenantId:randomUUID(),userId:randomUUID()},randomBytes(32));
 const resources=splitDesktopResources(identity,{image:`coke-grok-desktop:sha-${'a'.repeat(40)}`,controlNamespace:'coke-grok-bot',gatewayCA:'-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----'});
 const desktop=resources.find(item=>item.kind==='Deployment'&&(item.metadata as {name:string}).name==='desktop') as any;
 const agent=resources.find(item=>item.kind==='Deployment'&&(item.metadata as {name:string}).name==='agent') as any;
 assert.deepEqual(desktop.spec.template.spec.containers.map((c:any)=>c.name),['desktop']);
 assert.deepEqual(agent.spec.template.spec.containers.map((c:any)=>c.name),['agent']);
 assert.equal(desktop.spec.template.spec.containers[0].securityContext.runAsUser,1000);
 assert.equal(agent.spec.template.spec.containers[0].securityContext.runAsUser,1001);
 assert.equal(agent.spec.template.spec.automountServiceAccountToken,false);
 const policy=resources.find(item=>item.kind==='NetworkPolicy'&&(item.metadata as {name:string}).name==='agent-isolation') as any;
 assert.equal(JSON.stringify(policy.spec.egress).includes('grok-desktop'),false);
 assert.equal((resources.find(item=>item.kind==='Service'&&(item.metadata as {name:string}).name==='desktop') as any).spec.ports.some((p:any)=>p.port===8083),false);
});
