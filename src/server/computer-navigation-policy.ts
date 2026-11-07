const directNavigationRequest = /^\s*(?:(?:please|can you|could you|help me|i want you to)\s+)*(?:open|navigate(?:\s+to)?|go\s+to|visit|load|read|inspect|check|search|access|log\s+in\s+to|sign\s+in\s+to)\b|^\s*for this (?:task|test),?[^\n]{0,100}\b(?:open|navigate|visit|load|read|inspect|check|search|access)\b|^\s*(?:(?:请帮我|麻烦|帮我|请|你)?\s*(?:(?:在|用)(?:云电脑|浏览器)(?:里面|里)?\s*)?(?:直接)?(?:打开|访问|进入|导航到|前往|查看|读取|搜索|登录|登陆))/i;
const deniedNavigationVerbs = /\b(?:do\s+not|don't|never|avoid)\s+(?:open|navigate|visit|load|access)|不要(?:打开|访问|进入|导航)|禁止(?:打开|访问|进入)/i;
const quotedSourceInstructions = /^\s*(?:(?:please|help me|can you)\s+)?(?:read|inspect|check|open)\s+(?:this|the)\s+(?:email|message|webpage|page|file|document|attachment)\b[^\n]{0,120}\b(?:says|contains|instructions?|写着|内容|要求)/i;
const openedQuotedSource = /^\s*(?:(?:please|help me|can you)\s+)?(?:read|inspect|check|open)\s+(?:this|the)\s+(?:email|message|webpage|page|file|document|attachment|邮件|消息|网页|页面|文件|文档|附件)\b[^\n]{0,120}[:：“”"']/i;
const urlPattern = /https?:\/\/[^\s<>"'`()，。；]+/gi;

/**
 * Narrow, run-scoped destinations directly requested by the signed-in user.
 * This is only used to skip a repetitive approval for browser navigation;
 * clicks, form input, and other computer actions remain reviewed separately.
 */
export function requestedNavigationOrigins(request: string): string[] {
  const text = typeof request === 'string' ? request.trim().slice(0, 20_000) : '';
  if (!text || !directNavigationRequest.test(text) || deniedNavigationVerbs.test(text) || quotedSourceInstructions.test(text) || openedQuotedSource.test(text) || /^\s*(?:打开|查看|读取|检查)(?:这封|这个|该)?(?:邮件|消息|网页|页面|文件|文档|附件)[^\n]{0,120}(?:写着|内容|要求)/i.test(text)) return [];

  const origins = new Set<string>(),addOrigin=(origin:string)=>{if(origins.size<4)origins.add(origin)};
  for (const match of text.matchAll(urlPattern)) {
    const raw = match[0].replace(/[.,!?;:]+$/u, '');
    try {
      const url = new URL(raw);
      if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) addOrigin(url.origin);
    } catch { /* Ignore malformed destinations. */ }
    if (origins.size >= 4) break;
  }

  // A common service name can stand in for a URL when the user directly asks
  // to open that service. Preserve named destinations alongside explicit URLs
  // and preserve both hosts when a request names Google and Gmail.
  const namesGoogle=/\bgoogle\b|谷歌/i.test(text),namesGmail=/\b(?:gmail|google\s+mail)\b|谷歌邮箱/i.test(text);
  if (namesGoogle) { addOrigin('https://google.com'); addOrigin('https://www.google.com'); }
  if (namesGmail) {
    addOrigin('https://mail.google.com');
    if (/\b(?:log[ -]?in|sign[ -]?in)\b|登录|登陆/i.test(text)) addOrigin('https://accounts.google.com');
  }
  return [...origins];
}

/** Whether the owner explicitly asked the Agent to stop and hand off at sign-in. */
export function requestsUserSignInHandoff(request: string): boolean {
  const text = typeof request === 'string' ? request.trim().slice(0, 20_000) : '';
  if (!text) return false;
  const chinese = /(?:登录|登陆).{0,60}(?:停下来|暂停|停止|让我(?:去)?(?:操作|登录|接管)|由我(?:操作|登录|接管)|我来(?:操作|登录|接管)|(?:把)?(?:云电脑|电脑|浏览器|控制权).{0,20}(?:交给|留给)我.{0,20}(?:操作|登录|接管)?)|(?:停下来|暂停|停止).{0,40}(?:让我|由我|我来).{0,20}(?:登录|登陆|操作|接管)/i;
  const english = /(?:\b(?:stop|pause|wait)\b.{0,60}\b(?:until|while|for)\s+(?:i|me|the user)\b.{0,30}\b(?:sign[ -]?in|log[ -]?in|take control)\b|\b(?:let|allow)\s+me\b.{0,40}\b(?:sign[ -]?in|log[ -]?in|take control)\b|\b(?:sign[ -]?in|log[ -]?in)\b.{0,50}\b(?:i(?:'ll| will)|let me|user can|take control)\b)/i;
  return chinese.test(text) || english.test(text);
}
