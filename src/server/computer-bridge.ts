import type { ApprovalStore } from './approval-store.ts';
import { ComputerBroker,type ComputerState,type GuardedComputerWorker } from './computer-broker.ts';
import { canonicalComputerAction } from './computer-action.ts';
import type { RunOwner,RunStore } from './run-store.ts';
import { SafeDiagnosticError } from './safe-diagnostics.ts';

export interface RunScope {owner:RunOwner;runId:string;leaseId:string;botId:string;requestedNavigationOrigins?:readonly string[];signInHandoff?:boolean}
export interface ComputerReadWorker extends GuardedComputerWorker { control(signal:AbortSignal):Promise<{owner:'agent'|'user'}>; inspect(signal:AbortSignal):Promise<unknown>; screenshot(signal:AbortSignal):Promise<Buffer> }
function isDirectDesktopNavigationAttempt(action:{kind?:unknown;action?:unknown;arguments?:Record<string,unknown>},origins:readonly string[]):boolean{
 if(action.kind!=='desktop')return false;
 const args=action.arguments||{};
 // Chrome tabs and navigation controls can sit at different heights in
 // windowed and maximized layouts. Redirect clicks in the top browser chrome
 // to Browser User instead of creating an approval for ordinary navigation.
 if(action.action==='click'&&typeof args.x==='number'&&typeof args.y==='number'&&args.y>=0&&args.y<=125)return true;
 if(action.action==='type'&&typeof args.text==='string'){
  const value=args.text.trim();
  try{
   const url=new URL(/^https?:\/\//i.test(value)?value:`https://${value}`);
   return !url.username&&!url.password&&origins.includes(url.origin);
  }catch{/* Non-URL typing stays under normal computer review. */}
 }
 return false;
}
/** Only the authenticated, live run capability may call these methods. */
export class ComputerBridge {
 constructor(private readonly runs:Pick<RunStore,'hasLiveLease'|'markComputerUsed'>,private readonly approvals:Pick<ApprovalStore,'propose'|'consume'|'status'>,private readonly worker:(scope:RunScope)=>ComputerReadWorker){}
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
  if(worker.navigationState&&worker.navigateIfUnchanged&&input&&typeof input==='object'&&!Array.isArray(input)){
   const candidate=input as Record<string,unknown>;
   if(candidate.kind==='browser'&&candidate.action==='navigate'&&typeof candidate.url==='string'){
    let raw:URL|null=null;try{raw=new URL(candidate.url)}catch{/* Invalid destinations continue through canonical validation below. */}
    if(raw&&(raw.protocol==='https:'||raw.protocol==='http:')&&!raw.username&&!raw.password&&scope.requestedNavigationOrigins?.includes(raw.origin)){
     let navigationState;
     try{navigationState=await worker.navigationState(signal)}catch(error){
      // Older, already-running Desktop images do not expose the screenshot-free
      // navigation endpoints. Fall through to their guarded snapshot/execute
      // pair so an explicitly requested URL still navigates without approval.
      if(!(error instanceof SafeDiagnosticError&&error.diagnosticCode==='COMPUTER_WORKER_HTTP_ERROR'&&error.status===404)){
       if(error instanceof SafeDiagnosticError)throw error;
       throw new SafeDiagnosticError('COMPUTER_SNAPSHOT_FAILED');
      }
     }
     if(navigationState){
      if(navigationState.owner!=='agent')throw new SafeDiagnosticError('COMPUTER_OWNER_USER');
      let canonical:string;try{canonical=canonicalComputerAction(input,{url:navigationState.url,screenshotSha256:'0'.repeat(64)})}catch{throw new SafeDiagnosticError('COMPUTER_ACTION_INVALID')}
      const action=JSON.parse(canonical) as {kind?:unknown;action?:unknown;arguments?:{url?:unknown}};
      if(disallowedDuringSignInHandoff(scope,action))throw new SafeDiagnosticError('COMPUTER_SIGNIN_HANDOFF_REQUIRED');
      const exactOrigin=typeof action.arguments?.url==='string'?new URL(action.arguments.url).origin:'';
      if(exactOrigin&&scope.requestedNavigationOrigins.includes(exactOrigin)){
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
  if(disallowedDuringSignInHandoff(scope,canonical))throw new SafeDiagnosticError('COMPUTER_SIGNIN_HANDOFF_REQUIRED');
  if(scope.requestedNavigationOrigins?.length&&isDirectDesktopNavigationAttempt(canonical,scope.requestedNavigationOrigins))throw new SafeDiagnosticError('COMPUTER_NAVIGATION_USE_BROWSER');
  if(canonical.kind==='browser'&&canonical.action==='navigate'&&typeof canonical.arguments?.url==='string'){
   let origin='';try{origin=new URL(canonical.arguments.url).origin}catch{/* The canonicalizer already validates the URL. */}
   if(origin&&scope.requestedNavigationOrigins?.includes(origin)){
    if(signal.aborted)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');
    try{
     const result=await worker.performIfUnchanged(input,state,signal);
     await this.markUsed(scope);
     return {status:'completed',result};
    }catch(error){if(signal.aborted)throw new SafeDiagnosticError('COMPUTER_RUN_LEASE_UNAVAILABLE');if(error instanceof SafeDiagnosticError)throw error;throw new SafeDiagnosticError('COMPUTER_WORKER_FAILED')}
   }
  }
  let captured:Awaited<ReturnType<NonNullable<ComputerReadWorker['snapshotWithImage']>>>|null=null;
  if(worker.snapshotWithImage){
   try{captured=await worker.snapshotWithImage(signal)}catch(error){
    if(error instanceof SafeDiagnosticError)throw error;
    throw new SafeDiagnosticError('COMPUTER_SNAPSHOT_FAILED');
   }
   state=captured.state;
   if(state.owner!=='agent')throw new SafeDiagnosticError('COMPUTER_OWNER_USER');
   try{action=canonicalComputerAction(input,state)}catch{throw new SafeDiagnosticError('COMPUTER_ACTION_INVALID')}
   const currentCanonical=JSON.parse(action) as {kind?:unknown;action?:unknown};
   if(disallowedDuringSignInHandoff(scope,currentCanonical))throw new SafeDiagnosticError('COMPUTER_SIGNIN_HANDOFF_REQUIRED');
  }
  let approval:Awaited<ReturnType<ApprovalStore['propose']>>;
  try{approval=await this.approvals.propose(scope.runId,scope.leaseId,action,300,captured?.image)}catch{throw new SafeDiagnosticError('COMPUTER_APPROVAL_STORE_FAILED')}
  if(!approval)throw new SafeDiagnosticError('COMPUTER_APPROVAL_RUN_UNAVAILABLE');
  return {id:approval.id};
 }
 async status(scope:RunScope,id:string,signal:AbortSignal):Promise<string|null>{
  await this.authorize(scope,signal);return this.approvals.status(scope.runId,scope.leaseId,id);
 }
 async execute(scope:RunScope,id:string,input:unknown,signal:AbortSignal):Promise<unknown>{
  const worker=await this.authorize(scope,signal);
  if(scope.signInHandoff){
   const state=await worker.snapshot(signal);if(state.owner!=='agent')throw new SafeDiagnosticError('COMPUTER_OWNER_USER');
   let action:string;try{action=canonicalComputerAction(input,state)}catch{throw new SafeDiagnosticError('COMPUTER_ACTION_INVALID')}
   const canonical=JSON.parse(action) as {kind?:unknown;action?:unknown};
   if(disallowedDuringSignInHandoff(scope,canonical))throw new SafeDiagnosticError('COMPUTER_SIGNIN_HANDOFF_REQUIRED');
  }
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

function disallowedDuringSignInHandoff(scope:RunScope,action:{kind?:unknown;action?:unknown}):boolean{
 return scope.signInHandoff===true&&(action.kind!=='browser'||action.action!=='navigate');
}
