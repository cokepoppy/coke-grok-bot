import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { desktopIdentity, desktopResources } from '../src/server/desktop-resources.ts';

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
 assert.equal(JSON.stringify(resources).includes('COKE_GROK_MODEL_KEY'),false);
 assert.throws(()=>desktopResources(identity,{image:'coke-grok-desktop:latest',controlNamespace:'coke-grok-bot',gatewayCA:'BEGIN CERTIFICATE'}));
});
