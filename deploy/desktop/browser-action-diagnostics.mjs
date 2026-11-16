const messages = Object.freeze({
  COMPUTER_STATE_CHANGED: 'The computer page or owner changed before the action completed. Inspect the current page and continue from its live state; do not repeat the action blindly.',
  COMPUTER_OWNER_USER: 'The owner currently controls this computer. Stop Agent input and resume only after control is returned.',
  COMPUTER_BROWSER_TARGET_NOT_FOUND: 'No visible browser control matched. Inspect the current page and choose a visible target; do not repeat the same locator.',
  COMPUTER_BROWSER_TARGET_AMBIGUOUS: 'More than one browser control matched. Inspect the current page and choose a unique visible target.',
  COMPUTER_BROWSER_ACTION_TIMEOUT: 'The browser action timed out and its outcome may be unknown. Inspect the current page before deciding whether to continue; do not repeat it blindly.',
  COMPUTER_BROWSER_ACTION_FAILED: 'The browser action was not confirmed. Inspect the current page and task state before deciding whether to continue.',
});

export function browserActionDiagnostic(error) {
  const message = error instanceof Error ? error.message : '';
  const name = error instanceof Error ? error.name : '';
  let code = 'COMPUTER_BROWSER_ACTION_FAILED';
  let status = 500;

  if (error && typeof error === 'object' && (error.code === 'COMPUTER_SIGNIN_HANDOFF_REQUIRED' || Object.hasOwn(messages, error.code))) return error;
  if (/^The user currently controls this computer$|^Computer ownership changed$/.test(message)) {
    code = 'COMPUTER_OWNER_USER'; status = 409;
  } else if (/^Computer state or ownership changed$/.test(message)) {
    code = 'COMPUTER_STATE_CHANGED'; status = 409;
  } else if ((message.match(/^Browser (?:upload )?target matched (\d+) controls\b/) || [])[1] !== undefined) {
    const count = Number(message.match(/^Browser (?:upload )?target matched (\d+) controls\b/)?.[1]);
    code = count === 0 ? 'COMPUTER_BROWSER_TARGET_NOT_FOUND' : count > 1 ? 'COMPUTER_BROWSER_TARGET_AMBIGUOUS' : 'COMPUTER_BROWSER_ACTION_FAILED'; status = count === 1 ? 500 : 422;
  } else if (name === 'TimeoutError' || /(?:Timeout \d+ms exceeded|timed out after \d+ms|operation timed out)/i.test(message)) {
    code = 'COMPUTER_BROWSER_ACTION_TIMEOUT'; status = 504;
  }

  const result = new Error(messages[code]);
  result.name = 'BrowserActionDiagnosticError';
  result.code = code;
  result.status = status;
  return result;
}

export function browserActionDiagnosticMessage(code) {
  return messages[code] || messages.COMPUTER_BROWSER_ACTION_FAILED;
}
