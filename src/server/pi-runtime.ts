import { readFile,stat } from 'node:fs/promises';
import { once } from 'node:events';
import { X509Certificate,createPrivateKey } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { ModelGateway } from './model-gateway.ts';
import { RunStore } from './run-store.ts';
import { RunScheduler } from './run-scheduler.ts';
import { PiExecutor } from './pi-executor.ts';
import { DesktopProvisioner } from './desktop-provisioner.ts';
import { DesktopKubernetesClient } from './desktop-kubernetes.ts';

function required(env:NodeJS.ProcessEnv,key:string):string { const value=env[key]?.trim();if(!value)throw new Error(`Missing ${key}`);return value; }
async function privateFile(path:string):Promise<Buffer>{
 const metadata=await stat(path);if(!metadata.isFile()||(metadata.mode&0o077)!==0)throw new Error('Runtime secret file permissions are not private');
 const value=await readFile(path);if(!value.length||value.length>16384)throw new Error('Invalid runtime secret file');return value;
}
export interface PiRuntime { runs:RunStore; close():Promise<void> }
/** Opt-in only. Caller supplies Kubernetes service account with separately audited permissions. */
export async function startPiRuntime(pool:Pool,env:NodeJS.ProcessEnv=process.env):Promise<PiRuntime|null>{
 if(env.COKE_GROK_PI_ENABLED!=='1')return null;
 // The copied desktop tools do not yet enforce external-action approval, and
 // the provisioner does not yet have a namespace-scoped production broker.
 // Refuse production startup until those boundaries are implemented and tested.
 if(env.NODE_ENV==='production')throw new Error('Pi runtime is not ready for production');
 const providerKey=(await privateFile(required(env,'COKE_GROK_MODEL_KEY_FILE'))).toString('utf8').trim();
 const signingKey=await privateFile(required(env,'COKE_GROK_DESKTOP_SIGNING_KEY_FILE'));
 const tlsKey=await privateFile(required(env,'COKE_GROK_GATEWAY_TLS_KEY_FILE'));
 const cert=await readFile(required(env,'COKE_GROK_GATEWAY_TLS_CERT_FILE'));
 const kubeCa=await readFile(required(env,'COKE_GROK_KUBE_CA_FILE'));
 // Projected service-account tokens are controlled by Kubernetes file permissions.
 const kubeTokenFile=required(env,'COKE_GROK_KUBE_TOKEN_FILE');
 const namespace=required(env,'COKE_GROK_CONTROL_NAMESPACE');
 const gatewayHost=`coke-grok-model.${namespace}.svc.cluster.local`;
 const certificate=new X509Certificate(cert);
 if(!certificate.checkHost(gatewayHost) || !certificate.checkPrivateKey(createPrivateKey(tlsKey)) || Date.parse(certificate.validFrom)>Date.now() || Date.parse(certificate.validTo)<=Date.now())throw new Error('Gateway TLS certificate is invalid for its service');
 const gatewayUrl=`https://${gatewayHost}:3002/v1`;
 const gateway=new ModelGateway(providerKey,required(env,'COKE_GROK_MODEL_BASE_URL'),required(env,'COKE_GROK_MODEL_ID'));
 const kube=new DesktopKubernetesClient(required(env,'COKE_GROK_KUBE_URL'),kubeCa,async()=>(await readFile(kubeTokenFile,'utf8')).trim());
 const provisioner=new DesktopProvisioner(kube,signingKey,{image:required(env,'COKE_GROK_DESKTOP_IMAGE'),controlNamespace:namespace,gatewayCA:cert.toString('utf8')});
 const runs=new RunStore(pool);await runs.migrate();
 const scheduler=new RunScheduler(runs,new PiExecutor(provisioner,gateway,gatewayUrl,required(env,'COKE_GROK_MODEL_ID')),{concurrency:2,leaseSeconds:30});
 const server=gateway.createServer({key:tlsKey,cert});
 try{server.listen(3002,'0.0.0.0');await once(server,'listening')}catch(error){gateway.close();server.close();throw error}
 const timer=setInterval(()=>{void scheduler.tick().catch(()=>console.error('Pi scheduler polling failed.'))},2000);timer.unref();
 return {runs,async close(){clearInterval(timer);await scheduler.stop();gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}
