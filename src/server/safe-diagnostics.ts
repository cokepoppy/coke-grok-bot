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
  | 'COMPUTER_RUN_LEASE_CHECK_FAILED'
  | 'COMPUTER_RUN_LEASE_UNAVAILABLE'
  | 'COMPUTER_SNAPSHOT_FAILED'
  | 'COMPUTER_OWNER_USER'
  | 'COMPUTER_ACTION_INVALID'
  | 'COMPUTER_APPROVAL_STORE_FAILED'
  | 'COMPUTER_APPROVAL_RUN_UNAVAILABLE'
  | 'INTERNAL_FAILURE';

export class SafeDiagnosticError extends Error {
  constructor(readonly diagnosticCode: SafeDiagnosticCode, readonly status?: number) {
    super(diagnosticCode);
    this.name = 'SafeDiagnosticError';
  }
}

export function safeDiagnosticCode(error: unknown): SafeDiagnosticCode {
  return error instanceof SafeDiagnosticError ? error.diagnosticCode : 'INTERNAL_FAILURE';
}

export function safeDiagnosticMetadata(error: unknown): {code:SafeDiagnosticCode;status?:number} {
  if(!(error instanceof SafeDiagnosticError))return {code:'INTERNAL_FAILURE'};
  const status=Number.isInteger(error.status)&&error.status!>=100&&error.status!<=599?error.status:undefined;
  return {code:error.diagnosticCode,...(status===undefined?{}:{status})};
}
