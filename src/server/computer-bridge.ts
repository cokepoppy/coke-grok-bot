import type { ApprovalStore } from './approval-store.ts';
import { ComputerBroker,type GuardedComputerWorker } from './computer-broker.ts';
import { canonicalComputerAction } from './computer-action.ts';
import type { RunOwner,RunStore } from './run-store.ts';

export interface RunScope {owner:RunOwner;runId:string;leaseId:string;botId:string}
export interface ComputerReadWorker extends GuardedComputerWorker { control(signal:AbortSignal):Promise<{owner:'agent'|'user'}>; inspect(signal:AbortSignal):Promise<unknown>; screenshot(signal:AbortSignal):Promise<Buffer> }
/** Only the authenticated, live run capability may call these methods. */
export class ComputerBridge {
 constructor(private readonly runs:Pick<RunStore,'hasLiveLease'|'markComputerUsed'>,private readonly approvals:Pick<ApprovalStore,'propose'|'consume'|'status'>,private readonly worker:(scope:RunScope)=>ComputerReadWorker){}
 private async authorize(scope:RunScope,signal:AbortSignal):Promise<ComputerReadWorker>{
  if(signal.aborted || !await this.runs.hasLiveLease(scope.owner,scope.runId,scope.leaseId,scope.botId))throw new Error('Run lease unavailable');
  return this.worker(scope);
 }
 private async markUsed(scope:RunScope):Promise<void>{await this.runs.markComputerUsed(scope.owner,scope.runId,scope.leaseId,scope.botId).catch(()=>false)}
 async inspect(scope:RunScope,signal:AbortSignal):Promise<unknown>{const result=await (await this.authorize(scope,signal)).inspect(signal);await this.markUsed(scope);return result}
 async control(scope:RunScope,signal:AbortSignal):Promise<{owner:'agent'|'user'}>{return (await this.authorize(scope,signal)).control(signal)}
 async screenshot(scope:RunScope,signal:AbortSignal):Promise<Buffer>{const image=await (await this.authorize(scope,signal)).screenshot(signal);await this.markUsed(scope);return image}
 async propose(scope:RunScope,input:unknown,signal:AbortSignal):Promise<{id:string}>{
  const worker=await this.authorize(scope,signal),approval=await new ComputerBroker(this.approvals,worker).propose(scope.runId,scope.leaseId,input,signal);return {id:approval.id};
 }
 async status(scope:RunScope,id:string,signal:AbortSignal):Promise<string|null>{
  await this.authorize(scope,signal);return this.approvals.status(scope.runId,scope.leaseId,id);
 }
 async execute(scope:RunScope,id:string,input:unknown,signal:AbortSignal):Promise<unknown>{
  const worker=await this.authorize(scope,signal);
  if(input&&typeof input==='object'&&!Array.isArray(input)&&(input as {kind?:unknown}).kind==='terminal'){
   if(signal.aborted)throw new Error('Task stopped');
   const state=await worker.snapshot(signal);if(state.owner!=='agent')throw new Error('User controls the computer');
   const action=canonicalComputerAction(input,state);
   if(!await this.approvals.consume(scope.runId,scope.leaseId,id,action))throw new Error('Terminal approval is missing, expired or does not match the current action and screen');
   if(signal.aborted)throw new Error('Task stopped after approval');
   await this.markUsed(scope);
   return {approved:true};
  }
  const result=await new ComputerBroker(this.approvals,worker).execute(scope.runId,scope.leaseId,id,input,signal);
  await this.markUsed(scope);
  return result;
 }
}
