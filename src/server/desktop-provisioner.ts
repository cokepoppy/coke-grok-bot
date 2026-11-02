import { desktopIdentity, desktopResources, splitDesktopResources } from './desktop-resources.ts';
import type { DesktopConnection, DesktopConnections } from './pi-executor.ts';
import type { RunOwner } from './run-store.ts';
import type {NamespaceBootstrapConnection} from './namespace-bootstrap-service.ts';
import {SafeDiagnosticError} from './safe-diagnostics.ts';

export type KubernetesObject = Record<string, unknown>;
export interface DesktopKubernetes {
  get(kind:string,namespace:string|null,name:string,signal:AbortSignal):Promise<KubernetesObject|null>;
  /** Returns false on an already-existing object; must not replace it. */
  create(object:KubernetesObject,signal:AbortSignal):Promise<boolean>;
  waitForReady(namespace:string,name:string,signal:AbortSignal):Promise<void>;
}

/** Create only this user's resources; refuse drift rather than overwrite state or data. */
export class DesktopProvisioner implements DesktopConnections {
  constructor(private readonly kube:DesktopKubernetes,private readonly signingKey:Buffer,private readonly options:{image:string;agentImage?:string;controlNamespace:string;gatewayCA:string;split?:boolean;bootstrap?:NamespaceBootstrapConnection}) {}
  async connect(owner:RunOwner,signal:AbortSignal):Promise<DesktopConnection> {
    if(signal.aborted) throw new Error('Desktop provisioning cancelled');
    const identity=desktopIdentity(owner,this.signingKey);
    if(this.options.bootstrap) {
      let namespace:string;
      try { namespace=await this.options.bootstrap.ensure(owner,signal); }
      catch(error) { if(error instanceof SafeDiagnosticError)throw error;throw new SafeDiagnosticError('NAMESPACE_BOOTSTRAP_FAILED'); }
      if(namespace!==identity.namespace)throw new SafeDiagnosticError('OWNER_BINDING_MISMATCH');
    }
    const resources=this.options.split ? splitDesktopResources(identity,this.options) : desktopResources(identity,this.options);
    for(const expected of resources) {
      if(signal.aborted) throw new Error('Desktop provisioning cancelled');
      const kind=String(expected.kind), metadata=expected.metadata as {name:string;namespace?:string};
      if(kind==='Namespace' && this.options.bootstrap)continue;
      const namespace=kind==='Namespace'?null:metadata.namespace || null;
      let actual:KubernetesObject|null;
      try { actual=await this.kube.get(kind,namespace,metadata.name,signal); }
      catch { throw new SafeDiagnosticError('KUBERNETES_READ_FAILED'); }
      if(!actual) {
        try { await this.kube.create(expected,signal); }
        catch { throw new SafeDiagnosticError('KUBERNETES_CREATE_FAILED'); }
        try { actual=await this.kube.get(kind,namespace,metadata.name,signal); }
        catch { throw new SafeDiagnosticError('KUBERNETES_READ_FAILED'); }
      }
      if(!actual)throw new SafeDiagnosticError('RESOURCE_MISSING');
      if(!matchesExpectedResource(expected,actual))throw new SafeDiagnosticError('RESOURCE_MISMATCH');
    }
    try {
      if(this.options.split)await this.kube.waitForReady(identity.namespace,'agent',signal);
      await this.kube.waitForReady(identity.namespace,'desktop',signal);
    } catch { throw new SafeDiagnosticError('DESKTOP_NOT_READY'); }
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
  if(expected.spec===undefined)return true;
  if(expected.kind==='Deployment')return matchesDeploymentSpec(expected.spec,actual.spec);
  return isSubset(expected.spec,actual.spec);
}
/** The desktop runtime defaults to eight windows; treat an omitted default as equivalent during migration. */
function matchesDeploymentSpec(expected:unknown,actual:unknown):boolean {
  if(!expected||typeof expected!=='object'||Array.isArray(expected)||!actual||typeof actual!=='object'||Array.isArray(actual))return false;
  const wanted=structuredClone(expected) as Record<string,any>,found=actual as Record<string,any>;
  const expectedContainers=wanted.template?.spec?.containers,actualContainers=found.template?.spec?.containers;
  if(Array.isArray(expectedContainers)&&Array.isArray(actualContainers))for(const container of expectedContainers){
    if(container?.name!=='desktop'||!Array.isArray(container.env))continue;
    const deployed=actualContainers.find((item:any)=>item?.name==='desktop');
    if(!Array.isArray(deployed?.env))continue;
    const expectedSlots=container.env.find((item:any)=>item?.name==='COKE_DESKTOP_SCREEN_SLOTS'&&item?.value==='8');
    const deployedSlots=deployed.env.some((item:any)=>item?.name==='COKE_DESKTOP_SCREEN_SLOTS');
    if(expectedSlots&&!deployedSlots)container.env=container.env.filter((item:any)=>item!==expectedSlots);
  }
  return isSubset(wanted,found);
}
function isSubset(expected:unknown,actual:unknown):boolean {
  if(Array.isArray(expected)) return Array.isArray(actual) && expected.length===actual.length && expected.every((value,index)=>isSubset(value,actual[index]));
  if(expected && typeof expected==='object') {
    if(!actual || typeof actual!=='object' || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key,value])=>isSubset(value,(actual as Record<string,unknown>)[key]));
  }
  return expected===actual;
}
