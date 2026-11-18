export type RunTraceComponent = 'control-plane' | 'scheduler' | 'agent-runtime' | 'model-gateway' | 'computer-worker' | 'mysql';
export type RunTraceOutcome = 'started' | 'succeeded' | 'failed' | 'info';

export interface RunTraceEvent {
  component: RunTraceComponent;
  event: string;
  outcome: RunTraceOutcome;
  httpStatus?: number | null;
  upstreamHttpStatus?: number | null;
  adapterExitCode?: number | null;
  diagnosticCode?: string | null;
  reasonCode?: string | null;
  durationMs?: number | null;
  releaseId?: string | null;
  stage?: string | null;
  operation?: string | null;
  transportCode?: string | null;
}

const components = new Set<RunTraceComponent>(['control-plane','scheduler','agent-runtime','model-gateway','computer-worker','mysql']);
const outcomes = new Set<RunTraceOutcome>(['started','succeeded','failed','info']);
const browserTraceActions = new Set(['inspect','navigate','open_artifact','upload_file','click','fill','select','check','uncheck','press']);
const desktopTraceActions = new Set(['open','navigate','open-artifact','click','type','press']);
const workerStages = new Set(['route','screen-scope','screen-owner','action-body','action-navigate','action-execute']);
const agentStages = new Set(['agent-setup','agent-execution','model-request','model-response','tool-execution','result-validation']);
const workerOperations = new Set(['viewport','snapshot','snapshot-image','navigation-state','control','navigate','inspect','screenshot','user-screenshot','set-control','user-action','execute']);
const agentOperations = new Set(['agent-adapter']);
const agentFailureReasons = new Set(['runtime_setup_failed','runtime_error','model_request_failed','model_request_rejected','model_endpoint_not_found','model_rate_limited','model_auth_rejected','model_provider_unavailable','model_response_missing','tool_execution_failed','result_missing','result_invalid','agent_output_limit']);
const workerTransportCodes = new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','ENOTFOUND','EAI_AGAIN','EPIPE','ECONNABORTED','ERR_SOCKET_CLOSED','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','UNKNOWN']);

/** Add only a fixed action name to the trace event; never include URLs or action arguments. */
export function computerActionTraceEvent(baseEvent:string, action:unknown):string {
  if(baseEvent!=='computer.propose'&&baseEvent!=='computer.execute')return baseEvent;
  if(!action||typeof action!=='object'||Array.isArray(action))return `${baseEvent}.unknown`;
  const value=action as Record<string,unknown>;
  if(value.kind==='browser')return `${baseEvent}.browser.${typeof value.action==='string'&&browserTraceActions.has(value.action)?value.action:'unknown'}`;
  if(value.kind==='desktop')return `${baseEvent}.desktop.${typeof value.action==='string'&&desktopTraceActions.has(value.action)?value.action:'unknown'}`;
  return `${baseEvent}.unknown`;
}

/** Trace rows contain only bounded operational metadata; never request/response bodies or page data. */
export function validateRunTraceEvent(value: unknown): RunTraceEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!components.has(row.component as RunTraceComponent)
      || typeof row.event !== 'string' || !/^[a-z][a-z0-9_.-]{1,63}$/.test(row.event)
      || !outcomes.has(row.outcome as RunTraceOutcome)) return null;
  const httpStatus = row.httpStatus === undefined || row.httpStatus === null ? null : row.httpStatus;
  const upstreamHttpStatus = row.upstreamHttpStatus === undefined || row.upstreamHttpStatus === null ? null : row.upstreamHttpStatus;
  const adapterExitCode = row.adapterExitCode === undefined || row.adapterExitCode === null ? null : row.adapterExitCode;
  const diagnosticCode = row.diagnosticCode === undefined || row.diagnosticCode === null ? null : row.diagnosticCode;
  const reasonCode = row.reasonCode === undefined || row.reasonCode === null ? null : row.reasonCode;
  const durationMs = row.durationMs === undefined || row.durationMs === null ? null : row.durationMs;
  const releaseId = row.releaseId === undefined || row.releaseId === null ? null : row.releaseId;
  const stage = row.stage === undefined || row.stage === null ? null : row.stage;
  const operation = row.operation === undefined || row.operation === null ? null : row.operation;
  const transportCode = row.transportCode === undefined || row.transportCode === null ? null : row.transportCode;
  if (httpStatus !== null && (!Number.isInteger(httpStatus) || Number(httpStatus) < 100 || Number(httpStatus) > 599)) return null;
  if (upstreamHttpStatus !== null && (row.component!=='agent-runtime' || !Number.isInteger(upstreamHttpStatus) || Number(upstreamHttpStatus) < 100 || Number(upstreamHttpStatus) > 599)) return null;
  if (adapterExitCode !== null && (row.component!=='agent-runtime' || !Number.isInteger(adapterExitCode) || Number(adapterExitCode) < 1 || Number(adapterExitCode) > 255)) return null;
  if (diagnosticCode !== null && (typeof diagnosticCode !== 'string' || !/^[A-Za-z0-9_.-]{1,96}$/.test(diagnosticCode))) return null;
  if (durationMs !== null && (!Number.isSafeInteger(durationMs) || Number(durationMs) < 0 || Number(durationMs) > 3_600_000)) return null;
  if (releaseId !== null && (typeof releaseId !== 'string' || !/^sha-[a-f0-9]{40}$/.test(releaseId))) return null;
  if (reasonCode !== null && (row.component!=='agent-runtime' || typeof reasonCode !== 'string' || !agentFailureReasons.has(reasonCode))) return null;
  if (stage !== null && (typeof stage !== 'string' || !(workerStages.has(stage)||row.component==='agent-runtime'&&agentStages.has(stage)))) return null;
  if (operation !== null && (typeof operation !== 'string' || !(workerOperations.has(operation)||row.component==='agent-runtime'&&agentOperations.has(operation)))) return null;
  if (transportCode !== null && (typeof transportCode !== 'string' || !workerTransportCodes.has(transportCode))) return null;
  return {
    component: row.component as RunTraceComponent,
    event: row.event,
    outcome: row.outcome as RunTraceOutcome,
    httpStatus: httpStatus as number | null,
    upstreamHttpStatus: upstreamHttpStatus as number | null,
    adapterExitCode: adapterExitCode as number | null,
    diagnosticCode: diagnosticCode as string | null,
    reasonCode: reasonCode as string | null,
    durationMs: durationMs as number | null,
    releaseId: releaseId as string | null,
    stage: stage as string | null,
    operation: operation as string | null,
    transportCode: transportCode as string | null,
  };
}
