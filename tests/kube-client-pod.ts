import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { DesktopKubernetesClient } from '../src/server/desktop-kubernetes.ts';
async function main(){
 const namespace=process.env.TEST_NAMESPACE||'';
 if(!/^grok-kube-test-[a-f0-9]{12}$/.test(namespace))throw new Error('Invalid test namespace');
 const root='/var/run/secrets/kubernetes.io/serviceaccount';
 const ca=await readFile(`${root}/ca.crt`);
 const client=new DesktopKubernetesClient(`https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}/`,ca,async()=>(await readFile(`${root}/token`,'utf8')).trim());
 const signal=AbortSignal.timeout(15000);
 const object=await client.get('ConfigMap',namespace,'fixture',signal);assert.equal(object?.kind,'ConfigMap');
 await assert.rejects(client.get('Secret',namespace,'forbidden',signal));
 await assert.rejects(client.get('ConfigMap','coke-grok-bot','auth-config',signal));
 console.log('Scoped in-cluster Kubernetes client passed: permitted own ConfigMap, denied Secrets and other namespace.');
}
main().catch(()=>{console.error('Scoped in-cluster Kubernetes client failed.');process.exitCode=1});
