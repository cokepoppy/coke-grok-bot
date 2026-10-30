import {readFile} from 'node:fs/promises';
import {DesktopKubernetesClient} from '../src/server/desktop-kubernetes.ts';
import {NamespaceBootstrap} from '../src/server/namespace-bootstrap.ts';
import {createNamespaceBootstrapService} from '../src/server/namespace-bootstrap-service.ts';
import {NamespaceAdmissionPreflight} from '../src/server/namespace-admission-preflight.ts';

const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value};
const kube=new DesktopKubernetesClient('https://kubernetes.default.svc',await readFile('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'),async()=>(await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token','utf8')).trim());
const options={controlNamespace:required('TEST_CONTROL_NAMESPACE'),bootstrapServiceAccount:'bootstrap',brokerServiceAccount:'broker',bootstrapRole:required('TEST_BOOTSTRAP_ROLE'),brokerRole:required('TEST_BROKER_ROLE'),policyPrefix:required('TEST_POLICY_PREFIX')};
const preflight=new NamespaceAdmissionPreflight(kube,options);await preflight.verify(AbortSignal.timeout(30_000));
const bootstrap=new NamespaceBootstrap(kube,{...options,verifyAdmission:signal=>preflight.verify(signal)});
const server=createNamespaceBootstrapService({cert:await readFile('/run/test-secret/cert.pem'),key:await readFile('/run/test-secret/key.pem')},(await readFile('/run/test-secret/token','utf8')).trim(),bootstrap);
server.listen(3004,'0.0.0.0');
