export type RunTraceComponent = 'control-plane' | 'scheduler' | 'agent-runtime' | 'model-gateway' | 'computer-worker' | 'mysql';
export type RunTraceOutcome = 'started' | 'succeeded' | 'failed' | 'info';

export interface RunTraceEvent {
  component: RunTraceComponent;
  event: string;
  outcome: RunTraceOutcome;
  httpStatus?: number | null;
  diagnosticCode?: string | null;
  durationMs?: number | null;
  releaseId?: string | null;
}

const components = new Set<RunTraceComponent>(['control-plane','scheduler','agent-runtime','model-gateway','computer-worker','mysql']);
const outcomes = new Set<RunTraceOutcome>(['started','succeeded','failed','info']);

/** Trace rows contain only bounded operational metadata; never request/response bodies or page data. */
export function validateRunTraceEvent(value: unknown): RunTraceEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!components.has(row.component as RunTraceComponent)
      || typeof row.event !== 'string' || !/^[a-z][a-z0-9_.-]{1,63}$/.test(row.event)
      || !outcomes.has(row.outcome as RunTraceOutcome)) return null;
  const httpStatus = row.httpStatus === undefined || row.httpStatus === null ? null : row.httpStatus;
  const diagnosticCode = row.diagnosticCode === undefined || row.diagnosticCode === null ? null : row.diagnosticCode;
  const durationMs = row.durationMs === undefined || row.durationMs === null ? null : row.durationMs;
  const releaseId = row.releaseId === undefined || row.releaseId === null ? null : row.releaseId;
  if (httpStatus !== null && (!Number.isInteger(httpStatus) || Number(httpStatus) < 100 || Number(httpStatus) > 599)) return null;
  if (diagnosticCode !== null && (typeof diagnosticCode !== 'string' || !/^[A-Za-z0-9_.-]{1,96}$/.test(diagnosticCode))) return null;
  if (durationMs !== null && (!Number.isSafeInteger(durationMs) || Number(durationMs) < 0 || Number(durationMs) > 3_600_000)) return null;
  if (releaseId !== null && (typeof releaseId !== 'string' || !/^sha-[a-f0-9]{40}$/.test(releaseId))) return null;
  return {
    component: row.component as RunTraceComponent,
    event: row.event,
    outcome: row.outcome as RunTraceOutcome,
    httpStatus: httpStatus as number | null,
    diagnosticCode: diagnosticCode as string | null,
    durationMs: durationMs as number | null,
    releaseId: releaseId as string | null,
  };
}
