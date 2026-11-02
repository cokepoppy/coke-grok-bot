import type { Session } from './tenant-store.ts';
import type { UserComputerAction } from './guarded-worker.ts';
import {SafeDiagnosticError} from './safe-diagnostics.ts';

export interface UserComputerWorker {
 control(signal:AbortSignal):Promise<{owner:'agent'|'user'}>;
 userScreenshot(signal:AbortSignal):Promise<Buffer>;
 setControl(owner:'agent'|'user',signal:AbortSignal):Promise<{owner:'agent'|'user'}>;
 userAction(action:UserComputerAction,signal:AbortSignal):Promise<void>;
}

/** Select a desktop only from the authenticated session, never from user input. */
export class UserComputer {
 private readonly preparing=new Map<string,Promise<void>>();
 constructor(
  private readonly worker:(owner:Pick<Session,'tenantId'|'userId'>,botId:string)=>UserComputerWorker,
  private readonly ensure?: (owner:Pick<Session,'tenantId'|'userId'>,signal:AbortSignal)=>Promise<void>,
 ){}
 private async getWorker(owner:Session,botId:string,signal:AbortSignal):Promise<UserComputerWorker>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(botId))throw new Error('Invalid Bot screen');
  if(this.ensure){
   const key=`${owner.tenantId.toLowerCase()}:${owner.userId.toLowerCase()}`;
   let pending=this.preparing.get(key);
   if(!pending){
    pending=this.ensure(owner,signal).finally(()=>{if(this.preparing.get(key)===pending)this.preparing.delete(key)});
    this.preparing.set(key,pending);
   }
   try { await pending; }
   catch(error) { if(error instanceof SafeDiagnosticError)throw error;throw new SafeDiagnosticError('COMPUTER_PROVISIONING_FAILED'); }
   if(signal.aborted)throw new Error('Computer request was cancelled');
  }
  return this.worker(owner,botId);
 }
 async control(owner:Session,botId:string,signal:AbortSignal){try{return await (await this.getWorker(owner,botId,signal)).control(signal)}catch(error){throw this.workerError(error)}}
 async screenshot(owner:Session,botId:string,signal:AbortSignal){try{return await (await this.getWorker(owner,botId,signal)).userScreenshot(signal)}catch(error){throw this.workerError(error)}}
 async setControl(owner:Session,botId:string,value:'agent'|'user',signal:AbortSignal){try{return await (await this.getWorker(owner,botId,signal)).setControl(value,signal)}catch(error){throw this.workerError(error)}}
 async action(owner:Session,botId:string,input:unknown,signal:AbortSignal){try{return await (await this.getWorker(owner,botId,signal)).userAction(parseUserAction(input),signal)}catch(error){throw this.workerError(error)}}
 private workerError(error:unknown):SafeDiagnosticError{return error instanceof SafeDiagnosticError?error:new SafeDiagnosticError('COMPUTER_WORKER_FAILED')}
}

export function parseUserAction(value:unknown):UserComputerAction {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid computer action');
 const input=value as Record<string,unknown>,keys=Object.keys(input).sort().join(',');
 if(input.action==='click' && keys==='action,x,y' && Number.isInteger(input.x) && Number.isInteger(input.y) && (input.x as number)>=0 && (input.x as number)<1440 && (input.y as number)>=0 && (input.y as number)<900)return {action:'click',x:input.x as number,y:input.y as number};
 if(input.action==='type' && keys==='action,text' && typeof input.text==='string' && input.text.length>0 && input.text.length<=2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.text))return {action:'type',text:input.text};
 if(input.action==='press' && keys==='action,key' && typeof input.key==='string' && ['Enter','Tab','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End','Space'].includes(input.key))return {action:'press',key:input.key};
 throw new Error('Invalid computer action');
}
