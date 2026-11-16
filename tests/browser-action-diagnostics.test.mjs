import test from 'node:test';
import assert from 'node:assert/strict';
import { browserActionDiagnostic } from '../deploy/desktop/browser-action-diagnostics.mjs';

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
