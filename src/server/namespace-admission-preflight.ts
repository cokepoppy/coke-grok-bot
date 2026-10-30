import {randomBytes} from 'node:crypto';
import {personalDesktopBinding,namespaceBootstrapResources} from './namespace-bootstrap-resources.ts';
import type {KubernetesObject} from './desktop-provisioner.ts';

export interface AdmissionProbe {get(kind:string,namespace:string|null,name:string,signal:AbortSignal):Promise<KubernetesObject|null>;admissionDenies(object:KubernetesObject,policyName:string,bindingName:string,signal:AbortSignal):Promise<boolean>}
/** Server-side dry runs only. Each check must be rejected by its expected policy and binding. */
export class NamespaceAdmissionPreflight {
 constructor(private readonly kube:AdmissionProbe,private readonly options:{controlNamespace:string;bootstrapServiceAccount:string;brokerServiceAccount:string;bootstrapRole:string;brokerRole:string;policyPrefix:string}){
  if(Object.values(options).some(value=>!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value)||value.length>50))throw new Error('Invalid admission preflight configuration');
  if(options.bootstrapServiceAccount===options.brokerServiceAccount||options.bootstrapRole===options.brokerRole)throw new Error('Invalid admission preflight configuration');
 }
 async verify(signal:AbortSignal):Promise<void>{
  if(signal.aborted)throw new Error('Admission preflight cancelled');
  const expected=namespaceBootstrapResources(this.options);
  for(const kind of ['ValidatingAdmissionPolicy','ValidatingAdmissionPolicyBinding'])for(const suffix of ['namespace','binding']){
   const name=`${this.options.policyPrefix}-${suffix}`,wanted=expected.find(item=>item.kind===kind&&(item.metadata as {name:string}).name===name),actual=await this.kube.get(kind,null,name,signal);
   if(!wanted||!actual||actual.apiVersion!==wanted.apiVersion||actual.kind!==kind||(actual.metadata as {name?:string}|undefined)?.name!==name||!equal(actual.spec,wanted.spec))throw new Error('Admission policy does not match expected configuration');
  }
  const invalidNamespace={apiVersion:'v1',kind:'Namespace',metadata:{name:`grok-probe-${randomBytes(12).toString('hex')}`}};
  const policy=`${this.options.policyPrefix}-namespace`;
  if(!await this.kube.admissionDenies(invalidNamespace,policy,policy,signal))throw new Error('Namespace admission is not confirmed');
  const target=`grok-user-${randomBytes(16).toString('hex')}`,binding=personalDesktopBinding(target,this.options) as {metadata:{namespace:string};subjects:{name:string}[]};
  binding.metadata.namespace=this.options.controlNamespace;binding.subjects[0].name=this.options.brokerServiceAccount==='bootstrap-probe'?'other-probe':'bootstrap-probe';
  const bindingPolicy=`${this.options.policyPrefix}-binding`;
  if(!await this.kube.admissionDenies(binding,bindingPolicy,bindingPolicy,signal))throw new Error('Role binding admission is not confirmed');
 }
}

function equal(a:unknown,b:unknown):boolean{
 if(a===b)return true;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equal(v,b[i]));
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
 return ak.length===bk.length&&ak.every((k,i)=>k===bk[i]&&equal((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));
}
