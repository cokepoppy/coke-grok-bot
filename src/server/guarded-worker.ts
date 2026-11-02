import { createHash } from 'node:crypto';
import type { ComputerState,GuardedComputerWorker } from './computer-broker.ts';
import type { RunOwner } from './run-store.ts';
import {SafeDiagnosticError} from './safe-diagnostics.ts';

/** Private worker connection; callers must authenticate the run before constructing it. */
export class HttpGuardedComputerWorker implements GuardedComputerWorker {
 private readonly endpoint:URL;
 constructor(owner:RunOwner,private readonly screenId:string,endpoint:URL,private readonly controlToken:string,private readonly taskId:string,private readonly request:typeof fetch=fetch) {
  const hash=createHash('sha256').update(`${owner.tenantId.toLowerCase()}:${owner.userId.toLowerCase()}`).digest('hex').slice(0,32);
  const validEndpoint=endpoint.protocol==='http:'&&endpoint.hostname===`desktop.grok-user-${hash}.svc.cluster.local`&&endpoint.port==='8082'&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash&&endpoint.pathname==='/';
  const validToken=/^[A-Za-z0-9_-]{43}$/.test(controlToken);
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const validTask=uuid.test(taskId),validScreen=uuid.test(screenId);
  if(!validEndpoint||!validToken||!validTask||!validScreen)throw new Error('Invalid guarded worker');
  this.endpoint=endpoint;
 }
 private headers(json=false):Record<string,string>{return {authorization:`Bearer ${this.controlToken}`,'x-coke-grok-screen-id':this.screenId,...(json?{'content-type':'application/json'}:{})}}
 async snapshot(signal:AbortSignal):Promise<ComputerState>{
  const response=await this.request(new URL('/v1/guarded/snapshot',this.endpoint),{headers:this.headers(),signal,redirect:'error'});
  if(!response.ok)throw new Error('Computer snapshot unavailable');
  const state:unknown=await response.json();
  if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('Invalid computer snapshot');
  const item=state as Partial<ComputerState>;
  if((item.owner!=='agent'&&item.owner!=='user')||typeof item.url!=='string'||item.url.length>4096||typeof item.screenshotSha256!=='string'||!/^[a-f0-9]{64}$/.test(item.screenshotSha256))throw new Error('Invalid computer snapshot');
  return {owner:item.owner,url:item.url,screenshotSha256:item.screenshotSha256};
 }
 async snapshotWithImage(signal:AbortSignal):Promise<{state:ComputerState;image:Buffer}>{
  const response=await this.request(new URL('/v1/guarded/snapshot-image',this.endpoint),{headers:this.headers(),signal,redirect:'error'});
  if(!response.ok)throw new Error('Computer snapshot unavailable');
  const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>1500000)throw new Error('Computer snapshot too large');
  const text=await response.text();if(text.length>1500000)throw new Error('Computer snapshot too large');
  const item=JSON.parse(text) as Partial<ComputerState>&{image?:unknown};
  if(!item || (item.owner!=='agent'&&item.owner!=='user') || typeof item.url!=='string' || item.url.length>4096 || typeof item.screenshotSha256!=='string' || !/^[a-f0-9]{64}$/.test(item.screenshotSha256) || typeof item.image!=='string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.image))throw new Error('Invalid computer snapshot');
  const image=Buffer.from(item.image,'base64');if(!image.length||image.length>1024*1024||createHash('sha256').update(image).digest('hex')!==item.screenshotSha256)throw new Error('Invalid computer screenshot');
  return {state:{owner:item.owner,url:item.url,screenshotSha256:item.screenshotSha256},image};
 }
 async control(signal:AbortSignal):Promise<{owner:'agent'|'user'}>{
  let response:Response;try{response=await this.request(new URL('/v1/guarded/control',this.endpoint),{headers:this.headers(),signal,redirect:'error'})}catch{throw new SafeDiagnosticError('COMPUTER_WORKER_TRANSPORT_FAILED')}
  if(response.status===401)throw new SafeDiagnosticError('COMPUTER_WORKER_AUTH_REJECTED',response.status);
  if(response.status===403)throw new SafeDiagnosticError('COMPUTER_WORKER_FORBIDDEN',response.status);
  if(!response.ok)throw new SafeDiagnosticError('COMPUTER_WORKER_HTTP_ERROR',response.status);
  let value:unknown;try{value=await response.json()}catch{throw new SafeDiagnosticError('COMPUTER_WORKER_INVALID_RESPONSE')}
  if(!value||typeof value!=='object'||Array.isArray(value)||!['agent','user'].includes(String((value as {owner?:unknown}).owner)))throw new SafeDiagnosticError('COMPUTER_WORKER_INVALID_RESPONSE');
  return {owner:(value as {owner:'agent'|'user'}).owner};
 }
 async inspect(signal:AbortSignal):Promise<unknown>{
  const response=await this.request(new URL('/v1/guarded/inspect',this.endpoint),{headers:this.headers(),signal,redirect:'error'});
  if(!response.ok)throw new Error('Computer inspection unavailable');
  const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>65536)throw new Error('Computer inspection too large');
  const text=await response.text();if(text.length>65536)throw new Error('Computer inspection too large');
  const value:unknown=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value)||(value as {ready?:unknown}).ready!==true)throw new Error('Invalid computer inspection');return value;
 }
 async screenshot(signal:AbortSignal):Promise<Buffer>{
  const response=await this.request(new URL('/v1/guarded/screenshot',this.endpoint),{headers:this.headers(),signal,redirect:'error'});
  if(!response.ok||response.headers.get('content-type')?.split(';')[0]!=='image/png')throw new Error('Computer screenshot unavailable');
  const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>1024*1024)throw new Error('Computer screenshot too large');
  const bytes=Buffer.from(await response.arrayBuffer());if(!bytes.length||bytes.length>1024*1024)throw new Error('Computer screenshot too large');return bytes;
 }
 async userScreenshot(signal:AbortSignal):Promise<Buffer>{
  const response=await this.request(new URL('/v1/screenshot',this.endpoint),{headers:this.headers(),signal,redirect:'error'});
  if(!response.ok||response.headers.get('content-type')?.split(';')[0]!=='image/png')throw new Error('Computer screenshot unavailable');
  const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>1024*1024)throw new Error('Computer screenshot too large');
  const image=Buffer.from(await response.arrayBuffer());if(!image.length||image.length>1024*1024)throw new Error('Computer screenshot too large');return image;
 }
 async setControl(owner:'agent'|'user',signal:AbortSignal):Promise<{owner:'agent'|'user'}>{
  const response=await this.request(new URL('/v1/control',this.endpoint),{method:'POST',headers:this.headers(true),body:JSON.stringify({owner}),signal,redirect:'error'});
  if(!response.ok)throw new Error('Computer control unavailable');
  const result:unknown=await response.json();if(!result||typeof result!=='object'||(result as {owner?:unknown}).owner!==owner)throw new Error('Computer control was not confirmed');return {owner};
 }
 async userAction(action:UserComputerAction,signal:AbortSignal):Promise<void>{
  const response=await this.request(new URL('/v1/commands',this.endpoint),{method:'POST',headers:this.headers(true),body:JSON.stringify({...action,actor:'user'}),signal,redirect:'error'});
  if(!response.ok)throw new Error('Computer action was not confirmed');
  const result:unknown=await response.json();if(!result||typeof result!=='object'||(result as {ready?:unknown}).ready!==true)throw new Error('Computer action was not confirmed');
 }
 async performIfUnchanged(input:unknown,expected:ComputerState,signal:AbortSignal):Promise<unknown>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid computer action');
  const action=input as Record<string,unknown>;
  if('taskId' in action)throw new Error('Task identity is controlled by the server');
  const response=await this.request(new URL('/v1/guarded/execute',this.endpoint),{method:'POST',headers:this.headers(true),body:JSON.stringify({action:{...action,...(action.kind==='browser'?{taskId:this.taskId}:{})},expected}),signal,redirect:'error'});
  if(!response.ok)throw new Error('Guarded computer action was not confirmed');
  const value:unknown=await response.json();if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid computer result');return value;
 }
}
export type UserComputerAction={action:'click';x:number;y:number}|{action:'type';text:string}|{action:'press';key:string};
