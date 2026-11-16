import test from 'node:test';
import assert from 'node:assert/strict';
import { browserActionDiagnostic, computerWorkerRequestDiagnostic } from '../deploy/desktop/browser-action-diagnostics.mjs';

test('browser worker failures become fixed diagnostics without forwarding locator text', () => {
  const cases = [
    ['Browser target matched 0 controls; sensitive locator text', 'COMPUTER_BROWSER_TARGET_NOT_FOUND', 422],
    ['Browser upload target matched 0 controls; /private/path', 'COMPUTER_BROWSER_TARGET_NOT_FOUND', 422],
    ['Browser target matched 3 controls; page data', 'COMPUTER_BROWSER_TARGET_AMBIGUOUS', 422],
    ['Browser target matched 10 controls; page data', 'COMPUTER_BROWSER_TARGET_AMBIGUOUS', 422],
    ['Browser upload target matched 2 controls; private path', 'COMPUTER_BROWSER_TARGET_AMBIGUOUS', 422],
    ['Computer state or ownership changed', 'COMPUTER_STATE_CHANGED', 409],
    ['The user currently controls this computer', 'COMPUTER_OWNER_USER', 409],
    ['Timeout 10000ms exceeded. private page text', 'COMPUTER_BROWSER_ACTION_TIMEOUT', 504],
    ['unexpected private content and locator', 'COMPUTER_BROWSER_ACTION_FAILED', 500],
  ];
  for (const [message, code, status] of cases) {
    const diagnostic = browserActionDiagnostic(new Error(message));
    assert.equal(diagnostic.code, code);
    assert.equal(diagnostic.status, status);
    assert.equal(diagnostic.message.includes('private'), false);
    assert.equal(diagnostic.message.includes('sensitive'), false);
  }
});

test('browser timeout classification also recognizes Playwright timeout errors', () => {
  const timeout = Object.assign(new Error('private details'), { name: 'TimeoutError' });
  const diagnostic = browserActionDiagnostic(timeout);
  assert.equal(diagnostic.code, 'COMPUTER_BROWSER_ACTION_TIMEOUT');
  assert.equal(diagnostic.status, 504);
  assert.match(diagnostic.message, /outcome may be unknown/);
});

test('authentication handoff errors preserve the existing exact human boundary', () => {
  const handoff = Object.assign(new Error('Computer action must pause for sign-in or human verification'), { code: 'COMPUTER_SIGNIN_HANDOFF_REQUIRED' });
  assert.equal(browserActionDiagnostic(handoff), handoff);
});

test('guarded worker request stages use fixed diagnostics without exposing request details', () => {
  assert.deepEqual(computerWorkerRequestDiagnostic('screen-scope'), {
    code: 'COMPUTER_WORKER_SCREEN_SCOPE_INVALID', status: 400,
    message: 'The computer worker rejected the Bot screen scope before running the action.',
  });
  assert.deepEqual(computerWorkerRequestDiagnostic('screen-owner'), {
    code: 'COMPUTER_WORKER_SCREEN_OWNER_FAILED', status: 503,
    message: 'The computer worker could not read the current computer control state before running the action.',
  });
  assert.deepEqual(computerWorkerRequestDiagnostic('action-body'), {
    code: 'COMPUTER_WORKER_REQUEST_BODY_INVALID', status: 400,
    message: 'The computer worker could not read the browser action request.',
  });
  assert.deepEqual(computerWorkerRequestDiagnostic('action-execute'), {
    code: 'COMPUTER_WORKER_ACTION_EXECUTION_FAILED', status: 500,
    message: 'The computer worker could not complete the action.',
  });
  assert.equal(computerWorkerRequestDiagnostic('action-body').message.includes('secret'), false);
});
