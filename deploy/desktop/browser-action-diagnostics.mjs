const messages = Object.freeze({
  COMPUTER_STATE_CHANGED: 'The computer page or owner changed before the action completed. Inspect the current page and continue from its live state; do not repeat the action blindly.',
  COMPUTER_OWNER_USER: 'The owner currently controls this computer. Stop Agent input and resume only after control is returned.',
  COMPUTER_BROWSER_TARGET_NOT_FOUND: 'No visible browser control matched. Inspect the current page and choose a visible target; do not repeat the same locator.',
  COMPUTER_BROWSER_TARGET_AMBIGUOUS: 'More than one browser control matched. Inspect the current page and choose a unique visible target.',
  COMPUTER_BROWSER_ACTION_TIMEOUT: 'The browser action timed out and its outcome may be unknown. Inspect the current page before deciding whether to continue; do not repeat it blindly.',
  COMPUTER_BROWSER_ACTION_FAILED: 'The browser action was not confirmed. Inspect the current page and task state before deciding whether to continue.',
  COMPUTER_BROWSER_NAVIGATION_ABORTED: 'Browser navigation was interrupted. Inspect the current page before continuing; do not repeat it blindly.',
  COMPUTER_BROWSER_NAVIGATION_NETWORK_FAILED: 'Chromium could not load the requested page. Inspect the current page and network state before continuing.',
  COMPUTER_BROWSER_NAVIGATION_FAILED: 'Browser navigation failed before completion. Inspect the current page and destination before continuing.',
  COMPUTER_BROWSER_CONTROL_ACTION_FAILED: 'The browser control action failed. Inspect the current page and visible controls before continuing.',
  COMPUTER_BROWSER_CONTEXT_CLOSED: 'The browser page or context closed during the action. Reconnect to the same computer and inspect its current state before continuing.',
  COMPUTER_BROWSER_PAGE_INSPECTION_FAILED: 'The browser page could not be inspected. Check the live computer before continuing.',
  COMPUTER_BROWSER_ARTIFACT_OPEN_FAILED: 'The task artifact could not be opened in the browser. Check the artifact and live computer before continuing.',
  COMPUTER_WORKER_SCREEN_SCOPE_INVALID: 'The computer worker rejected the Bot screen scope before running the action.',
  COMPUTER_WORKER_SCREEN_OWNER_FAILED: 'The computer worker could not read the current computer control state before running the action.',
  COMPUTER_WORKER_REQUEST_BODY_INVALID: 'The computer worker could not read the browser action request.',
  COMPUTER_WORKER_ACTION_EXECUTION_FAILED: 'The computer worker could not complete the action.',
  COMPUTER_DESKTOP_ACTION_UNSUPPORTED: 'The Computer User action name was not recognized. Send the operation as action=press with the key in a separate key field, for example key=Control+t.',
});

const requestStageDiagnostics = Object.freeze({
  'screen-scope': { code: 'COMPUTER_WORKER_SCREEN_SCOPE_INVALID', status: 400 },
  'screen-owner': { code: 'COMPUTER_WORKER_SCREEN_OWNER_FAILED', status: 503 },
  'action-body': { code: 'COMPUTER_WORKER_REQUEST_BODY_INVALID', status: 400 },
  'action-navigate': { code: 'COMPUTER_WORKER_ACTION_EXECUTION_FAILED', status: 500 },
  'action-execute': { code: 'COMPUTER_WORKER_ACTION_EXECUTION_FAILED', status: 500 },
});
const browserActionNames = new Set(['inspect','navigate','open_artifact','upload_file','click','fill','select','check','uncheck','press']);
const desktopActionNames = new Set(['open','navigate','open-artifact','click','type','press']);
const taskIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/** Extract only fixed action metadata and a generated run UUID; never log action arguments. */
export function safeComputerActionLogFields(action, defaultKind = 'unknown') {
  const value = action && typeof action === 'object' && !Array.isArray(action) ? action : {};
  const kind = value.kind === 'browser' || value.kind === 'desktop' ? value.kind : defaultKind;
  const allowed = kind === 'browser' ? browserActionNames : kind === 'desktop' ? desktopActionNames : new Set();
  const name = typeof value.action === 'string' && allowed.has(value.action) ? value.action : 'unknown';
  const runId = typeof value.taskId === 'string' && taskIdPattern.test(value.taskId) ? value.taskId : undefined;
  return { actionKind: kind, action: name, ...(runId ? { runId } : {}) };
}

export function computerWorkerRequestDiagnostic(stage) {
  const value = requestStageDiagnostics[stage] || requestStageDiagnostics['action-body'];
  return Object.freeze({ ...value, message: messages[value.code] });
}

/** Classify the worker's fixed unsupported-command error without retaining action arguments. */
export function desktopActionDiagnostic(error) {
  if (!(error instanceof Error) || error.message !== 'Unsupported desktop command') return error;
  const result = new Error(messages.COMPUTER_DESKTOP_ACTION_UNSUPPORTED);
  result.name = 'ComputerDesktopActionDiagnosticError';
  result.code = 'COMPUTER_DESKTOP_ACTION_UNSUPPORTED';
  result.status = 422;
  return result;
}

export function browserActionDiagnostic(error, action = '') {
  const message = error instanceof Error ? error.message : '';
  const name = error instanceof Error ? error.name : '';
  const errorCode = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : '';
  const safeClassificationInput = `${name} ${errorCode} ${message}`;
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
  } else if (/(?:target|page|browser|context)(?:\s+or\s+browser)?[^\n]{0,60}(?:closed|crashed)|(?:closed|crashed)[^\n]{0,60}(?:target|page|browser|context)/i.test(safeClassificationInput)) {
    code = 'COMPUTER_BROWSER_CONTEXT_CLOSED';
  } else if (action === 'navigate' && /(?:ERR_ABORTED|navigation (?:was )?interrupted|navigation.*cancel(?:led|ed))/i.test(safeClassificationInput)) {
    code = 'COMPUTER_BROWSER_NAVIGATION_ABORTED';
  } else if (action === 'navigate' && /(?:net::ERR_[A-Z_]+|ERR_(?:NAME_NOT_RESOLVED|CONNECTION_[A-Z_]+|INTERNET_DISCONNECTED|ADDRESS_UNREACHABLE))/i.test(safeClassificationInput)) {
    code = 'COMPUTER_BROWSER_NAVIGATION_NETWORK_FAILED';
  } else if (action === 'navigate') {
    code = 'COMPUTER_BROWSER_NAVIGATION_FAILED';
  } else if (action === 'inspect') {
    code = 'COMPUTER_BROWSER_PAGE_INSPECTION_FAILED';
  } else if (action === 'open_artifact') {
    code = 'COMPUTER_BROWSER_ARTIFACT_OPEN_FAILED';
  } else if (['click', 'fill', 'select', 'check', 'uncheck', 'press', 'upload_file'].includes(action)) {
    code = 'COMPUTER_BROWSER_CONTROL_ACTION_FAILED';
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
