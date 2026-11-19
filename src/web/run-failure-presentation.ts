export type RunFailurePresentationInput = {
  failureComponent?: string | null;
  failureStage?: string | null;
  failureAttemptNumber?: number | null;
  failureUpstreamErrorCode?: string | null;
};

/**
 * A rejected first provider response cannot have produced an Agent tool call.
 * Keep this deliberately narrow so ambiguous runs still tell the user to
 * inspect the computer before retrying.
 */
export function isConfirmedPreActionModelRejection(run: RunFailurePresentationInput): boolean {
  return run.failureComponent === 'model-gateway'
    && run.failureStage === 'provider-response'
    && run.failureAttemptNumber === 1
    && run.failureUpstreamErrorCode === 'model_not_purchased';
}

export function runFailureRecoveryNote(run: RunFailurePresentationInput, hasFailureHeadline: boolean): string {
  if (isConfirmedPreActionModelRejection(run)) {
    return 'The provider rejected the first model request before the Agent received a response. No browser or desktop action ran; this task was not retried.';
  }
  if (hasFailureHeadline) {
    return 'The Agent stopped before returning a final result. Earlier computer actions may already have completed. This run was not replayed; inspect the computer before a separate retry.';
  }
  return 'The task result was not confirmed and the task was not replayed. Inspect the computer before retrying.';
}
