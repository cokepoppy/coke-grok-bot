import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import type {AddressInfo} from 'node:net';
import {DesktopKubernetesClient} from '../src/server/desktop-kubernetes.ts';
import {DesktopProvisioner} from '../src/server/desktop-provisioner.ts';
import {DesktopBrokerClient} from '../src/server/desktop-broker-client.ts';
import {createDesktopProvisioningBroker} from '../src/server/desktop-provisioning-broker.ts';
import {desktopIdentity} from '../src/server/desktop-resources.ts';

const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value};
const owner={tenantId:required('TEST_TENANT_ID'),userId:required('TEST_USER_ID')},signingKey=await readFile('/run/test-secret/signing-key'),token=(await readFile('/run/test-secret/broker-token','utf8')).trim();
const ca=await readFile('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'),accountToken=()=>readFile('/var/run/secrets/kubernetes.io/serviceaccount/token','utf8');
const kube=new DesktopKubernetesClient('https://kubernetes.default.svc',ca,async()=>(await accountToken()).trim()),identity=desktopIdentity(owner,signingKey),signal=AbortSignal.timeout(210_000);
const cert=await readFile('/run/test-secret/cert.pem'),key=await readFile('/run/test-secret/key.pem');
const provisioner=new DesktopProvisioner(kube,signingKey,{image:required('TEST_DESKTOP_IMAGE'),controlNamespace:required('TEST_CONTROL_NAMESPACE'),gatewayCA:cert.toString('utf8'),split:true});
const server=createDesktopProvisioningBroker({cert,key},token,provisioner);server.listen(0,'127.0.0.1');await once(server,'listening');
try{
 const client=new DesktopBrokerClient(`https://127.0.0.1:${(server.address() as AddressInfo).port}/`,cert,token),first=await client.connect(owner,signal),second=await client.connect(owner,signal);
 assert.equal(first.agentUrl.hostname,`agent.${identity.namespace}.svc.cluster.local`);assert.equal(first.agentUrl.href,second.agentUrl.href);assert.equal(first.agentToken,second.agentToken);
 await assert.rejects(kube.get('Secret','coke-grok-bot','not-a-real-secret',signal),/HTTP 403/);
 await assert.rejects(kube.get('Namespace',null,'coke-grok-bot',signal),/HTTP 403/);
 await assert.rejects(kube.create({apiVersion:'v1',kind:'ConfigMap',metadata:{name:'denied-test',namespace:'coke-grok-bot'},data:{}},signal),/HTTP 403/);
 console.log('Scoped broker K3D test passed: own desktop creation and idempotent access; other namespace reads and writes denied.');
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
