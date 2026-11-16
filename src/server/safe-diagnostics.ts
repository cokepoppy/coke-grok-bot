/** Fixed diagnostic codes only; never serialize exception messages or request data. */
export type SafeDiagnosticCode =
  | 'NAMESPACE_BOOTSTRAP_FAILED'
  | 'BOOTSTRAP_ADMISSION_FAILED'
  | 'OWNER_BINDING_MISMATCH'
  | 'KUBERNETES_READ_FAILED'
  | 'KUBERNETES_CREATE_FAILED'
  | 'RESOURCE_MISSING'
  | 'RESOURCE_MISMATCH'
  | 'DESKTOP_NOT_READY'
  | 'BROKER_REJECTED'
  | 'BROKER_TRANSPORT_FAILED'
  | 'COMPUTER_PROVISIONING_FAILED'
  | 'COMPUTER_WORKER_FAILED'
  | 'COMPUTER_WORKER_TRANSPORT_FAILED'
  | 'COMPUTER_WORKER_AUTH_REJECTED'
  | 'COMPUTER_WORKER_FORBIDDEN'
  | 'COMPUTER_WORKER_HTTP_ERROR'
  | 'COMPUTER_WORKER_INVALID_RESPONSE'
  | 'COMPUTER_AUTH_REQUIRED'
  | 'COMPUTER_BOT_UNAVAILABLE'
  | 'COMPUTER_RUN_LEASE_CHECK_FAILED'
  | 'COMPUTER_RUN_LEASE_UNAVAILABLE'
  | 'COMPUTER_SNAPSHOT_FAILED'
  | 'COMPUTER_SCREEN_CAPACITY'
  | 'COMPUTER_ACTIVE_TAB_UNRESOLVED'
  | 'COMPUTER_RENDERER_UNRESPONSIVE'
  | 'COMPUTER_OWNER_USER'
  | 'COMPUTER_ACTION_INVALID'
  | 'COMPUTER_NAVIGATION_USE_BROWSER'
  | 'COMPUTER_SIGNIN_HANDOFF_REQUIRED'
  | 'COMPUTER_APPROVAL_STORE_FAILED'
  | 'COMPUTER_APPROVAL_RUN_UNAVAILABLE'
  | 'COMPUTER_APPROVAL_REJECTED'
  | 'INTERNAL_FAILURE';

export type SafeWorkerOperation = 'control' | 'navigate' | 'execute';
export type SafeWorkerTransportCode =
  | 'ECONNRESET'
  | 'ECONNREFUSED'
  | 'ETIMEDOUT'
  | 'EHOSTUNREACH'
  | 'ENETUNREACH'
  | 'ENOTFOUND'
  | 'EAI_AGAIN'
  | 'EPIPE'
  | 'ECONNABORTED'
  | 'ERR_SOCKET_CLOSED'
  | 'UND_ERR_CONNECT_TIMEOUT'
  | 'UND_ERR_HEADERS_TIMEOUT'
  | 'UND_ERR_BODY_TIMEOUT'
  | 'UND_ERR_SOCKET'
  | 'UNKNOWN';

const safeWorkerOperations: readonly SafeWorkerOperation[] = ['control', 'navigate', 'execute'];
const safeWorkerTransportCodes: readonly SafeWorkerTransportCode[] = [
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
  'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ECONNABORTED', 'ERR_SOCKET_CLOSED',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET', 'UNKNOWN',
];

export class SafeDiagnosticError extends Error {
  constructor(
    readonly diagnosticCode: SafeDiagnosticCode,
    readonly status?: number,
    readonly workerOperation?: SafeWorkerOperation,
    readonly transportCode?: SafeWorkerTransportCode,
  ) {
    super(diagnosticCode);
    this.name = 'SafeDiagnosticError';
  }
}

export function safeDiagnosticCode(error: unknown): SafeDiagnosticCode {
  return error instanceof SafeDiagnosticError ? error.diagnosticCode : 'INTERNAL_FAILURE';
}

export function safeWorkerTransportCode(error: unknown): SafeWorkerTransportCode {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth += 1) {
    const value = current as {code?: unknown; cause?: unknown};
    if (typeof value.code === 'string' && safeWorkerTransportCodes.includes(value.code as SafeWorkerTransportCode) && value.code !== 'UNKNOWN') {
      return value.code as SafeWorkerTransportCode;
    }
    current = value.cause;
  }
  return 'UNKNOWN';
}

export function safeDiagnosticMetadata(error: unknown): {code:SafeDiagnosticCode;status?:number;workerOperation?:SafeWorkerOperation;transportCode?:SafeWorkerTransportCode} {
  if(!(error instanceof SafeDiagnosticError))return {code:'INTERNAL_FAILURE'};
  const status=Number.isInteger(error.status)&&error.status!>=100&&error.status!<=599?error.status:undefined;
  const workerOperation=error.workerOperation&&safeWorkerOperations.includes(error.workerOperation)?error.workerOperation:undefined;
  const transportCode=error.transportCode&&safeWorkerTransportCodes.includes(error.transportCode)?error.transportCode:undefined;
  return {
    code:error.diagnosticCode,
    ...(status===undefined?{}:{status}),
    ...(workerOperation?{workerOperation}:{}),
    ...(transportCode?{transportCode}:{}),
  };
}
