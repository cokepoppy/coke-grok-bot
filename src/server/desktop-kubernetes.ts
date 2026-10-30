import { request as httpsRequest } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import type { DesktopKubernetes,KubernetesObject } from './desktop-provisioner.ts';

const types:Record<string,{path:string;namespaced:boolean}>={
 Namespace:{path:'/api/v1/namespaces',namespaced:false},
 PersistentVolumeClaim:{path:'/api/v1/namespaces/{namespace}/persistentvolumeclaims',namespaced:true},
 Secret:{path:'/api/v1/namespaces/{namespace}/secrets',namespaced:true},
 ConfigMap:{path:'/api/v1/namespaces/{namespace}/configmaps',namespaced:true},
 NetworkPolicy:{path:'/apis/networking.k8s.io/v1/namespaces/{namespace}/networkpolicies',namespaced:true},
 Deployment:{path:'/apis/apps/v1/namespaces/{namespace}/deployments',namespaced:true},
 Service:{path:'/api/v1/namespaces/{namespace}/services',namespaced:true},
 RoleBinding:{path:'/apis/rbac.authorization.k8s.io/v1/namespaces/{namespace}/rolebindings',namespaced:true},
 ValidatingAdmissionPolicy:{path:'/apis/admissionregistration.k8s.io/v1/validatingadmissionpolicies',namespaced:false},
 ValidatingAdmissionPolicyBinding:{path:'/apis/admissionregistration.k8s.io/v1/validatingadmissionpolicybindings',namespaced:false},
};
const safeName=/^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/;
/** Narrow in-cluster API client; no shell, credentials in arguments, object logs, or overwrite. */
export class DesktopKubernetesClient implements DesktopKubernetes {
 private readonly endpoint:URL;
 constructor(endpoint:string,private readonly ca:Buffer,private readonly token:string | (()=>Promise<string>)){
  this.endpoint=new URL(endpoint);
  if(this.endpoint.protocol!=='https:'||this.endpoint.username||this.endpoint.password||this.endpoint.search||this.endpoint.hash||this.endpoint.pathname!=='/'||!ca.length||(typeof token==='string'&&(!token||/[\r\n]/.test(token))))throw new Error('Invalid Kubernetes connection');
 }
 private path(kind:string,namespace:string|null,name?:string):string{
  const entry=types[kind];if(!entry || (entry.namespaced&&(!namespace||!safeName.test(namespace))) || (!entry.namespaced&&namespace) || (name&&!safeName.test(name)))throw new Error('Invalid Kubernetes resource identity');
  return entry.path.replace('{namespace}',namespace||'')+(name?`/${name}`:'');
 }
 private async call(method:'GET'|'POST',path:string,body:KubernetesObject|undefined,signal:AbortSignal,allowError=false):Promise<{status:number;object:KubernetesObject|null}>{
  const encoded=body?Buffer.from(JSON.stringify(body)):undefined;if(encoded && encoded.length>1024*1024)throw new Error('Kubernetes object too large');
  const token=typeof this.token==='string'?this.token:await this.token();
  if(!token || /[\r\n]/.test(token))throw new Error('Invalid Kubernetes token');
  const result=await new Promise<{status:number;data:Buffer}>((resolve,reject)=>{
   const request=httpsRequest(new URL(path,this.endpoint),{method,ca:this.ca,headers:{authorization:`Bearer ${token}`,accept:'application/json',...(encoded?{'content-type':'application/json','content-length':encoded.length}:{})},signal,timeout:15000},response=>{
    const chunks:Buffer[]=[];let size=0;response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>4*1024*1024){response.destroy();reject(new Error('Kubernetes response too large'));return}chunks.push(chunk)});
    response.on('end',()=>resolve({status:response.statusCode||0,data:Buffer.concat(chunks)}));response.on('error',reject);
   });request.on('timeout',()=>request.destroy(new Error('Kubernetes request timed out')));request.on('error',reject);request.end(encoded);
  });
  if((method==='GET'&&result.status===404)||(method==='POST'&&result.status===409))return {status:result.status,object:null};
  if((result.status<200||result.status>=300)&&!allowError)throw new Error(`Kubernetes request failed (HTTP ${result.status})`);
  let object:unknown;try{object=JSON.parse(result.data.toString('utf8'))}catch{throw new Error('Invalid Kubernetes response')}
  if(!object||typeof object!=='object'||Array.isArray(object))throw new Error('Invalid Kubernetes response');
  return {status:result.status,object:object as KubernetesObject};
 }
 async get(kind:string,namespace:string|null,name:string,signal:AbortSignal):Promise<KubernetesObject|null>{
  const result=await this.call('GET',this.path(kind,namespace,name),undefined,signal);return result.object;
 }
 async create(object:KubernetesObject,signal:AbortSignal):Promise<boolean>{
  const metadata=object.metadata as {namespace?:string};const kind=String(object.kind||'');
  const result=await this.call('POST',this.path(kind,metadata?.namespace||null),object,signal);return result.status!==409;
 }
 /** A successful or unrelated denial never counts as proof that the named admission policy is active. */
 async admissionDenies(object:KubernetesObject,policyName:string,bindingName:string,signal:AbortSignal):Promise<boolean>{
  if(!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(policyName)||!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(bindingName)||!['Namespace','RoleBinding'].includes(String(object.kind)))throw new Error('Invalid admission probe');
  const metadata=object.metadata as {namespace?:string},path=this.path(String(object.kind),metadata?.namespace||null)+'?dryRun=All';
  const result=await this.call('POST',path,object,signal,true),status=result.object as {kind?:unknown;status?:unknown;message?:unknown}|null;
  return result.status>=400 && result.status<500 && status?.kind==='Status' && status.status==='Failure' && typeof status.message==='string' && status.message.includes(`ValidatingAdmissionPolicy '${policyName}' with binding '${bindingName}' denied request`);
 }
 async waitForReady(namespace:string,name:string,signal:AbortSignal):Promise<void>{
  const deadline=Date.now()+180_000;
  while(Date.now()<deadline){
   const deployment=await this.get('Deployment',namespace,name,signal);
   const meta=deployment?.metadata as {generation?:number;deletionTimestamp?:string}|undefined;
   const status=deployment?.status as {observedGeneration?:number;updatedReplicas?:number;availableReplicas?:number;replicas?:number}|undefined;
   if(meta?.deletionTimestamp)throw new Error('Desktop deployment is being removed');
   if(meta?.generation && status && (status.observedGeneration||0)>=meta.generation && status.updatedReplicas===1 && status.availableReplicas===1 && status.replicas===1)return;
   await delay(1500,undefined,{signal});
  }
  throw new Error('Desktop readiness timed out');
 }
}
