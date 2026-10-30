import {request as httpsRequest} from 'node:https';
import {desktopOwnerHash} from './desktop-resources.ts';
import type {RunOwner} from './run-store.ts';
import type {NamespaceBootstrapConnection} from './namespace-bootstrap-service.ts';

export class NamespaceBootstrapClient implements NamespaceBootstrapConnection {
 private readonly endpoint:URL;
 constructor(endpoint:string,private readonly ca:Buffer,private readonly token:string){
  this.endpoint=new URL(endpoint);
  if(this.endpoint.protocol!=='https:'||this.endpoint.username||this.endpoint.password||this.endpoint.pathname!=='/'||this.endpoint.search||this.endpoint.hash||!ca.length||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Invalid namespace bootstrap service');
 }
 async ensure(owner:RunOwner,signal:AbortSignal):Promise<string>{
  const expected=`grok-user-${desktopOwnerHash(owner)}`,body=Buffer.from(JSON.stringify({tenantId:owner.tenantId,userId:owner.userId}));
  const result=await new Promise<{status:number;data:Buffer}>((resolve,reject)=>{
   const req=httpsRequest(new URL('/v1/personal-namespace',this.endpoint),{method:'POST',ca:this.ca,headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json','content-length':body.length},signal,timeout:60_000},res=>{
    let size=0;const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>4096){res.destroy();reject(new Error('Namespace bootstrap response too large'));return}chunks.push(chunk)});res.on('end',()=>resolve({status:res.statusCode||0,data:Buffer.concat(chunks)}));res.on('error',reject);
   });req.on('timeout',()=>req.destroy(new Error('Namespace bootstrap timed out')));req.on('error',reject);req.end(body);
  });
  if(result.status!==200)throw new Error('Namespace bootstrap unavailable');
  let value:unknown;try{value=JSON.parse(result.data.toString('utf8'))}catch{throw new Error('Invalid namespace bootstrap response')}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).join(',')!=='namespace'||(value as {namespace?:unknown}).namespace!==expected)throw new Error('Invalid namespace bootstrap response');
  return expected;
 }
}
