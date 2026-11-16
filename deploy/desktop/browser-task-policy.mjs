const authRoute = /(?:^|[./_-])(?:login|log-in|signin|sign-in|oauth|sso|challenge|captcha|mfa)(?:$|[/?#._-])/i;
const identityHost = /^(?:auth|identity|login|signin|sso)\./i;
const credentialControl = /(?:password|passcode|one.?time.?code|verification.?code|security.?code|recovery.?code|\botp\b|\bmfa\b|密码|口令|验证码|安全码|恢复码)/i;
const identityControl = /(?:username|user.?name|account.?identifier|email(?:.?address)?|e-mail|邮箱|用户名)/i;
const loginCopy = /(?:sign\s*in|log\s*in|verify your identity|verification required|enter (?:your )?(?:code|password)|two.?factor|multi.?factor|choose (?:an? )?account|select (?:an? )?account|use another account|continue with (?:google|microsoft|apple)|登录|登陆|验证身份|输入验证码|选择账号|选择帐户|使用其他账号)/i;
function normalized(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
}

export function isAuthenticationChallenge({ url = '', title = '', headings = [], text = '', controls = [], humanChallenge = false } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (humanChallenge) return true;
  const route = parsed.hostname === 'accounts.google.com' || identityHost.test(parsed.hostname) || authRoute.test(parsed.hostname) || authRoute.test(parsed.pathname);
  // Match account/login language in the title or visible page headings, not
  // anywhere in inbox/document content. A message subject such as "New sign-in
  // on Linux" must not suspend every subsequent click in Gmail.
  const authenticationCopy = loginCopy.test(`${title} ${Array.isArray(headings) ? headings.join(' ') : ''}`);
  const sensitive = Array.isArray(controls) && controls.some(control => {
    const identity = [control?.type, control?.name, control?.autocomplete, control?.ariaLabel, control?.label, control?.placeholder].map(normalized).join(' ');
    return /^password$/i.test(normalized(control?.type))
      || /^(?:current-password|new-password|one-time-code)$/i.test(normalized(control?.autocomplete))
      || credentialControl.test(identity);
  });
  const identityField = Array.isArray(controls) && controls.some(control => identityControl.test([control?.type, control?.name, control?.autocomplete, control?.ariaLabel, control?.label, control?.placeholder].map(normalized).join(' ')));
  const passwordManagement = /(?:change|new|update|reset)\s+(?:your\s+)?password|(?:更改|修改|设置|重置).{0,6}密码/i.test(`${title} ${Array.isArray(headings) ? headings.join(' ') : ''}`)
    || (Array.isArray(controls) && controls.some(control => normalized(control?.autocomplete) === 'new-password'));
  const passwordEntry = Array.isArray(controls) && controls.some(control => /^password$/i.test(normalized(control?.type)) && !passwordManagement);
  return route || humanChallenge || passwordEntry || (sensitive && authenticationCopy) || (authenticationCopy && identityField);
}
