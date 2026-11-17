import type { ApprovalStore } from './approval-store.ts';
import type { ComputerState,GuardedComputerWorker } from './computer-broker.ts';
import type { RunOwner,RunStore } from './run-store.ts';
import { SafeDiagnosticError } from './safe-diagnostics.ts';

export interface RunScope {owner:RunOwner;runId:string;leaseId:string;botId:string}
export interface ComputerReadWorker extends GuardedComputerWorker { control(signal:AbortSignal):Promise<{owner:'agent'|'user'}>; inspect(signal:AbortSignal):Promise<unknown>; screenshot(signal:AbortSignal):Promise<Buffer> }
/** Only the authenticated, live run capability may call these methods. */
export class ComputerBridge {
 constructor(private readonly runs:Pick<RunStore,'hasLiveLease'|'markComputerUsed'>,private readonly approvals:Pick<ApprovalStore,'status'>,private readonly worker:(scope:RunScope)=>ComputerReadWorker){}
 private async authorize(scope:RunScope,signal:AbortSignal):Promise<ComputerReadWorker>{
  if(signal.aborted)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');
  let live:boolean;try{live=await this.runs.hasLiveLease(scope.owner,scope.runId,scope.leaseId,scope.botId)}catch{throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_CHECK_FAILED')}
  if(!live)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');
  return this.worker(scope);
 }
 private async markUsed(scope:RunScope):Promise<void>{await this.runs.markComputerUsed(scope.owner,scope.runId,scope.leaseId,scope.botId).catch(()=>false)}
 async inspect(scope:RunScope,signal:AbortSignal):Promise<unknown>{const result=await (await this.authorize(scope,signal)).inspect(signal);await this.markUsed(scope);return result}
 async control(scope:RunScope,signal:AbortSignal):Promise<{owner:'agent'|'user'}>{return (await this.authorize(scope,signal)).control(signal)}
 async screenshot(scope:RunScope,signal:AbortSignal):Promise<Buffer>{const image=await (await this.authorize(scope,signal)).screenshot(signal);await this.markUsed(scope);return image}
 async propose(scope:RunScope,input:unknown,signal:AbortSignal):Promise<{id:string}|{status:'completed';result:unknown}>{
  const worker=await this.authorize(scope,signal);
  // The active owner-scoped lease authorizes ordinary browser and desktop
  // operations. Do not filter sites, URL schemes, controls, or keys here; the
  // Worker executes the requested action and handles real sign-in challenges.
  const candidate=input&&typeof input==='object'&&!Array.isArray(input)?input as Record<string,unknown>:null;
  if(worker.navigationState&&worker.navigateIfUnchanged&&candidate?.kind==='browser'&&candidate.action==='navigate'){
   let navigationState;
   try{navigationState=await worker.navigationState(signal)}catch(error){
    // Older Desktop images do not expose the screenshot-free navigation
    // endpoint. Fall back to their guarded snapshot/execute pair.
    if(!(error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_WORKER_HTTP_ERROR'&&error.status===404)){
     if(error instanceof SafeDiagnosticError)throw error;
     throw new SafeDiagnosticError('COMPUTER_SNAPSHOT_FAILED');
    }
   }
   if(navigationState){
    if(navigationState.owner!=='agent')throw new SafeDiagnosticError('COMPUTER_OWNER_USER');
    if(signal.aborted)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');
    try{const result=await worker.navigateIfUnchanged(input,navigationState,signal);await this.markUsed(scope);return {status:'completed',result}}
    catch(error){if(signal.aborted)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');if(error instanceof SafeDiagnosticError)throw error;throw new SafeDiagnosticError('COMPUTER_WORKER_FAILED')}
   }
  }
  let state:ComputerState;
  try{state=await worker.snapshot(signal)}catch(error){
   if(error instanceof SafeDiagnosticError)throw error;
   throw new SafeDiagnosticError('COMPUTER_SNAPSHOT_FAILED');
  }
  if(state.owner!=='agent')throw new SafeDiagnosticError('COMPUTER_OWNER_USER');
  if(signal.aborted)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');
  try{
   const result=await worker.performIfUnchanged(input,state,signal);
   await this.markUsed(scope);return {status:'completed',result};
  }catch(error){
   if(signal.aborted)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');
   if(error instanceof SafeDiagnosticError)throw error;
   throw new SafeDiagnosticError('COMPUTER_WORKER_FAILED');
  }
 }
 async status(scope:RunScope,id:string,signal:AbortSignal):Promise<string|null>{
  await this.authorize(scope,signal);const status=await this.approvals.status(scope.runId,scope.leaseId,id);return status==='pending'?'expired':status;
 }
 async execute(scope:RunScope,id:string,input:unknown,signal:AbortSignal):Promise<unknown>{
  await this.authorize(scope,signal);
  void input;
  void id;
  throw new SafeDiagnosticError('COMPUTER_APPROVAL_REJECTED');
 }
}
