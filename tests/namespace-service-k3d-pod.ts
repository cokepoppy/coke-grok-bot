import {readFile} from 'node:fs/promises';
import {DesktopKubernetesClient} from '../src/server/desktop-kubernetes.ts';
import {NamespaceBootstrap} from '../src/server/namespace-bootstrap.ts';
import {createNamespaceBootstrapService} from '../src/server/namespace-bootstrap-service.ts';

const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value};
const kube=new DesktopKubernetesClient('https://kubernetes.default.svc',await readFile('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'),async()=>(await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token','utf8')).trim());
const bootstrap=new NamespaceBootstrap(kube,{controlNamespace:required('TEST_CONTROL_NAMESPACE'),brokerServiceAccount:'broker',brokerRole:required('TEST_BROKER_ROLE')});
const server=createNamespaceBootstrapService({cert:await readFile('/run/test-secret/cert.pem'),key:await readFile('/run/test-secret/key.pem')},(await readFile('/run/test-secret/token','utf8')).trim(),bootstrap);
server.listen(3004,'0.0.0.0');
