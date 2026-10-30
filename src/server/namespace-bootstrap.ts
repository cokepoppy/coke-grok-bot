import {desktopOwnerHash} from './desktop-resources.ts';
import {personalDesktopBinding} from './namespace-bootstrap-resources.ts';
import {matchesExpectedResource,type DesktopKubernetes,type KubernetesObject} from './desktop-provisioner.ts';
import type {RunOwner} from './run-store.ts';

/** Create or verify only deterministic owner resources, without replacing existing objects. */
export class NamespaceBootstrap {
 constructor(private readonly kube:Pick<DesktopKubernetes,'get'|'create'>,private readonly options:{controlNamespace:string;brokerServiceAccount:string;brokerRole:string;verifyAdmission?:(signal:AbortSignal)=>Promise<void>}){}
 async ensure(owner:RunOwner,signal:AbortSignal):Promise<string>{
  const ownerHash=desktopOwnerHash(owner),namespace=`grok-user-${ownerHash}`;
  if(this.options.verifyAdmission)await this.options.verifyAdmission(signal);
  const expectedNamespace:KubernetesObject={apiVersion:'v1',kind:'Namespace',metadata:{name:namespace,labels:{'app.kubernetes.io/managed-by':'coke-grok-bot','coke-grok-bot.io/owner-hash':ownerHash}}};
  await this.ensureObject(expectedNamespace,null,signal);
  const {controlNamespace,brokerServiceAccount,brokerRole}=this.options;
  await this.ensureObject(personalDesktopBinding(namespace,{controlNamespace,brokerServiceAccount,brokerRole}),namespace,signal);
  return namespace;
 }
 private async ensureObject(expected:KubernetesObject,namespace:string|null,signal:AbortSignal):Promise<void>{
  if(signal.aborted)throw new Error('Namespace bootstrap cancelled');
  const kind=String(expected.kind),name=String((expected.metadata as {name:string}).name);
  let actual=await this.kube.get(kind,namespace,name,signal);
  if(!actual){await this.kube.create(expected,signal);actual=await this.kube.get(kind,namespace,name,signal)}
  if(!actual||!matchesExpectedResource(expected,actual)||!safeMetadata(kind,actual))throw new Error('Personal computer bootstrap resource does not match expected configuration');
 }
}

function safeMetadata(kind:string,object:KubernetesObject):boolean {
 const meta=object.metadata as {deletionTimestamp?:unknown;annotations?:Record<string,unknown>;ownerReferences?:unknown[];finalizers?:unknown[];labels?:Record<string,unknown>};
 if(!meta||meta.deletionTimestamp||(meta.annotations&&Object.keys(meta.annotations).length)||(meta.ownerReferences?.length)||(meta.finalizers?.length))return false;
 if(kind==='Namespace'){
  const labels=meta.labels||{},allowed=new Set(['app.kubernetes.io/managed-by','coke-grok-bot.io/owner-hash','kubernetes.io/metadata.name']);
  if(Object.keys(labels).some(key=>!allowed.has(key)))return false;
  const spec=object.spec as {finalizers?:unknown[]}|undefined;
  if(spec?.finalizers?.some(value=>value!=='kubernetes'))return false;
 }
 return true;
}
