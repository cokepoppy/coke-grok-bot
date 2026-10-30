import {createHash} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import type {DesktopConnection,DesktopConnections} from './pi-executor.ts';
import type {RunOwner} from './run-store.ts';

/** The application holds a broker capability, not a Kubernetes API credential. */
export class DesktopBrokerClient implements DesktopConnections {
 private readonly endpoint:URL;
 constructor(endpoint:string,private readonly ca:Buffer,private readonly token:string){
  this.endpoint=new URL(endpoint);
  if(this.endpoint.protocol!=='https:'||this.endpoint.username||this.endpoint.password||this.endpoint.pathname!=='/'||this.endpoint.search||this.endpoint.hash||!ca.length||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Invalid desktop broker');
 }
 async connect(owner:RunOwner,signal:AbortSignal):Promise<DesktopConnection>{
  const body=Buffer.from(JSON.stringify({tenantId:owner.tenantId,userId:owner.userId}));
  const result=await new Promise<{status:number;data:Buffer}>((resolve,reject)=>{
   const req=httpsRequest(new URL('/v1/personal-computer',this.endpoint),{method:'POST',ca:this.ca,headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json','content-length':body.length},signal,timeout:215_000},res=>{
    let size=0;const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>4096){res.destroy();reject(new Error('Desktop broker response too large'));return}chunks.push(chunk)});res.on('end',()=>resolve({status:res.statusCode||0,data:Buffer.concat(chunks)}));res.on('error',reject);
   });req.on('timeout',()=>req.destroy(new Error('Desktop broker timed out')));req.on('error',reject);req.end(body);
  });
  if(result.status!==200)throw new Error('Desktop broker unavailable');
  let value:unknown;try{value=JSON.parse(result.data.toString('utf8'))}catch{throw new Error('Invalid desktop broker response')}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='agentToken,agentUrl')throw new Error('Invalid desktop broker response');
  const {agentUrl,agentToken}=value as {agentUrl?:unknown;agentToken?:unknown};
  if(typeof agentUrl!=='string'||typeof agentToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(agentToken))throw new Error('Invalid desktop broker response');
  const endpoint=new URL(agentUrl),hash=createHash('sha256').update(`${owner.tenantId.toLowerCase()}:${owner.userId.toLowerCase()}`).digest('hex').slice(0,32);
  if(endpoint.protocol!=='http:'||endpoint.hostname!==`agent.grok-user-${hash}.svc.cluster.local`||endpoint.port!=='8083'||endpoint.username||endpoint.password||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)throw new Error('Invalid desktop broker response');
  return {agentUrl:endpoint,agentToken};
 }
}
