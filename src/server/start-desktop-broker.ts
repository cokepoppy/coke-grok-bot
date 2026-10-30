import {readFile,stat} from 'node:fs/promises';
import {X509Certificate,createPrivateKey} from 'node:crypto';
import {DesktopKubernetesClient} from './desktop-kubernetes.ts';
import {DesktopProvisioner} from './desktop-provisioner.ts';
import {createDesktopProvisioningBroker} from './desktop-provisioning-broker.ts';
import {NamespaceBootstrapClient} from './namespace-bootstrap-client.ts';

function required(name:string):string {const value=process.env[name]?.trim();if(!value)throw new Error(`Missing ${name}`);return value}
async function privateFile(name:string):Promise<Buffer>{
 const path=required(name),metadata=await stat(path);if(!metadata.isFile()||(metadata.mode&0o077)!==0)throw new Error('Private broker file required');
 const value=await readFile(path);if(!value.length||value.length>16384)throw new Error('Invalid broker file');return value;
}
async function main(){
 const namespace=required('COKE_GROK_CONTROL_NAMESPACE');
 const cert=await readFile(required('COKE_GROK_BROKER_TLS_CERT_FILE')),key=await privateFile('COKE_GROK_BROKER_TLS_KEY_FILE'),certificate=new X509Certificate(cert);
 const host=`coke-grok-desktop-broker.${namespace}.svc.cluster.local`;
 if(!certificate.checkHost(host)||!certificate.checkPrivateKey(createPrivateKey(key))||Date.parse(certificate.validFrom)>Date.now()||Date.parse(certificate.validTo)<=Date.now())throw new Error('Invalid broker certificate');
 const capability=(await privateFile('COKE_GROK_BROKER_TOKEN_FILE')).toString('utf8').trim(),signingKey=await privateFile('COKE_GROK_DESKTOP_SIGNING_KEY_FILE');
 const ca=await readFile(required('COKE_GROK_KUBE_CA_FILE')),tokenFile=required('COKE_GROK_KUBE_TOKEN_FILE');
 const kube=new DesktopKubernetesClient(required('COKE_GROK_KUBE_URL'),ca,async()=>(await readFile(tokenFile,'utf8')).trim());
 const bootstrapToken=(await privateFile('COKE_GROK_BOOTSTRAP_TOKEN_FILE')).toString('utf8').trim();if(bootstrapToken===capability)throw new Error('Broker and bootstrap capabilities must differ');
 const bootstrap=new NamespaceBootstrapClient(`https://coke-grok-namespace-bootstrap.${namespace}.svc.cluster.local:3004/`,await readFile(required('COKE_GROK_BOOTSTRAP_CA_FILE')),bootstrapToken);
 const provisioner=new DesktopProvisioner(kube,signingKey,{image:required('COKE_GROK_DESKTOP_IMAGE'),controlNamespace:namespace,gatewayCA:await readFile(required('COKE_GROK_GATEWAY_TLS_CERT_FILE'),'utf8'),split:true,bootstrap});
 const server=createDesktopProvisioningBroker({key,cert},capability,provisioner);server.listen(3003,'0.0.0.0',()=>console.log('Desktop provisioning broker listening on port 3003'));
 for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>server.close());
}
main().catch(()=>{console.error('Desktop provisioning broker failed to start; check private configuration and cluster access.');process.exitCode=1});
