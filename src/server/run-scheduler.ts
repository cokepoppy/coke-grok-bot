import type { AgentRun, RunScreenScope } from './run-store.ts';
import type { AgentExecutionAudit } from './execution-audit.ts';
import { RunDiagnosticError, safeRunDiagnosticCode, type RunDiagnosticCode } from './run-diagnostics.ts';

export interface SchedulerStore {
  markExpiredUnknown(): Promise<number>;
  queuedScreens(limit: number, queueCreatedAfter?: Date): Promise<RunScreenScope[]>;
  claimNext(screen: RunScreenScope, leaseSeconds: number, queueCreatedAfter?: Date): Promise<{run:AgentRun;leaseId:string}|null>;
  renew(runId:string, leaseId:string, leaseSeconds:number): Promise<boolean>;
  finish(runId:string, leaseId:string, status:'completed'|'failed', result:string, artifacts?:unknown, executionAudit?:unknown): Promise<boolean>;
  markUnknown(runId:string, leaseId:string, diagnosticCode?:RunDiagnosticCode, executionAudit?:unknown): Promise<boolean>;
}
export type ExecutionResult = {status:'completed'|'failed';result:string;artifacts?:unknown;executionAudit?:AgentExecutionAudit|null};
export interface RunExecutor { execute(screen:RunScreenScope,run:AgentRun,signal:AbortSignal,leaseId:string):Promise<ExecutionResult> }

/**
 * One process may run multiple computers concurrently; each computer is locked
 * by the store. Exceptions or lost leases mean unknown, never automatic retry.
 */
export class RunScheduler {
  private readonly active = new Map<string,{ abort:AbortController; done:Promise<void> }>();
  private stopped = false;
  private tickInFlight: Promise<void> | null = null;
  constructor(private readonly store:SchedulerStore, private readonly executor:RunExecutor, private readonly options: {concurrency:number;leaseSeconds:number;queueCreatedAfter?:Date}) {
    if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 32 || !Number.isSafeInteger(options.leaseSeconds) || options.leaseSeconds < 3 || options.leaseSeconds > 900) throw new Error('Invalid scheduler configuration');
    if (options.queueCreatedAfter && (!Number.isFinite(options.queueCreatedAfter.getTime()))) throw new Error('Invalid queue creation cutoff');
  }
  async tick():Promise<void> {
    if (this.stopped) return;
    if (this.tickInFlight) return this.tickInFlight;
    const tick = this.tickOnce(); this.tickInFlight = tick;
    try { await tick; } finally { if (this.tickInFlight === tick) this.tickInFlight = null; }
  }
  private async tickOnce():Promise<void> {
    await this.store.markExpiredUnknown();
    const remaining = this.options.concurrency - this.active.size;
    if (remaining <= 0 || this.stopped) return;
    const screens = await this.store.queuedScreens(Math.min(100, this.options.concurrency * 4),this.options.queueCreatedAfter);
    for (const screen of screens) {
      if (this.stopped || this.active.size >= this.options.concurrency) break;
      const key = `${screen.tenantId}:${screen.userId}:${screen.botId}`;
      if (this.active.has(key)) continue;
      const claim = await this.store.claimNext(screen,this.options.leaseSeconds,this.options.queueCreatedAfter);
      if (!claim) continue;
      const abort = new AbortController();
      // Reserve before the executor is invoked, even when its Promise resolves synchronously.
      const done = Promise.resolve().then(() => this.execute(screen,claim,abort)).finally(() => { this.active.delete(key); });
      this.active.set(key,{abort,done});
    }
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
      const saved = await this.store.finish(claim.run.id,claim.leaseId,outcome.status,outcome.result,outcome.artifacts,outcome.executionAudit);
      if (!saved) await this.store.markUnknown(claim.run.id,claim.leaseId,'result_persist_failed',outcome.executionAudit);
    } catch (error) {
      // The executor might already have performed an external side effect. Do not repeat it.
      const executionAudit=error instanceof RunDiagnosticError?error.executionAudit:undefined;
      await this.store.markUnknown(claim.run.id,claim.leaseId,safeRunDiagnosticCode(error),executionAudit).catch(() => undefined);
    } finally {
      clearInterval(timer);
      if(retryTimer)clearTimeout(retryTimer);
    }
  }
  async stop():Promise<void> {
    this.stopped = true;
    await this.tickInFlight?.catch(() => undefined);
    for (const work of this.active.values()) work.abort.abort();
    await Promise.allSettled([...this.active.values()].map(work => work.done));
  }
}
