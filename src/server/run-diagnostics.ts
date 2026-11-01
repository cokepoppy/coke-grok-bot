const runDiagnosticCodes = [
  'executor_error',
  'desktop_connect_failed',
  'bot_memory_preload_failed',
  'bot_memory_scope_invalid',
  'capability_issue_failed',
  'agent_transport_failed',
  'agent_http_400',
  'agent_http_401',
  'agent_http_403',
  'agent_http_404',
  'agent_http_408',
  'agent_http_409',
  'agent_http_413',
  'agent_http_415',
  'agent_http_422',
  'agent_http_429',
  'agent_http_5xx',
  'agent_http_other',
  'agent_response_invalid',
  'agent_result_unconfirmed',
  'execution_aborted',
  'lease_lost',
  'result_persist_failed',
  'lease_expired',
] as const;

export type RunDiagnosticCode = typeof runDiagnosticCodes[number];

/** Stable, non-sensitive error categories for uncertain runs. Never stores provider messages or task text. */
export class RunDiagnosticError extends Error {
  constructor(readonly diagnosticCode: RunDiagnosticCode) {
    super(diagnosticCode);
    this.name = 'RunDiagnosticError';
  }
}

export function safeRunDiagnosticCode(error: unknown): RunDiagnosticCode {
  return error instanceof RunDiagnosticError ? error.diagnosticCode : 'executor_error';
}

export function agentHttpDiagnostic(status: number): RunDiagnosticCode {
  if (status >= 500 && status <= 599) return 'agent_http_5xx';
  switch (status) {
    case 400: return 'agent_http_400';
    case 401: return 'agent_http_401';
    case 403: return 'agent_http_403';
    case 404: return 'agent_http_404';
    case 408: return 'agent_http_408';
    case 409: return 'agent_http_409';
    case 413: return 'agent_http_413';
    case 415: return 'agent_http_415';
    case 422: return 'agent_http_422';
    case 429: return 'agent_http_429';
    default: return 'agent_http_other';
  }
}

export function isRunDiagnosticCode(value: unknown): value is RunDiagnosticCode {
  return typeof value === 'string' && (runDiagnosticCodes as readonly string[]).includes(value);
}
