const authRoute = /(?:^|[./_-])(?:login|log-in|signin|sign-in|oauth|sso|challenge|captcha|verify|verification|mfa)(?:$|[./?_-])/i;
const credentialControl = /(?:password|passcode|one.?time.?code|verification.?code|security.?code|recovery.?code|\botp\b|\bmfa\b|密码|口令|验证码|安全码|恢复码)/i;
const identityControl = /(?:username|user.?name|account.?identifier|email(?:.?address)?|e-mail|邮箱|用户名)/i;
const loginCopy = /(?:sign\s*in|log\s*in|verify (?:it'?s|your)|verification required|enter (?:your )?(?:code|password)|two.?factor|multi.?factor|登录|登陆|验证身份|输入验证码)/i;
function normalized(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
}

export function isAuthenticationChallenge({ url = '', title = '', text = '', controls = [], humanChallenge = false } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (humanChallenge) return true;
  const route = authRoute.test(parsed.hostname) || authRoute.test(parsed.pathname);
  const sensitive = Array.isArray(controls) && controls.some(control => {
    const identity = [control?.type, control?.name, control?.autocomplete, control?.ariaLabel, control?.label, control?.placeholder].map(normalized).join(' ');
    return /^password$/i.test(normalized(control?.type))
      || /^(?:current-password|new-password|one-time-code)$/i.test(normalized(control?.autocomplete))
      || credentialControl.test(identity);
  });
  const loginForm = loginCopy.test(`${title} ${String(text).slice(0, 1200)}`) && Array.isArray(controls) && controls.some(control => identityControl.test([control?.type, control?.name, control?.autocomplete, control?.ariaLabel, control?.label, control?.placeholder].map(normalized).join(' ')));
  return route || sensitive || loginForm;
}

/**
 * An explicitly requested Browser User task is authorized for the full task
 * duration, across sites and controls. Sign-in and credential handoff are
 * enforced separately above; page controls are not kept in a per-site or
 * per-control approval list.
 */
export function browserActionRequiresApproval() {
  return false;
}

export function isCredentialEntry({ input = {}, control = {} } = {}) {
  const identity = [input.target, control.type, control.name, control.autocomplete, control.ariaLabel, control.label, control.placeholder].map(normalized).join(' ');
  return /^password$/i.test(normalized(control.type))
    || /^(?:current-password|new-password|one-time-code)$/i.test(normalized(control.autocomplete))
    || credentialControl.test(identity);
}
