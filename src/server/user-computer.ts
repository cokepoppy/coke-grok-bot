import type { Session } from './tenant-store.ts';
import type { UserComputerAction } from './guarded-worker.ts';

export interface UserComputerWorker {
 control(signal:AbortSignal):Promise<{owner:'agent'|'user'}>;
 userScreenshot(signal:AbortSignal):Promise<Buffer>;
 setControl(owner:'agent'|'user',signal:AbortSignal):Promise<{owner:'agent'|'user'}>;
 userAction(action:UserComputerAction,signal:AbortSignal):Promise<void>;
}

/** Select a desktop only from the authenticated session, never from user input. */
export class UserComputer {
 constructor(private readonly worker:(owner:Pick<Session,'tenantId'|'userId'>)=>UserComputerWorker){}
 control(owner:Session,signal:AbortSignal){return this.worker(owner).control(signal)}
 screenshot(owner:Session,signal:AbortSignal){return this.worker(owner).userScreenshot(signal)}
 setControl(owner:Session,value:'agent'|'user',signal:AbortSignal){return this.worker(owner).setControl(value,signal)}
 action(owner:Session,input:unknown,signal:AbortSignal){return this.worker(owner).userAction(parseUserAction(input),signal)}
}

export function parseUserAction(value:unknown):UserComputerAction {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid computer action');
 const input=value as Record<string,unknown>,keys=Object.keys(input).sort().join(',');
 if(input.action==='click' && keys==='action,x,y' && Number.isInteger(input.x) && Number.isInteger(input.y) && (input.x as number)>=0 && (input.x as number)<1440 && (input.y as number)>=0 && (input.y as number)<900)return {action:'click',x:input.x as number,y:input.y as number};
 if(input.action==='type' && keys==='action,text' && typeof input.text==='string' && input.text.length>0 && input.text.length<=2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.text))return {action:'type',text:input.text};
 if(input.action==='press' && keys==='action,key' && typeof input.key==='string' && ['Enter','Tab','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End','Space'].includes(input.key))return {action:'press',key:input.key};
 throw new Error('Invalid computer action');
}
