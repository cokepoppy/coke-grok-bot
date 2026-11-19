import assert from 'node:assert/strict';
import test from 'node:test';
import { runFailureRecoveryNote } from '../src/web/run-failure-presentation.ts';

test('a rejected first model response explains that no browser action ran', () => {
  const run = {
    failureComponent: 'model-gateway',
    failureStage: 'provider-response',
    failureAttemptNumber: 1,
    failureUpstreamErrorCode: 'model_not_purchased',
  };
  assert.equal(
    runFailureRecoveryNote(run, true),
    'The provider rejected the first model request before the Agent received a response. No browser or desktop action ran; this task was not retried.',
  );
});

test('ambiguous failures keep the computer inspection guidance', () => {
  const laterModelCall = {
    failureComponent: 'model-gateway',
    failureStage: 'provider-response',
    failureAttemptNumber: 2,
    failureUpstreamErrorCode: 'model_not_purchased',
  };
  assert.match(runFailureRecoveryNote(laterModelCall, true), /Earlier computer actions may already have completed/);
  assert.match(runFailureRecoveryNote({}, false), /Inspect the computer before retrying/);
});

test('other first-request failures are not treated as a confirmed no-action failure', () => {
  const otherProviderError = {
    failureComponent: 'model-gateway',
    failureStage: 'provider-response',
    failureAttemptNumber: 1,
    failureUpstreamErrorCode: 'provider_unavailable',
  };
  assert.match(runFailureRecoveryNote(otherProviderError, true), /Earlier computer actions may already have completed/);
});
