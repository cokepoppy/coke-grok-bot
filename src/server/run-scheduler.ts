import type { AgentRun, RunOwner } from './run-store.ts';

export interface SchedulerStore {
  markExpiredUnknown(): Promise<number>;
  queuedOwners(limit: number): Promise<RunOwner[]>;
  claimNext(owner: RunOwner, leaseSeconds: number): Promise<{run:AgentRun;leaseId:string}|null>;
  renew(runId:string, leaseId:string, leaseSeconds:number): Promise<boolean>;
  finish(runId:string, leaseId:string, status:'completed'|'failed', result:string): Promise<boolean>;
  markUnknown(runId:string, leaseId:string): Promise<boolean>;
}
export type ExecutionResult = {status:'completed'|'failed';result:string};
export interface RunExecutor { execute(owner:RunOwner,run:AgentRun,signal:AbortSignal,leaseId:string):Promise<ExecutionResult> }

/**
 * One process may run multiple computers concurrently; each computer is locked
 * by the store. Exceptions or lost leases mean unknown, never automatic retry.
 */
export class RunScheduler {
  private readonly active = new Map<string,{ abort:AbortController; done:Promise<void> }>();
  private stopped = false;
  private tickInFlight: Promise<void> | null = null;
  constructor(private readonly store:SchedulerStore, private readonly executor:RunExecutor, private readonly options: {concurrency:number;leaseSeconds:number}) {
    if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 32 || !Number.isSafeInteger(options.leaseSeconds) || options.leaseSeconds < 3 || options.leaseSeconds > 900) throw new Error('Invalid scheduler configuration');
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
    const owners = await this.store.queuedOwners(Math.min(100, this.options.concurrency * 4));
    for (const owner of owners) {
      if (this.stopped || this.active.size >= this.options.concurrency) break;
      const key = `${owner.tenantId}:${owner.userId}`;
      if (this.active.has(key)) continue;
      const claim = await this.store.claimNext(owner,this.options.leaseSeconds);
      if (!claim) continue;
      const abort = new AbortController();
      // Reserve before the executor is invoked, even when its Promise resolves synchronously.
      const done = Promise.resolve().then(() => this.execute(owner,claim,abort)).finally(() => { this.active.delete(key); });
      this.active.set(key,{abort,done});
    }
  }
  private async execute(owner:RunOwner, claim:{run:AgentRun;leaseId:string}, abort:AbortController):Promise<void> {
    let renewing = false, leaseLost = false;
    const timer = setInterval(() => {
      if (renewing || leaseLost) return;
      renewing = true;
      void this.store.renew(claim.run.id,claim.leaseId,this.options.leaseSeconds).then(ok => {
        if (!ok) { leaseLost = true; abort.abort(); }
      }).catch(() => { leaseLost = true; abort.abort(); }).finally(() => { renewing = false; });
    }, Math.max(1000, Math.floor(this.options.leaseSeconds * 1000 / 3)));
    timer.unref();
    try {
      const outcome = await this.executor.execute(owner,claim.run,abort.signal,claim.leaseId);
      if (leaseLost || abort.signal.aborted) { await this.store.markUnknown(claim.run.id,claim.leaseId); return; }
      if (!outcome || !['completed','failed'].includes(outcome.status) || typeof outcome.result !== 'string' || !outcome.result.trim() || outcome.result.length > 20000) throw new Error('Invalid executor result');
      const saved = await this.store.finish(claim.run.id,claim.leaseId,outcome.status,outcome.result);
      if (!saved) await this.store.markUnknown(claim.run.id,claim.leaseId);
    } catch {
      // The executor might already have performed an external side effect. Do not repeat it.
      await this.store.markUnknown(claim.run.id,claim.leaseId).catch(() => undefined);
    } finally { clearInterval(timer); }
  }
  async stop():Promise<void> {
    this.stopped = true;
    await this.tickInFlight?.catch(() => undefined);
    for (const work of this.active.values()) work.abort.abort();
    await Promise.allSettled([...this.active.values()].map(work => work.done));
  }
}
