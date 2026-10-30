import type { Approval,ApprovalStore } from './approval-store.ts';
import {canonicalComputerAction,type ComputerSnapshot} from './computer-action.ts';
export interface ComputerState extends ComputerSnapshot { owner:'agent'|'user' }
/** Worker implementation must check state and ownership atomically with the action. */
export interface GuardedComputerWorker {
 snapshot(signal:AbortSignal):Promise<ComputerState>;
 snapshotWithImage?(signal:AbortSignal):Promise<{state:ComputerState;image:Buffer}>;
 performIfUnchanged(input:unknown,expected:ComputerState,signal:AbortSignal):Promise<unknown>;
}
/**
 * The server, not the model, builds the approval from the exact operation and
 * worker state. This class is not a network boundary: callers must already
 * authenticate and bind the run capability to runId and leaseId.
 */
export class ComputerBroker {
 constructor(private readonly approvals:Pick<ApprovalStore,'propose'|'consume'>,private readonly worker:GuardedComputerWorker){}
 async propose(runId:string,leaseId:string,input:unknown,signal:AbortSignal):Promise<Approval>{
  if(signal.aborted)throw new Error('Task stopped');
  const captured=this.worker.snapshotWithImage ? await this.worker.snapshotWithImage(signal) : null;
  const state=captured?.state ?? await this.worker.snapshot(signal);if(state.owner!=='agent')throw new Error('User controls the computer');
  const action=canonicalComputerAction(input,state);
  const approval=await this.approvals.propose(runId,leaseId,action,300,captured?.image);
  if(!approval)throw new Error('Run lease is unavailable');
  return approval;
 }
 async execute(runId:string,leaseId:string,approvalId:string,input:unknown,signal:AbortSignal):Promise<unknown>{
  if(signal.aborted)throw new Error('Task stopped');
  const state=await this.worker.snapshot(signal);if(state.owner!=='agent')throw new Error('User controls the computer');
  const action=canonicalComputerAction(input,state);
  if(!await this.approvals.consume(runId,leaseId,approvalId,action))throw new Error('Approval is missing, expired or does not match the current action and screen');
  if(signal.aborted)throw new Error('Task stopped after approval');
  // A transport error after this point is an unknown outcome; never retry it automatically.
  return this.worker.performIfUnchanged(input,state,signal);
 }
}
