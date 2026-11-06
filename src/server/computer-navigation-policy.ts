const directNavigationRequest = /^\s*(?:(?:please|can you|could you|help me|i want you to)\s+)*(?:open|navigate(?:\s+to)?|go\s+to|visit|load|read|inspect|check|search|access|log\s+in\s+to|sign\s+in\s+to)\b|^\s*for this (?:task|test),?[^\n]{0,100}\b(?:open|navigate|visit|load|read|inspect|check|search|access)\b|^\s*(?:(?:请|麻烦|帮我|请帮我|你)?(?:直接)?(?:打开|访问|进入|导航到|前往|查看|读取|搜索|登录|登陆))/i;
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

  const origins = new Set<string>();
  for (const match of text.matchAll(urlPattern)) {
    const raw = match[0].replace(/[.,!?;:]+$/u, '');
    try {
      const url = new URL(raw);
      if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) origins.add(url.origin);
    } catch { /* Ignore malformed destinations. */ }
    if (origins.size >= 4) break;
  }

  // A common service name can stand in for a URL when the user directly asks
  // to open that service. Prefer Gmail's own host over generic Google Search.
  if (origins.size === 0 && /\b(?:gmail|google\s+mail)\b|谷歌邮箱/i.test(text)) origins.add('https://mail.google.com');
  else if (origins.size === 0 && /\bgoogle\b|谷歌/i.test(text)) origins.add('https://www.google.com');
  return [...origins];
}
