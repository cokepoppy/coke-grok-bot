export type RunTraceComponent = 'control-plane' | 'scheduler' | 'agent-runtime' | 'model-gateway' | 'computer-worker' | 'mysql';
export type RunTraceOutcome = 'started' | 'succeeded' | 'failed' | 'info';

export interface RunTraceEvent {
  component: RunTraceComponent;
  event: string;
  outcome: RunTraceOutcome;
  attemptNumber?: number | null;
  httpStatus?: number | null;
  upstreamHttpStatus?: number | null;
  upstreamErrorKind?: string | null;
  upstreamErrorCode?: string | null;
  retryAfterSeconds?: number | null;
  requestBytes?: number | null;
  requestLimitBytes?: number | null;
  adapterExitCode?: number | null;
  adapterExitSignal?: string | null;
  databaseCode?: string | null;
  relatedComponent?: RunTraceComponent | null;
  relatedEvent?: string | null;
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
const agentStages = new Set(['agent-setup','agent-execution','model-request','model-response','tool-execution','result-validation','queue-wait','computer-control','adapter-start','adapter-exit']);
const modelGatewayStages = new Set(['request-validation','request-auth','provider-request','provider-response','response-stream']);
const schedulerStages = new Set(['scheduler-execution','lease-renewal','result-persistence']);
const workerOperations = new Set(['viewport','snapshot','snapshot-image','navigation-state','control','navigate','inspect','screenshot','user-screenshot','set-control','user-action','execute']);
const agentOperations = new Set(['agent-adapter']);
const modelGatewayOperations = new Set(['chat-completions']);
const agentTransportCodes = new Set(['EACCES','ECONNRESET','ECONNREFUSED','EMFILE','ENETUNREACH','ENFILE','ENOENT','ENOEXEC','ENOMEM','ETIMEDOUT','EHOSTUNREACH','ENOTFOUND','EAI_AGAIN','EPIPE','ECONNABORTED','ERR_SOCKET_CLOSED','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']);
const agentFailureReasons = new Set(['agent_transport_failed','runtime_setup_failed','runtime_error','agent_timeout','model_request_failed','model_request_rejected','model_endpoint_not_found','model_rate_limited','model_auth_rejected','model_provider_unavailable','model_response_missing','tool_execution_failed','result_missing','result_invalid','agent_output_limit']);
const modelGatewayReasons = new Set(['request_content_type_invalid','request_body_too_large','request_json_invalid','request_shape_invalid','model_name_mismatch','messages_invalid','max_tokens_invalid','stream_flag_invalid','capability_invalid','call_budget_exhausted','provider_http_rejected','provider_rate_limited','provider_cooldown_active','provider_transport_failed','provider_request_failed','provider_response_stream_interrupted','provider_response_missing_body']);
const schedulerReasons = new Set(['database_deadlock','database_lock_timeout','database_connection','database_error','lease_lost','executor_failed','execution_aborted','result_persistence_failed','finish_not_applied']);
const upstreamErrorKinds = new Set(['request_invalid','authentication_rejected','model_not_found','context_limit','rate_limited','quota_exhausted','permission_denied','provider_server_error','provider_unavailable','content_filtered','unknown']);
const upstreamErrorCodes = new Set(['invalid_request_error','invalid_api_key','model_not_found','context_length_exceeded','rate_limit_exceeded','insufficient_quota','permission_denied','unsupported_parameter','unsupported_value','missing_required_parameter','invalid_type','unknown_parameter','request_too_large','content_filter']);
const adapterExitSignals = new Set(['SIGABRT','SIGBUS','SIGFPE','SIGHUP','SIGILL','SIGINT','SIGKILL','SIGPIPE','SIGQUIT','SIGSEGV','SIGTERM','SIGTRAP']);
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
  const attemptNumber = row.attemptNumber === undefined || row.attemptNumber === null ? null : row.attemptNumber;
  const httpStatus = row.httpStatus === undefined || row.httpStatus === null ? null : row.httpStatus;
  const upstreamHttpStatus = row.upstreamHttpStatus === undefined || row.upstreamHttpStatus === null ? null : row.upstreamHttpStatus;
  const upstreamErrorKind = row.upstreamErrorKind === undefined || row.upstreamErrorKind === null ? null : row.upstreamErrorKind;
  const upstreamErrorCode = row.upstreamErrorCode === undefined || row.upstreamErrorCode === null ? null : row.upstreamErrorCode;
  const retryAfterSeconds = row.retryAfterSeconds === undefined || row.retryAfterSeconds === null ? null : row.retryAfterSeconds;
  const requestBytes = row.requestBytes === undefined || row.requestBytes === null ? null : row.requestBytes;
  const requestLimitBytes = row.requestLimitBytes === undefined || row.requestLimitBytes === null ? null : row.requestLimitBytes;
  const adapterExitCode = row.adapterExitCode === undefined || row.adapterExitCode === null ? null : row.adapterExitCode;
  const adapterExitSignal = row.adapterExitSignal === undefined || row.adapterExitSignal === null ? null : row.adapterExitSignal;
  const databaseCode = row.databaseCode === undefined || row.databaseCode === null ? null : row.databaseCode;
  const relatedComponent = row.relatedComponent === undefined || row.relatedComponent === null ? null : row.relatedComponent;
  const relatedEvent = row.relatedEvent === undefined || row.relatedEvent === null ? null : row.relatedEvent;
  const diagnosticCode = row.diagnosticCode === undefined || row.diagnosticCode === null ? null : row.diagnosticCode;
  const reasonCode = row.reasonCode === undefined || row.reasonCode === null ? null : row.reasonCode;
  const durationMs = row.durationMs === undefined || row.durationMs === null ? null : row.durationMs;
  const releaseId = row.releaseId === undefined || row.releaseId === null ? null : row.releaseId;
  const stage = row.stage === undefined || row.stage === null ? null : row.stage;
  const operation = row.operation === undefined || row.operation === null ? null : row.operation;
  const transportCode = row.transportCode === undefined || row.transportCode === null ? null : row.transportCode;
  if (attemptNumber !== null && (!Number.isInteger(attemptNumber) || Number(attemptNumber) < 1 || Number(attemptNumber) > 200 || !['model-gateway','scheduler'].includes(String(row.component)))) return null;
  if (httpStatus !== null && (!Number.isInteger(httpStatus) || Number(httpStatus) < 100 || Number(httpStatus) > 599)) return null;
  if (upstreamHttpStatus !== null && (!['agent-runtime','model-gateway'].includes(String(row.component)) || !Number.isInteger(upstreamHttpStatus) || Number(upstreamHttpStatus) < 100 || Number(upstreamHttpStatus) > 599)) return null;
  if (upstreamErrorKind !== null && (!['agent-runtime','model-gateway'].includes(String(row.component)) || typeof upstreamErrorKind !== 'string' || !upstreamErrorKinds.has(upstreamErrorKind))) return null;
  if (upstreamErrorCode !== null && (!['agent-runtime','model-gateway'].includes(String(row.component)) || typeof upstreamErrorCode !== 'string' || !upstreamErrorCodes.has(upstreamErrorCode))) return null;
  if (retryAfterSeconds !== null && (row.component!=='model-gateway' || !Number.isSafeInteger(retryAfterSeconds) || Number(retryAfterSeconds) < 0 || Number(retryAfterSeconds) > 86400)) return null;
  if (requestBytes !== null && (row.component!=='model-gateway' || row.event!=='model.request' || row.outcome!=='failed' || !Number.isSafeInteger(requestBytes) || Number(requestBytes) < 0 || Number(requestBytes) > 128*1024*1024)) return null;
  if (requestLimitBytes !== null && (row.component!=='model-gateway' || row.event!=='model.request' || row.outcome!=='failed' || !Number.isSafeInteger(requestLimitBytes) || Number(requestLimitBytes) < 1 || Number(requestLimitBytes) > 128*1024*1024)) return null;
  if ((requestBytes === null) !== (requestLimitBytes === null) || requestBytes !== null && Number(requestBytes) <= Number(requestLimitBytes)) return null;
  if (adapterExitCode !== null && (row.component!=='agent-runtime' || !Number.isInteger(adapterExitCode) || Number(adapterExitCode) < 1 || Number(adapterExitCode) > 255)) return null;
  if (adapterExitSignal !== null && (row.component!=='agent-runtime' || typeof adapterExitSignal !== 'string' || !adapterExitSignals.has(adapterExitSignal))) return null;
  if (databaseCode !== null && (!['mysql','scheduler'].includes(String(row.component)) || typeof databaseCode !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(databaseCode))) return null;
  if (relatedComponent !== null && (row.component!=='mysql'||row.event!=='mysql.trace.write'||!components.has(relatedComponent as RunTraceComponent))) return null;
  if (relatedEvent !== null && (row.component!=='mysql'||row.event!=='mysql.trace.write'||typeof relatedEvent!=='string'||!/^[a-z][a-z0-9_.-]{1,63}$/.test(relatedEvent))) return null;
  if (diagnosticCode !== null && (typeof diagnosticCode !== 'string' || !/^[A-Za-z0-9_.-]{1,96}$/.test(diagnosticCode))) return null;
  if (durationMs !== null && (!Number.isSafeInteger(durationMs) || Number(durationMs) < 0 || Number(durationMs) > 3_600_000)) return null;
  if (releaseId !== null && (typeof releaseId !== 'string' || !/^sha-[a-f0-9]{40}$/.test(releaseId))) return null;
  if (reasonCode !== null && (typeof reasonCode !== 'string' || !(row.component==='agent-runtime'&&agentFailureReasons.has(reasonCode)||row.component==='model-gateway'&&modelGatewayReasons.has(reasonCode)||row.component==='scheduler'&&schedulerReasons.has(reasonCode)))) return null;
  if (stage !== null && (typeof stage !== 'string' || !(workerStages.has(stage)||row.component==='agent-runtime'&&agentStages.has(stage)||row.component==='model-gateway'&&modelGatewayStages.has(stage)||row.component==='scheduler'&&schedulerStages.has(stage)||row.component==='mysql'&&['trace-persistence','trace-read'].includes(stage)))) return null;
  if (operation !== null && (typeof operation !== 'string' || !(workerOperations.has(operation)||row.component==='agent-runtime'&&agentOperations.has(operation)||row.component==='model-gateway'&&modelGatewayOperations.has(operation)||row.component==='mysql'&&['trace-insert','trace-select'].includes(operation)))) return null;
  if (transportCode !== null && (typeof transportCode !== 'string' || !(row.component==='computer-worker'&&workerTransportCodes.has(transportCode)||['agent-runtime','model-gateway'].includes(String(row.component))&&agentTransportCodes.has(transportCode)))) return null;
  return {
    component: row.component as RunTraceComponent,
    event: row.event,
    outcome: row.outcome as RunTraceOutcome,
    attemptNumber: attemptNumber as number | null,
    httpStatus: httpStatus as number | null,
    upstreamHttpStatus: upstreamHttpStatus as number | null,
    upstreamErrorKind: upstreamErrorKind as string | null,
    upstreamErrorCode: upstreamErrorCode as string | null,
    retryAfterSeconds: retryAfterSeconds as number | null,
    requestBytes: requestBytes as number | null,
    requestLimitBytes: requestLimitBytes as number | null,
    adapterExitCode: adapterExitCode as number | null,
    adapterExitSignal: adapterExitSignal as string | null,
    databaseCode: databaseCode as string | null,
    relatedComponent: relatedComponent as RunTraceComponent | null,
    relatedEvent: relatedEvent as string | null,
    diagnosticCode: diagnosticCode as string | null,
    reasonCode: reasonCode as string | null,
    durationMs: durationMs as number | null,
    releaseId: releaseId as string | null,
    stage: stage as string | null,
    operation: operation as string | null,
    transportCode: transportCode as string | null,
  };
}
