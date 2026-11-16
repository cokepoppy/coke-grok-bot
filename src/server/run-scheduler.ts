import type { AgentRun, RunScreenScope } from './run-store.ts';
import type { AgentExecutionAudit } from './execution-audit.ts';
import { RunDiagnosticError, safeRunDiagnosticCode, type RunDiagnosticCode } from './run-diagnostics.ts';

export interface SchedulerStore {
  queuedScreens(limit: number, queueCreatedAfter?: Date): Promise<RunScreenScope[]>;
  claimNext(screen: RunScreenScope, leaseSeconds: number, queueCreatedAfter?: Date): Promise<{run:AgentRun;leaseId:string}|null>;
  renew(runId:string, leaseId:string, leaseSeconds:number): Promise<boolean>;
  finish(runId:string, leaseId:string, status:'completed'|'failed', result:string, artifacts?:unknown, executionAudit?:unknown): Promise<boolean>;
  markUnknown(runId:string, leaseId:string, diagnosticCode?:RunDiagnosticCode, executionAudit?:unknown): Promise<boolean>;
}
export type ExecutionResult = {status:'completed'|'failed';result:string;artifacts?:unknown;executionAudit?:AgentExecutionAudit|null};
export interface RunExecutor { execute(screen:RunScreenScope,run:AgentRun,signal:AbortSignal,leaseId:string):Promise<ExecutionResult> }
export type SchedulerClaimEvent = {
  event: 'grok_scheduler_claim_failed' | 'grok_scheduler_claim_still_running' | 'grok_scheduler_finish_retry' | 'grok_scheduler_finish_failed' | 'grok_scheduler_unknown_mark_failed';
  elapsedMs: number;
  at: string;
  failureClass?: 'database_deadlock' | 'database_lock_timeout' | 'database_connection' | 'unknown';
};
type PendingClaim = { startedAt: number; slowTimer?: ReturnType<typeof setTimeout> };
type ActiveRun = { abort: AbortController; done: Promise<void> };

const defaultClaimLog = (event: SchedulerClaimEvent) => process.stderr.write(`${JSON.stringify(event)}\n`);

function classifyClaimFailure(error: unknown): NonNullable<SchedulerClaimEvent['failureClass']> {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code.toUpperCase()
    : '';
  if (code === 'ER_LOCK_DEADLOCK' || code === '1213') return 'database_deadlock';
  if (code === 'ER_LOCK_WAIT_TIMEOUT' || code === '1205') return 'database_lock_timeout';
  if (['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','PROTOCOL_CONNECTION_LOST','PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'].includes(code)) return 'database_connection';
  return 'unknown';
}

const pause = (ms:number) => new Promise<void>(resolve=>setTimeout(resolve,ms));

/**
 * One process may run multiple computers concurrently; each computer is locked
 * by the store. Exceptions or lost leases stay unknown and are never replayed.
 */
export class RunScheduler {
  private readonly active = new Map<string,ActiveRun>();
  private readonly claiming = new Map<string,PendingClaim>();
  private stopped = false;
  private tickInFlight: Promise<void> | null = null;
  private readonly claimSlowAfterMs: number;
  private readonly logClaimEvent: (event: SchedulerClaimEvent) => void;
  constructor(private readonly store:SchedulerStore, private readonly executor:RunExecutor, private readonly options: {concurrency:number;leaseSeconds:number;queueCreatedAfter?:Date;claimSlowAfterMs?:number;onClaimEvent?:(event:SchedulerClaimEvent)=>void}) {
    if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 32 || !Number.isSafeInteger(options.leaseSeconds) || options.leaseSeconds < 3 || options.leaseSeconds > 900) throw new Error('Invalid scheduler configuration');
    if (options.queueCreatedAfter && (!Number.isFinite(options.queueCreatedAfter.getTime()))) throw new Error('Invalid queue creation cutoff');
    this.claimSlowAfterMs=options.claimSlowAfterMs??10_000;
    if(!Number.isSafeInteger(this.claimSlowAfterMs)||this.claimSlowAfterMs<1)throw new Error('Invalid scheduler claim warning interval');
    this.logClaimEvent=options.onClaimEvent??defaultClaimLog;
  }
  async tick():Promise<void> {
    if (this.stopped) return;
    if (this.tickInFlight) return this.tickInFlight;
    const tick = this.tickOnce(); this.tickInFlight = tick;
    try { await tick; } finally { if (this.tickInFlight === tick) this.tickInFlight = null; }
  }
  private async tickOnce():Promise<void> {
    const remaining = this.options.concurrency - this.active.size - this.claiming.size;
    if (remaining <= 0 || this.stopped) return;
    const screens = await this.store.queuedScreens(Math.min(100, this.options.concurrency * 4),this.options.queueCreatedAfter);
    for (const screen of screens) {
      if (this.stopped || this.active.size + this.claiming.size >= this.options.concurrency) break;
      const key = `${screen.tenantId}:${screen.userId}:${screen.botId}`;
      if (this.active.has(key)||this.claiming.has(key)) continue;
      this.claimScreen(screen,key);
    }
  }
  /** A slow database claim reserves its own screen and one global slot, never the scan loop. */
  private claimScreen(screen:RunScreenScope,key:string):void {
    const pending:PendingClaim={startedAt:Date.now()};
    this.claiming.set(key,pending);
    pending.slowTimer=setTimeout(()=>{
      if(this.claiming.get(key)!==pending)return;
      this.reportClaimEvent({event:'grok_scheduler_claim_still_running',elapsedMs:Date.now()-pending.startedAt,at:new Date().toISOString()});
    },this.claimSlowAfterMs);
    pending.slowTimer.unref();
    void Promise.resolve().then(()=>this.store.claimNext(screen,this.options.leaseSeconds,this.options.queueCreatedAfter)).then(async claim=>{
      if(this.claiming.get(key)===pending)this.claiming.delete(key);
      if(pending.slowTimer)clearTimeout(pending.slowTimer);
      if(!claim)return;
      if(this.stopped){await this.store.markUnknown(claim.run.id,claim.leaseId,'execution_aborted').catch(()=>undefined);return;}
      this.startExecution(screen,key,claim);
    }).catch(error=>{
      if(this.claiming.get(key)===pending)this.claiming.delete(key);
      if(pending.slowTimer)clearTimeout(pending.slowTimer);
      this.reportClaimEvent({event:'grok_scheduler_claim_failed',elapsedMs:Date.now()-pending.startedAt,at:new Date().toISOString(),failureClass:classifyClaimFailure(error)});
    });
  }
  private reportClaimEvent(event:SchedulerClaimEvent):void { try{this.logClaimEvent(event);}catch{/* Diagnostics must not stop dispatch. */} }
  private startExecution(screen:RunScreenScope,key:string,claim:{run:AgentRun;leaseId:string}):void {
    const abort=new AbortController();
    let work:ActiveRun;
    // Reserve the screen before the executor is invoked, even when its Promise resolves synchronously.
    work={abort,done:Promise.resolve().then(()=>this.execute(screen,claim,abort)).finally(()=>{if(this.active.get(key)===work)this.active.delete(key);})};
    this.active.set(key,work);
  }
  private async execute(screen:RunScreenScope, claim:{run:AgentRun;leaseId:string}, abort:AbortController):Promise<void> {
    const leaseMs=this.options.leaseSeconds*1000;
    const renewIntervalMs=Math.max(1000,Math.floor(leaseMs/3));
    const renewTimeoutMs=Math.max(250,Math.min(5000,Math.floor(renewIntervalMs/2)));
    const leaseSafetyMs=Math.max(1000,Math.floor(leaseMs*0.1));
    let renewing = false, leaseLost = false, lastLeaseConfirmationAt=Date.now();
    let retryTimer:ReturnType<typeof setTimeout>|undefined;
    const renewLease=async():Promise<void>=>{
      if(renewing||leaseLost||abort.signal.aborted)return;
      if(retryTimer){clearTimeout(retryTimer);retryTimer=undefined;}
      renewing = true;
      let timeout:ReturnType<typeof setTimeout>|undefined;
      try {
        const timedRenewal=new Promise<never>((_resolve,reject)=>{
          timeout=setTimeout(()=>reject(new Error('Lease renewal timed out')),renewTimeoutMs);
          timeout.unref();
        });
        const renewed=await Promise.race([this.store.renew(claim.run.id,claim.leaseId,this.options.leaseSeconds),timedRenewal]);
        if(abort.signal.aborted)return;
        if(!renewed){leaseLost=true;abort.abort();return;}
        lastLeaseConfirmationAt=Date.now();
      } catch {
        const remainingMs=leaseMs-(Date.now()-lastLeaseConfirmationAt);
        if(remainingMs<=leaseSafetyMs){leaseLost=true;abort.abort();return;}
        retryTimer=setTimeout(()=>{retryTimer=undefined;void renewLease();},Math.min(1000,Math.max(100,remainingMs-leaseSafetyMs)));
        retryTimer.unref();
      } finally {
        if(timeout)clearTimeout(timeout);
        renewing=false;
      }
    };
    const timer = setInterval(() => { void renewLease(); }, renewIntervalMs);
    timer.unref();
    try {
      if(claim.run.botId!==screen.botId)throw new Error('Claimed run does not match its Bot screen');
      const outcome = await this.executor.execute(screen,claim.run,abort.signal,claim.leaseId);
      if (leaseLost || abort.signal.aborted) { await this.store.markUnknown(claim.run.id,claim.leaseId,leaseLost?'lease_lost':'execution_aborted',outcome.executionAudit); return; }
      if (!outcome || !['completed','failed'].includes(outcome.status) || typeof outcome.result !== 'string' || !outcome.result.trim() || outcome.result.length > 20000) throw new Error('Invalid executor result');
      const persistStartedAt=Date.now();
      let saved:boolean;
      try {
        saved=await this.finishWithRetry(claim.run.id,claim.leaseId,outcome,()=>!leaseLost&&!abort.signal.aborted);
      } catch(error) {
        this.reportClaimEvent({event:'grok_scheduler_finish_failed',elapsedMs:Date.now()-persistStartedAt,at:new Date().toISOString(),failureClass:classifyClaimFailure(error)});
        await this.markUnknownAfterPersistFailure(claim.run.id,claim.leaseId,outcome.executionAudit);
        return;
      }
      if (!saved) await this.markUnknownAfterPersistFailure(claim.run.id,claim.leaseId,outcome.executionAudit);
    } catch (error) {
      // The executor might already have performed an external side effect. Do not repeat it.
      const executionAudit=error instanceof RunDiagnosticError?error.executionAudit:undefined;
      await this.store.markUnknown(claim.run.id,claim.leaseId,safeRunDiagnosticCode(error),executionAudit).catch(() => undefined);
    } finally {
      clearInterval(timer);
      if(retryTimer)clearTimeout(retryTimer);
    }
  }
  private async finishWithRetry(runId:string,leaseId:string,outcome:ExecutionResult,mayRetry:()=>boolean):Promise<boolean>{
    const startedAt=Date.now();
    for(let attempt=0;;attempt++){
      try{return await this.store.finish(runId,leaseId,outcome.status,outcome.result,outcome.artifacts,outcome.executionAudit)}
      catch(error){
        if(attempt>=2||!mayRetry()||classifyClaimFailure(error)==='unknown')throw error;
        this.reportClaimEvent({event:'grok_scheduler_finish_retry',elapsedMs:Date.now()-startedAt,at:new Date().toISOString(),failureClass:classifyClaimFailure(error)});
        await pause(attempt===0?100:250);
      }
    }
  }
  private async markUnknownAfterPersistFailure(runId:string,leaseId:string,executionAudit?:AgentExecutionAudit|null):Promise<void>{
    try{await this.store.markUnknown(runId,leaseId,'result_persist_failed',executionAudit)}
    catch(error){this.reportClaimEvent({event:'grok_scheduler_unknown_mark_failed',elapsedMs:0,at:new Date().toISOString(),failureClass:classifyClaimFailure(error)})}
  }
  async stop():Promise<void> {
    this.stopped = true;
    await this.tickInFlight?.catch(() => undefined);
    for (const work of this.active.values()) work.abort.abort();
    await Promise.allSettled([...this.active.values()].map(work => work.done));
  }
}
