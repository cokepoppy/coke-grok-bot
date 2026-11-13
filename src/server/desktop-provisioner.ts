import { desktopIdentity, desktopResources, isValidDesktopImageRef, splitDesktopResources,type DesktopProxyOptions } from './desktop-resources.ts';
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
  constructor(private readonly kube:DesktopKubernetes,private readonly signingKey:Buffer,private readonly options:{image:string;agentImage?:string;controlNamespace:string;gatewayCA:string;split?:boolean;bootstrap?:NamespaceBootstrapConnection}&DesktopProxyOptions) {}
  async connect(owner:RunOwner,signal:AbortSignal):Promise<DesktopConnection> {
    if(signal.aborted) throw new Error('Desktop provisioning cancelled');
    const identity=desktopIdentity(owner,this.signingKey);
    if(this.options.bootstrap) {
      let namespace:string;
      try { namespace=await this.options.bootstrap.ensure(owner,signal); }
      catch(error) { if(error instanceof SafeDiagnosticError)throw error;throw new SafeDiagnosticError('NAMESPACE_BOOTSTRAP_FAILED'); }
      if(namespace!==identity.namespace)throw new SafeDiagnosticError('OWNER_BINDING_MISMATCH');
    }
    const pins=await this.resolveImagePins(identity,signal);
    const resources=this.options.split
      ? splitDesktopResources(identity,{...this.options,image:pins.desktopImage,agentImage:pins.agentImage})
      : desktopResources(identity,{...this.options,image:pins.desktopImage});
    const checked:Array<{expected:KubernetesObject;actual:KubernetesObject|null;namespace:string|null;name:string;kind:string}>=[];
    // Validate every existing resource before creating anything. This matters when
    // adopting an older owner namespace: a bad deployment must not get a new pin.
    for(const expected of resources) {
      if(signal.aborted) throw new Error('Desktop provisioning cancelled');
      const kind=String(expected.kind), metadata=expected.metadata as {name:string;namespace?:string};
      if(kind==='Namespace' && this.options.bootstrap)continue;
      const namespace=kind==='Namespace'?null:metadata.namespace || null;
      let actual:KubernetesObject|null;
      try { actual=await this.kube.get(kind,namespace,metadata.name,signal); }
      catch { throw new SafeDiagnosticError('KUBERNETES_READ_FAILED'); }
      if(actual&&!matchesExpectedResource(expected,actual)){
        logResourceMismatch('existing',expected,actual);
        throw new SafeDiagnosticError('RESOURCE_MISMATCH');
      }
      checked.push({expected,actual,namespace,name:metadata.name,kind});
    }
    for(const entry of checked) {
      if(signal.aborted) throw new Error('Desktop provisioning cancelled');
      const {expected,namespace,name,kind}=entry;
      let actual=entry.actual;
      if(!actual) {
        try { await this.kube.create(expected,signal); }
        catch { throw new SafeDiagnosticError('KUBERNETES_CREATE_FAILED'); }
        try { actual=await this.kube.get(kind,namespace,name,signal); }
        catch { throw new SafeDiagnosticError('KUBERNETES_READ_FAILED'); }
      }
      if(!actual)throw new SafeDiagnosticError('RESOURCE_MISSING');
      if(!matchesExpectedResource(expected,actual)){
        logResourceMismatch('verified',expected,actual);
        throw new SafeDiagnosticError('RESOURCE_MISMATCH');
      }
    }
    try {
      if(this.options.split)await this.kube.waitForReady(identity.namespace,'agent',signal);
      await this.kube.waitForReady(identity.namespace,'desktop',signal);
    } catch { throw new SafeDiagnosticError('DESKTOP_NOT_READY'); }
    return {agentUrl:new URL(`http://${this.options.split?'agent':'desktop'}.${identity.namespace}.svc.cluster.local:8083/`),agentToken:identity.agentToken};
  }
  private async resolveImagePins(identity:ReturnType<typeof desktopIdentity>,signal:AbortSignal):Promise<{desktopImage:string;agentImage:string}> {
    const pinName='desktop-image-pin';
    let pin:KubernetesObject|null;
    try{pin=await this.kube.get('ConfigMap',identity.namespace,pinName,signal)}catch{throw new SafeDiagnosticError('KUBERNETES_READ_FAILED')}
    if(pin)return parseImagePins(pin,identity.namespace,identity.ownerHash);

    const read=async(name:string):Promise<KubernetesObject|null>=>{
      try{return await this.kube.get('Deployment',identity.namespace,name,signal)}catch{throw new SafeDiagnosticError('KUBERNETES_READ_FAILED')}
    };
    const desktop=await read('desktop');
    const agent=this.options.split?await read('agent'):desktop;
    let desktopImage=this.options.image,agentImage=this.options.split?(this.options.agentImage??this.options.image):this.options.image;
    if(desktop)desktopImage=deploymentContainerImage(desktop,identity.namespace,'desktop','desktop');
    if(!this.options.split&&desktop){
      agentImage=deploymentContainerImage(desktop,identity.namespace,'desktop','agent');
      if(agentImage!==desktopImage)throw new SafeDiagnosticError('RESOURCE_MISMATCH');
    }
    if(this.options.split&&agent)agentImage=deploymentContainerImage(agent,identity.namespace,'agent','agent');
    if(!isValidDesktopImageRef(desktopImage)||!isValidDesktopImageRef(agentImage))throw new SafeDiagnosticError('RESOURCE_MISMATCH');
    return {desktopImage,agentImage};
  }
}

function parseImagePins(resource:KubernetesObject,namespace:string,ownerHash:string):{desktopImage:string;agentImage:string}{
  const metadata=resource.metadata as Record<string,unknown>|undefined,labels=metadata?.labels as Record<string,unknown>|undefined;
  const data=resource.data as Record<string,unknown>|undefined;
  const expectedLabels={'app.kubernetes.io/managed-by':'coke-grok-bot','coke-grok-bot.io/owner-hash':ownerHash};
  const metadataSafe=metadata?.name==='desktop-image-pin'&&metadata.namespace===namespace&&labels&&Object.keys(labels).length===2&&Object.entries(expectedLabels).every(([key,value])=>labels[key]===value)&&!metadata.annotations&&!metadata.ownerReferences&&!metadata.finalizers&&!metadata.deletionTimestamp;
  const dataSafe=data&&Object.keys(data).sort().join(',')==='agentImage,desktopImage'&&isValidDesktopImageRef(data.agentImage)&&isValidDesktopImageRef(data.desktopImage);
  if(resource.apiVersion!=='v1'||resource.kind!=='ConfigMap'||resource.immutable!==true||!metadataSafe||!dataSafe){
    logResourceMismatch('image-pin',resource,resource,['image-pin metadata or data']);
    throw new SafeDiagnosticError('RESOURCE_MISMATCH');
  }
  if(!data||!isValidDesktopImageRef(data.desktopImage)||!isValidDesktopImageRef(data.agentImage)){
    logResourceMismatch('image-pin',resource,resource,['image-pin values']);
    throw new SafeDiagnosticError('RESOURCE_MISMATCH');
  }
  return {desktopImage:data.desktopImage,agentImage:data.agentImage};
}

function logResourceMismatch(stage:string,expected:KubernetesObject,actual:KubernetesObject,mismatchFields?:string[]):void{
  const metadata=expected.metadata as {name?:unknown;namespace?:unknown}|undefined;
  console.error('Desktop provisioning refused a mismatched Kubernetes resource',{
    stage,
    kind:typeof expected.kind==='string'?expected.kind:'unknown',
    name:typeof metadata?.name==='string'?metadata.name:'unknown',
    namespace:typeof metadata?.namespace==='string'?metadata.namespace:'cluster-scoped',
    mismatchFields:mismatchFields??resourceMismatchFields(expected,actual),
  });
}

/** Log only field names so a provisioning mismatch is diagnosable without exposing Secret values. */
function resourceMismatchFields(expected:KubernetesObject,actual:KubernetesObject):string[]{
  const fields:string[]=[];
  if(expected.kind!==actual.kind)fields.push('kind');
  if(expected.apiVersion!==actual.apiVersion)fields.push('apiVersion');
  const wanted=expected.metadata as Record<string,unknown>|undefined,found=actual.metadata as Record<string,unknown>|undefined;
  if(!wanted||!found){fields.push('metadata');return fields;}
  if(wanted.name!==found.name)fields.push('metadata.name');
  if(wanted.namespace&&wanted.namespace!==found.namespace)fields.push('metadata.namespace');
  const wantedLabels=wanted.labels as Record<string,unknown>|undefined,foundLabels=found.labels as Record<string,unknown>|undefined;
  for(const key of Object.keys(wantedLabels||{}))if(wantedLabels?.[key]!==foundLabels?.[key])fields.push(`metadata.labels.${key}`);
  if(expected.kind==='Secret'){
    if(expected.type!==actual.type)fields.push('type');
    const values=expected.stringData as Record<string,string>|undefined,data=actual.data as Record<string,string>|undefined;
    for(const [key,value] of Object.entries(values||{}))if(typeof data?.[key]!=='string'||data[key]!==Buffer.from(value).toString('base64'))fields.push(`data.${key}`);
  }else if(expected.kind==='ConfigMap'){
    if(expected.immutable!==actual.immutable)fields.push('immutable');
    if(!isSubset(expected.data,actual.data))fields.push('data');
  }else if(expected.kind==='RoleBinding'){
    if(!isSubset(expected.roleRef,actual.roleRef))fields.push('roleRef');
    if(!isSubset(expected.subjects,actual.subjects))fields.push('subjects');
  }else if(expected.spec!==undefined&&!isSubset(expected.spec,actual.spec))fields.push('spec');
  return fields;
}

function deploymentContainerImage(resource:KubernetesObject,namespace:string,deploymentName:string,containerName:string):string{
  const metadata=resource.metadata as Record<string,unknown>|undefined,spec=resource.spec as Record<string,unknown>|undefined;
  const template=spec?.template as Record<string,unknown>|undefined,pod=template?.spec as Record<string,unknown>|undefined,containers=pod?.containers;
  if(resource.apiVersion!=='apps/v1'||resource.kind!=='Deployment'||metadata?.name!==deploymentName||metadata.namespace!==namespace||!Array.isArray(containers))throw new SafeDiagnosticError('RESOURCE_MISMATCH');
  const matches=containers.filter((item):item is Record<string,unknown>=>Boolean(item)&&typeof item==='object'&&!Array.isArray(item)&&(item as Record<string,unknown>).name===containerName);
  if(matches.length!==1||!isValidDesktopImageRef(matches[0].image))throw new SafeDiagnosticError('RESOURCE_MISMATCH');
  return matches[0].image;
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
  if(expected.kind==='ConfigMap' && (expected.immutable!==actual.immutable || !isSubset(expected.data,actual.data))) return false;
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
