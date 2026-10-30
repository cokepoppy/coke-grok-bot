import {readFile,stat} from 'node:fs/promises';
import {X509Certificate,createPrivateKey} from 'node:crypto';
import {DesktopKubernetesClient} from './desktop-kubernetes.ts';
import {NamespaceBootstrap} from './namespace-bootstrap.ts';
import {createNamespaceBootstrapService} from './namespace-bootstrap-service.ts';
import {NamespaceAdmissionPreflight} from './namespace-admission-preflight.ts';

function required(name:string):string{const value=process.env[name]?.trim();if(!value)throw new Error(`Missing ${name}`);return value}
async function privateFile(name:string):Promise<Buffer>{const path=required(name),metadata=await stat(path);if(!metadata.isFile()||(metadata.mode&0o077)!==0)throw new Error('Private bootstrap file required');const value=await readFile(path);if(!value.length||value.length>16384)throw new Error('Invalid bootstrap file');return value}
async function main(){
 // Kubernetes admission policy propagation and startup verification are not yet production-validated.
 if(process.env.NODE_ENV==='production')throw new Error('Namespace bootstrap is not ready for production');
 const namespace=required('COKE_GROK_CONTROL_NAMESPACE'),cert=await readFile(required('COKE_GROK_BOOTSTRAP_TLS_CERT_FILE')),key=await privateFile('COKE_GROK_BOOTSTRAP_TLS_KEY_FILE'),certificate=new X509Certificate(cert);
 const host=`coke-grok-namespace-bootstrap.${namespace}.svc.cluster.local`;
 if(!certificate.checkHost(host)||!certificate.checkPrivateKey(createPrivateKey(key))||Date.parse(certificate.validFrom)>Date.now()||Date.parse(certificate.validTo)<=Date.now())throw new Error('Invalid bootstrap certificate');
 const token=(await privateFile('COKE_GROK_BOOTSTRAP_TOKEN_FILE')).toString('utf8').trim(),ca=await readFile(required('COKE_GROK_KUBE_CA_FILE')),tokenFile=required('COKE_GROK_KUBE_TOKEN_FILE');
 const kube=new DesktopKubernetesClient(required('COKE_GROK_KUBE_URL'),ca,async()=>(await readFile(tokenFile,'utf8')).trim());
 const options={controlNamespace:namespace,bootstrapServiceAccount:required('COKE_GROK_BOOTSTRAP_SERVICE_ACCOUNT'),brokerServiceAccount:required('COKE_GROK_BROKER_SERVICE_ACCOUNT'),bootstrapRole:required('COKE_GROK_BOOTSTRAP_ROLE'),brokerRole:required('COKE_GROK_BROKER_ROLE'),policyPrefix:required('COKE_GROK_BOOTSTRAP_POLICY_PREFIX')};
 const preflight=new NamespaceAdmissionPreflight(kube,options);await preflight.verify(AbortSignal.timeout(30_000));
 const bootstrap=new NamespaceBootstrap(kube,{...options,verifyAdmission:signal=>preflight.verify(signal)});
 const server=createNamespaceBootstrapService({key,cert},token,bootstrap);server.listen(3004,'0.0.0.0',()=>console.log('Namespace bootstrap service listening on port 3004'));
 for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>server.close());
}
main().catch(()=>{console.error('Namespace bootstrap failed to start; check private configuration and cluster access.');process.exitCode=1});
