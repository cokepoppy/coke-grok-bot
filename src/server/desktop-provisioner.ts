import { desktopIdentity, desktopResources, splitDesktopResources } from './desktop-resources.ts';
import type { DesktopConnection, DesktopConnections } from './pi-executor.ts';
import type { RunOwner } from './run-store.ts';
import type {NamespaceBootstrapConnection} from './namespace-bootstrap-service.ts';

export type KubernetesObject = Record<string, unknown>;
export interface DesktopKubernetes {
  get(kind:string,namespace:string|null,name:string,signal:AbortSignal):Promise<KubernetesObject|null>;
  /** Returns false on an already-existing object; must not replace it. */
  create(object:KubernetesObject,signal:AbortSignal):Promise<boolean>;
  waitForReady(namespace:string,name:string,signal:AbortSignal):Promise<void>;
}

/** Create only this user's resources; refuse drift rather than overwrite state or data. */
export class DesktopProvisioner implements DesktopConnections {
  constructor(private readonly kube:DesktopKubernetes,private readonly signingKey:Buffer,private readonly options:{image:string;controlNamespace:string;gatewayCA:string;split?:boolean;bootstrap?:NamespaceBootstrapConnection}) {}
  async connect(owner:RunOwner,signal:AbortSignal):Promise<DesktopConnection> {
    if(signal.aborted) throw new Error('Desktop provisioning cancelled');
    const identity=desktopIdentity(owner,this.signingKey);
    if(this.options.bootstrap && await this.options.bootstrap.ensure(owner,signal)!==identity.namespace)throw new Error('Namespace bootstrap returned the wrong owner');
    const resources=this.options.split ? splitDesktopResources(identity,this.options) : desktopResources(identity,this.options);
    for(const expected of resources) {
      if(signal.aborted) throw new Error('Desktop provisioning cancelled');
      const kind=String(expected.kind), metadata=expected.metadata as {name:string;namespace?:string};
      if(kind==='Namespace' && this.options.bootstrap)continue;
      const namespace=kind==='Namespace'?null:metadata.namespace || null;
      let actual=await this.kube.get(kind,namespace,metadata.name,signal);
      if(!actual) {
        await this.kube.create(expected,signal);
        actual=await this.kube.get(kind,namespace,metadata.name,signal);
      }
      if(!actual || !matchesExpectedResource(expected,actual)) throw new Error(`Desktop resource ${kind} does not match its expected ownership or configuration`);
    }
    if(this.options.split)await this.kube.waitForReady(identity.namespace,'agent',signal);
    await this.kube.waitForReady(identity.namespace,'desktop',signal);
    return {agentUrl:new URL(`http://${this.options.split?'agent':'desktop'}.${identity.namespace}.svc.cluster.local:8083/`),agentToken:identity.agentToken};
  }
}

/** Compare requested fields, allowing only server-added fields; never compare generated metadata. */
export function matchesExpectedResource(expected:KubernetesObject,actual:KubernetesObject):boolean {
  if(expected.kind!==actual.kind || expected.apiVersion!==actual.apiVersion) return false;
  const wanted=expected.metadata as Record<string,unknown>,found=actual.metadata as Record<string,unknown>;
  if(!wanted || !found || wanted.name!==found.name || (wanted.namespace && wanted.namespace!==found.namespace) || !isSubset(wanted.labels,found.labels)) return false;
  if(expected.kind==='Secret') {
    const values=expected.stringData as Record<string,string>,data=actual.data as Record<string,string>;
    return expected.type===actual.type && Boolean(values&&data) && Object.entries(values).every(([key,value])=>typeof data[key]==='string'&&data[key]===Buffer.from(value).toString('base64'));
  }
  if(expected.kind==='ConfigMap' && !isSubset(expected.data,actual.data)) return false;
  if(expected.kind==='RoleBinding') return isSubset(expected.roleRef,actual.roleRef) && isSubset(expected.subjects,actual.subjects);
  return expected.spec===undefined || isSubset(expected.spec,actual.spec);
}
function isSubset(expected:unknown,actual:unknown):boolean {
  if(Array.isArray(expected)) return Array.isArray(actual) && expected.length===actual.length && expected.every((value,index)=>isSubset(value,actual[index]));
  if(expected && typeof expected==='object') {
    if(!actual || typeof actual!=='object' || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key,value])=>isSubset(value,(actual as Record<string,unknown>)[key]));
  }
  return expected===actual;
}
