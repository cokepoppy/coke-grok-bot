export type RuntimePollComponent = 'run_scheduler' | 'routine_dispatch' | 'handoff_delivery' | 'expired_run_recovery';

export type RuntimePollEvent = {
  event: 'grok_runtime_poll_failed' | 'grok_runtime_poll_still_running';
  component: RuntimePollComponent;
  elapsedMs: number;
  at: string;
};

export type RuntimePollerServices = {
  scheduler: { tick(): Promise<void> };
  routines: { dispatchDue(): Promise<unknown> };
  handoffs: { deliverReplies(): Promise<unknown> };
  runs: { markExpiredUnknown(): Promise<unknown> };
};

export type RuntimePollerOptions = {
  intervalMs?: number;
  slowAfterMs?: number;
  onEvent?: (event: RuntimePollEvent) => void;
};

export type RuntimePollers = { stop(): void };

const defaultLog = (event: RuntimePollEvent) => process.stderr.write(`${JSON.stringify(event)}\n`);

/**
 * Keep independent background work from blocking user run dispatch. A single
 * poller never overlaps itself; slow and failed polls are observable, and a
 * failed poll is retried on a later interval after its Promise has settled.
 * A still-pending operation is not duplicated because its transaction may have
 * an unknown outcome. Logs never include prompts, IDs, or raw error messages.
 */
export function startRuntimePollers(services: RuntimePollerServices, options: RuntimePollerOptions = {}): RuntimePollers {
  const intervalMs = options.intervalMs ?? 2_000;
  const slowAfterMs = options.slowAfterMs ?? Math.max(10_000, intervalMs * 3);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || !Number.isSafeInteger(slowAfterMs) || slowAfterMs < 1) {
    throw new Error('Invalid runtime poll interval');
  }
  const log = options.onEvent ?? defaultLog;
  const loops = [
    startPoller('run_scheduler', () => services.scheduler.tick(), intervalMs, slowAfterMs, log),
    startPoller('routine_dispatch', () => services.routines.dispatchDue(), intervalMs, slowAfterMs, log),
    startPoller('handoff_delivery', () => services.handoffs.deliverReplies(), intervalMs, slowAfterMs, log),
    startPoller('expired_run_recovery', () => services.runs.markExpiredUnknown(), intervalMs, slowAfterMs, log),
  ];
  return { stop: () => loops.forEach(loop => loop.stop()) };
}

function startPoller(
  component: RuntimePollComponent,
  operation: () => Promise<unknown>,
  intervalMs: number,
  slowAfterMs: number,
  log: (event: RuntimePollEvent) => void,
): { stop(): void } {
  let stopped = false;
  let inFlight = false;
  let startedAt = 0;
  let slowReported = false;

  const execute = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    startedAt = Date.now();
    slowReported = false;
    try {
      await operation();
    } catch {
      log({ event: 'grok_runtime_poll_failed', component, elapsedMs: Date.now() - startedAt, at: new Date().toISOString() });
    } finally {
      inFlight = false;
      startedAt = 0;
    }
  };

  const timer = setInterval(() => {
    if (inFlight) {
      const elapsedMs = Date.now() - startedAt;
      if (!slowReported && elapsedMs >= slowAfterMs) {
        slowReported = true;
        log({ event: 'grok_runtime_poll_still_running', component, elapsedMs, at: new Date().toISOString() });
      }
      return;
    }
    void execute();
  }, intervalMs);
  timer.unref();
  void execute();

  return { stop() { stopped = true; clearInterval(timer); } };
}
