const authRoute = /(?:^|[./_-])(?:login|log-in|signin|sign-in|oauth|sso|challenge|captcha|verify|verification|mfa)(?:$|[./?_-])/i;
const credentialControl = /(?:password|passcode|one.?time.?code|verification.?code|security.?code|recovery.?code|\botp\b|\bmfa\b|username|user.?name|account.?identifier|密码|口令|验证码|安全码|恢复码|用户名)/i;
const emailControl = /(?:email.?address|e-mail|邮箱地址)/i;
const loginCopy = /(?:sign\s*in|log\s*in|verify (?:it'?s|your)|verification required|enter (?:your )?(?:code|password)|two.?factor|multi.?factor|登录|登陆|验证身份|输入验证码)/i;
const consequentialControl = /(?:\b(?:send|delete|remove|trash|archive|purchase|buy|checkout|pay|payment|transfer|submit|publish|post|invite|share|revoke|grant|unsubscribe|cancel subscription|close account|sign out|log out|change password|place order|confirm purchase|approve payment)\b|(?:发送|删除|移除|回收站|归档|购买|结账|付款|支付|转账|提交|发布|发帖|邀请|共享|撤销|授权|退订|取消订阅|注销账户|退出登录|修改密码|下单|确认购买|批准付款))/i;

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
      || /^(?:current-password|new-password|one-time-code|username)$/i.test(normalized(control?.autocomplete))
      || credentialControl.test(identity);
  });
  const loginForm = loginCopy.test(`${title} ${String(text).slice(0, 1200)}`) && Array.isArray(controls) && controls.some(control => emailControl.test([control?.type, control?.name, control?.autocomplete, control?.ariaLabel, control?.label, control?.placeholder].map(normalized).join(' ')));
  return route || sensitive || loginForm;
}

/** Return whether a browser action must use the existing screenshot-bound approval. */
export function browserActionRequiresApproval({ action, input = {}, control = {} } = {}) {
  const target = normalized(input.target);
  const controlText = [control.text, control.ariaLabel, control.title, control.name, control.href].map(normalized).join(' ');
  const label = `${target} ${controlText}`;
  const isSubmitClick = action === 'click' && /^submit$/i.test(normalized(control.type));
  const isSearchAction = /\b(?:search|query|find|filter)\b|搜索|查找|筛选/i.test(label)
    || /^(?:search|searchbox)$/i.test(normalized(control.type))
    || /^(?:search|searchbox)$/i.test(normalized(control.role));
  const consequenceLabel = isSubmitClick && isSearchAction ? label.replace(/\bsubmit\b|提交/gi, '') : label;
  if (consequentialControl.test(consequenceLabel)) return true;
  if (isSubmitClick && !isSearchAction) return true;
  if (action === 'press' && /^enter$/i.test(normalized(input.key))) {
    const searchTarget = /\b(?:search|query|find|filter)\b|搜索|查找|筛选/i.test(label);
    const searchControl = /^(?:search|searchbox)$/i.test(normalized(control.type)) || /\bsearch\b/i.test(normalized(control.role));
    return !(searchTarget || searchControl);
  }
  return false;
}

export function isCredentialEntry({ input = {}, control = {} } = {}) {
  const identity = [input.target, control.type, control.name, control.autocomplete, control.ariaLabel, control.label, control.placeholder].map(normalized).join(' ');
  return /^password$/i.test(normalized(control.type))
    || /^(?:current-password|new-password|one-time-code|username)$/i.test(normalized(control.autocomplete))
    || credentialControl.test(identity);
}
