import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import type {AddressInfo} from 'node:net';
import {DesktopKubernetesClient} from '../src/server/desktop-kubernetes.ts';
import {DesktopProvisioner} from '../src/server/desktop-provisioner.ts';
import {DesktopBrokerClient} from '../src/server/desktop-broker-client.ts';
import {createDesktopProvisioningBroker} from '../src/server/desktop-provisioning-broker.ts';
import {NamespaceBootstrapClient} from '../src/server/namespace-bootstrap-client.ts';
import {desktopIdentity} from '../src/server/desktop-resources.ts';

const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value};
const owner={tenantId:required('TEST_TENANT_ID'),userId:required('TEST_USER_ID')},signingKey=await readFile('/run/test-secret/signing-key'),identity=desktopIdentity(owner,signingKey);
const kube=new DesktopKubernetesClient('https://kubernetes.default.svc',await readFile('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'),async()=>(await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token','utf8')).trim());
const signal=AbortSignal.timeout(210_000),bootstrap=new NamespaceBootstrapClient(required('TEST_BOOTSTRAP_URL'),await readFile('/run/test-secret/bootstrap-cert.pem'),(await readFile('/run/test-secret/bootstrap-token','utf8')).trim());
const brokerCert=await readFile('/run/test-secret/broker-cert.pem'),brokerKey=await readFile('/run/test-secret/broker-key.pem'),brokerToken=(await readFile('/run/test-secret/broker-token','utf8')).trim();
const provisioner=new DesktopProvisioner(kube,signingKey,{image:required('TEST_DESKTOP_IMAGE'),controlNamespace:required('TEST_CONTROL_NAMESPACE'),gatewayCA:brokerCert.toString('utf8'),split:true,bootstrap});
const server=createDesktopProvisioningBroker({cert:brokerCert,key:brokerKey},brokerToken,provisioner);server.listen(0,'127.0.0.1');await once(server,'listening');
try{
 await assert.rejects(kube.get('Namespace',null,identity.namespace,signal),/HTTP 403/);
 await assert.rejects(kube.get('Secret','coke-grok-bot','not-a-real-secret',signal),/HTTP 403/);
 const client=new DesktopBrokerClient(`https://127.0.0.1:${(server.address() as AddressInfo).port}/`,brokerCert,brokerToken),first=await client.connect(owner,signal),second=await client.connect(owner,signal);
 assert.equal(first.agentUrl.hostname,`agent.${identity.namespace}.svc.cluster.local`);assert.equal(first.agentToken,second.agentToken);
 await assert.rejects(kube.get('Secret','coke-grok-bot','not-a-real-secret',signal),/HTTP 403/);
 console.log('Dynamic provisioning K3D test passed: separate service accounts, TLS namespace bootstrap, personal desktop creation and repeated access.');
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
