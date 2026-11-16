import type { ApprovalStore } from './approval-store.ts';
import type { ComputerState,GuardedComputerWorker } from './computer-broker.ts';
import { canonicalComputerAction } from './computer-action.ts';
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
  // A live, authenticated task lease grants ordinary Browser User and
  // Computer User operations. Do not make access depend on prompt classifiers,
  // URL allowlists, or per-control approvals; the Worker pauses only at a real
  // sign-in or human-verification challenge.
  if(worker.navigationState&&worker.navigateIfUnchanged&&input&&typeof input==='object'&&!Array.isArray(input)){
   const candidate=input as Record<string,unknown>;
   if(candidate.kind==='browser'&&candidate.action==='navigate'&&typeof candidate.url==='string'){
    let raw:URL|null=null;try{raw=new URL(candidate.url)}catch{/* Invalid destinations continue through canonical validation below. */}
    if(raw&&(raw.protocol==='https:'||raw.protocol==='http:')&&!raw.username&&!raw.password){
     let navigationState;
     try{navigationState=await worker.navigationState(signal)}catch(error){
      // Older, already-running Desktop images do not expose the screenshot-free
      // navigation endpoints. Fall through to their guarded snapshot/execute
      // pair so ordinary HTTP(S) navigation still proceeds without approval.
      if(!(error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_WORKER_HTTP_ERROR'&&error.status===404)){
       if(error instanceof SafeDiagnosticError)throw error;
       throw new SafeDiagnosticError('COMPUTER_SNAPSHOT_FAILED');
      }
     }
     if(navigationState){
      if(navigationState.owner!=='agent')throw new SafeDiagnosticError('COMPUTER_OWNER_USER');
      let canonical:string;try{canonical=canonicalComputerAction(input,{url:navigationState.url,screenshotSha256:'0'.repeat(64)})}catch{throw new SafeDiagnosticError('COMPUTER_ACTION_INVALID')}
      const action=JSON.parse(canonical) as {kind?:unknown;action?:unknown;arguments?:{url?:unknown}};
      if(action.kind==='browser'&&action.action==='navigate'){
       if(signal.aborted)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');
       try{const result=await worker.navigateIfUnchanged(input,navigationState,signal);await this.markUsed(scope);return {status:'completed',result}}
       catch(error){if(signal.aborted)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');if(error instanceof SafeDiagnosticError)throw error;throw new SafeDiagnosticError('COMPUTER_WORKER_FAILED')}
      }
     }
    }
   }
  }
  let state:ComputerState;
  try{state=await worker.snapshot(signal)}catch(error){
   if(error instanceof SafeDiagnosticError)throw error;
   throw new SafeDiagnosticError('COMPUTER_SNAPSHOT_FAILED');
  }
  if(state.owner!=='agent')throw new SafeDiagnosticError('COMPUTER_OWNER_USER');
  let action:string;try{action=canonicalComputerAction(input,state)}catch{throw new SafeDiagnosticError('COMPUTER_ACTION_INVALID')}
  const canonical=JSON.parse(action) as {kind?:unknown;action?:unknown;arguments?:Record<string,unknown>};
  if(canonical.kind==='browser'&&canonical.action==='navigate'&&typeof canonical.arguments?.url==='string'){
   if(signal.aborted)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');
   try{
    const result=await worker.performIfUnchanged(input,state,signal);
    await this.markUsed(scope);
    return {status:'completed',result};
   }catch(error){if(signal.aborted)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');if(error instanceof SafeDiagnosticError)throw error;throw new SafeDiagnosticError('COMPUTER_WORKER_FAILED')}
  }
  // Every valid browser action is bounded by the authenticated user task and
  // live run lease. Browser controls pass through the Worker auth guard; that
  // guard hands off login, credential, and human-verification surfaces.
  if(canonical.kind==='browser'){
   if(signal.aborted)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');
   try{
    const result=await worker.performIfUnchanged(input,state,signal);
    await this.markUsed(scope);return {status:'completed',result};
   }catch(error){
    if(signal.aborted)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');
    if(error instanceof SafeDiagnosticError)throw error;
    else throw new SafeDiagnosticError('COMPUTER_WORKER_FAILED');
   }
  }
  // Desktop controls are available on both native UI and the visible browser.
  // The Worker enforces the sole human handoff boundary for auth challenges.
  if(canonical.kind==='desktop'){
   if(signal.aborted)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');
   try{const result=await worker.performIfUnchanged(input,state,signal);await this.markUsed(scope);return {status:'completed',result}}
   catch(error){if(signal.aborted)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');if(error instanceof SafeDiagnosticError)throw error;throw new SafeDiagnosticError('COMPUTER_WORKER_FAILED')}
  }
  // The terminal runs inside the Agent Pod, not the Desktop Worker. Current
  // Pi/DSH adapters execute it directly inside this user's task/shared folder;
  // reject stale adapters instead of recreating per-command approval cards.
  if(canonical.kind==='terminal')throw new SafeDiagnosticError('COMPUTER_WORKER_FORBIDDEN');
  throw new SafeDiagnosticError('COMPUTER_ACTION_INVALID');
 }
 async status(scope:RunScope,id:string,signal:AbortSignal):Promise<string|null>{
  await this.authorize(scope,signal);const status=await this.approvals.status(scope.runId,scope.leaseId,id);return status==='pending'?'expired':status;
 }
 async execute(scope:RunScope,id:string,input:unknown,signal:AbortSignal):Promise<unknown>{
  const worker=await this.authorize(scope,signal);
  if(input&&typeof input==='object'&&!Array.isArray(input)&&(input as {kind?:unknown}).kind==='terminal')throw new SafeDiagnosticError('COMPUTER_WORKER_FORBIDDEN');
  void id;
  throw new SafeDiagnosticError('COMPUTER_APPROVAL_REJECTED');
 }
}
