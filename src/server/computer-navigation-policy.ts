const directNavigationRequest = /^\s*(?:(?:please|can you|could you|help me|i want you to)\s+)*(?:open|navigate(?:\s+to)?|go\s+to|visit|load|read|inspect|check|search|access|log\s+in\s+to|sign\s+in\s+to)\b|^\s*for this (?:(?:read[- ]only|public|end[- ]to[- ]end|e2e|browser|gmail)\s+){0,4}(?:task|test|check)\b[^\n]{0,180}\b(?:open|navigate|visit|load|read|inspect|check|search|access)\b|^\s*(?:please\s+)?use\s+(?:(?:the\s+)?browser(?:\s+user)?|(?:the\s+)?cloud\s+browser|(?:the\s+)?browser\s+on\s+(?:the\s+)?cloud\s+computer)[^\n]{0,180}\b(?:open|navigate(?:\s+to)?|go\s+to|visit|load|read|inspect|check|search|access)\b|^\s*(?:(?:请帮我|麻烦|帮我|请|你)?\s*(?:(?:在|用)(?:云电脑|浏览器)(?:里面|里)?\s*)?(?:直接)?(?:打开|访问|进入|导航到|前往|查看|读取|搜索|登录|登陆))/i;
const groupAcceptanceNavigationRequest = /^\s*(?:fresh\s+)?(?:(?:public|read[- ]only|end[- ]to[- ]end|e2e|multi[- ]bot|six[- ]bot|group|direct[- ]navigation)\s+){1,6}(?:group\s+)?(?:acceptance|test|check)\b[\s\S]{0,800}\bbrowser(?:\s+user)?[^\n]{0,180}\b(?:open|navigate(?:\s+to)?|go\s+to|visit|load|read|inspect|check|access)\b/i;
const deniedNavigationVerbs = /\b(?:do\s+not|don't|never|avoid)\s+(?:open|navigate|visit|load|access)|不要(?:打开|访问|进入|导航)|禁止(?:打开|访问|进入)/i;
const quotedSourceInstructions = /^\s*(?:(?:please|help me|can you)\s+)?(?:read|inspect|check|open)\s+(?:this|the)\s+(?:email|message|webpage|page|file|document|attachment)\b[^\n]{0,120}\b(?:says|contains|instructions?|写着|内容|要求)/i;
const openedQuotedSource = /^\s*(?:(?:please|help me|can you)\s+)?(?:read|inspect|check|open)\s+(?:this|the)\s+(?:email|message|webpage|page|file|document|attachment|邮件|消息|网页|页面|文件|文档|附件)\b[^\n]{0,120}[:：“”"']/i;
const urlPattern = /https?:\/\/[^\s<>"'`()，。；]+/gi;

const directBrowserTaskRequest = /(?:\b(?:use|through|via|in)\s+(?:the\s+)?(?:web\s+)?browser\b[\s\S]{0,180}\b(?:open|navigate|visit|search|read|review|inspect|check|browse|click|fill|complete|manage)\b|\b(?:open|navigate(?:\s+to)?|visit|search|read|review|inspect|check|browse|click|fill|complete|manage)\b[\s\S]{0,140}\b(?:website|webpage|web\s+page|browser|site|online|inbox|mailbox)\b|(?:使用|通过|在).{0,24}(?:浏览器|网页|网站|云电脑).{0,180}(?:打开|访问|浏览|导航|搜索|查找|阅读|查看|检查|点击|填写|完成|操作)|(?:打开|访问|浏览|搜索|查找|阅读|查看|检查|操作).{0,100}(?:网页|网站|浏览器|邮箱|收件箱|在线页面))/i;
const deniesBrowserTask = /\b(?:do\s+not|don't|never|avoid)\s+(?:use|open|navigate|browse)\s+(?:the\s+)?(?:web\s+)?browser\b|(?:不要|不准|禁止).{0,5}(?:使用|用|打开|访问|浏览|操作)(?:云电脑(?:里的|中的|上)?|网页)?浏览器/i;

/**
 * A short-lived permission derived only from the signed-in user's current
 * request. It authorizes ordinary Browser User interactions on any site;
 * the desktop Worker still blocks credential entry and routes consequential
 * controls through the existing approval flow.
 */
export function requestsBrowserTask(request: string): boolean {
  const text = typeof request === 'string' ? request.trim().slice(0, 20_000) : '';
  if (!text || deniesBrowserTask.test(text) || quotedSourceInstructions.test(text) || openedQuotedSource.test(text)) return false;
  return directBrowserTaskRequest.test(text) || requestsGmailReadDraftWorkflow(text);
}

/**
 * Narrow, run-scoped destinations directly requested by the signed-in user.
 * This is only used to skip a repetitive approval for browser navigation;
 * clicks, form input, and other computer actions remain reviewed separately.
 */
export function requestedNavigationOrigins(request: string): string[] {
  const text = typeof request === 'string' ? request.trim().slice(0, 20_000) : '';
  if (!text || !(directNavigationRequest.test(text) || groupAcceptanceNavigationRequest.test(text)) || deniedNavigationVerbs.test(text) || quotedSourceInstructions.test(text) || openedQuotedSource.test(text) || /^\s*(?:打开|查看|读取|检查)(?:这封|这个|该)?(?:邮件|消息|网页|页面|文件|文档|附件)[^\n]{0,120}(?:写着|内容|要求)/i.test(text)) return [];

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
  const serviceNameText = text.replace(urlPattern, ' ');
  const namesGoogle=/\b(?:open|navigate(?:\s+to)?|go\s+to|visit|load|search(?:\s+for)?|access|log\s+in\s+to|sign\s+in\s+to)\s+(?:the\s+)?google\b|(?:打开|访问|进入|导航到|前往|搜索|登录|登陆)\s*(?:谷歌|google)/i.test(serviceNameText);
  const namesGmail=/\b(?:open|navigate(?:\s+to)?|go\s+to|visit|load|access|log\s+in\s+to|sign\s+in\s+to)\s+(?:(?:my|the)\s+)?(?:gmail|google\s+mail)\b|(?:打开|访问|进入|导航到|前往|登录|登陆)\s*(?:我的\s*)?(?:gmail|google\s+mail|谷歌邮箱)/i.test(serviceNameText);
  if (namesGoogle) { addOrigin('https://google.com'); addOrigin('https://www.google.com'); }
  if (namesGmail) {
    addOrigin('https://mail.google.com');
    if (/\b(?:log[ -]?in|sign[ -]?in)\b|登录|登陆/i.test(text)) addOrigin('https://accounts.google.com');
  }
  return [...origins];
}

/** Narrow permission for reading unread Gmail rows and saving unsent reply drafts. */
export function requestsGmailReadDraftWorkflow(request: string): boolean {
  const text = typeof request === 'string' ? request.trim().slice(0, 20_000) : '';
  if (!text || quotedSourceInstructions.test(text) || openedQuotedSource.test(text)) return false;
  const namesGmail = /\b(?:gmail|google mail|mail\.google\.com)\b/i.test(text);
  const readsUnread = /\b(?:review|read|inspect|check)\b.{0,120}\b(?:unread|inbox)\b|\b(?:unread|inbox)\b.{0,120}\b(?:review|read|inspect|check)\b|(?:查看|读取|检查|审阅).{0,30}未读|未读.{0,30}(?:查看|读取|检查|审阅)/i.test(text);
  const draftsReplies = /\b(?:draft|save|write|compose)\b.{0,100}\b(?:reply|replies)\b|\b(?:reply|replies)\b.{0,100}\b(?:draft|save|write|compose)\b|(?:拟写|起草|撰写|保存).{0,30}(?:回复|回信|草稿)|(?:回复|回信).{0,30}(?:草稿|拟写|起草)/i.test(text);
  const explicitlyUnsent = /\b(?:unsent|never send|do not send|don't send|draft(?:s)? only)\b|(?:不要|不准|禁止|绝不).{0,8}发送|(?:仅|只).{0,8}(?:保存)?草稿/i.test(text);
  const deniesReadingOrDrafting = /\b(?:do not|don't|never)\s+(?:read|review|inspect|check|open|draft|write|compose)\b.{0,60}\b(?:unread|inbox|reply|replies)\b|(?:不要|不准|禁止).{0,8}(?:查看|读取|检查|审阅|打开).{0,16}(?:未读|收件箱|所有邮件|全部邮件|任何邮件|gmail|回复|回信)|(?:不要|不准|禁止).{0,8}(?:拟写|起草|撰写|草拟).{0,16}(?:回复|回信|草稿)|(?:不要|不准|禁止).{0,8}(?:回复|回信)(?:任何|所有|全部)?(?:邮件|消息|草稿)?/i.test(text);
  return namesGmail && readsUnread && draftsReplies && explicitlyUnsent && !deniesReadingOrDrafting;
}

/** Whether the owner explicitly asked the Agent to stop and hand off at sign-in. */
export function requestsUserSignInHandoff(request: string): boolean {
  const text = typeof request === 'string' ? request.trim().slice(0, 20_000) : '';
  if (!text) return false;
  const chinese = /(?:登录|登陆).{0,60}(?:停下(?:来)?|暂停|停止|让我(?:去)?(?:操作|登录|接管)|由我(?:操作|登录|接管)|我来(?:操作|登录|接管)|(?:把)?(?:云电脑|电脑|浏览器|控制权).{0,20}(?:交给|留给)我.{0,20}(?:操作|登录|接管)?)|(?:停下(?:来)?|暂停|停止).{0,40}(?:让我|由我|我来).{0,20}(?:登录|登陆|操作|接管)/i;
  const english = /(?:\b(?:stop|pause|wait)\b.{0,60}\b(?:until|while|for)\s+(?:i|me|the user)\b.{0,30}\b(?:sign[ -]?in|log[ -]?in|take control)\b|\b(?:let|allow)\s+me\b.{0,40}\b(?:sign[ -]?in|log[ -]?in|take control)\b|\b(?:sign[ -]?in|log[ -]?in)\b.{0,50}\b(?:i(?:'ll| will)|let me|user can|take control)\b)/i;
  return chinese.test(text) || english.test(text);
}

/** A short follow-up that refers to continuing the same handoff rather than authorizing a new task. */
export function continuesUserSignInHandoff(request: string): boolean {
  const text = typeof request === 'string' ? request.trim().slice(0, 20_000) : '';
  if (!text) return false;
  const chineseApproval = /(?:不需要|不用|别|不要).{0,24}(?:批准|审批)|(?:每步|每一步|每次).{0,12}(?:让我|我)?(?:批准|审批)/i.test(text);
  const chineseContinuation = /(?:直接.{0,12}(?:打开|进入|去)|继续.{0,12}(?:打开|进入|操作)?)/i.test(text);
  const englishApproval = /(?:don't|do not|stop asking).{0,48}(?:approve|approval)|(?:every|each)\s+step.{0,20}(?:approve|approval)/i.test(text);
  const englishContinuation = /(?:open|go ahead|continue|proceed).{0,24}(?:it|there|directly|now)?/i.test(text);
  return (chineseApproval && chineseContinuation) || (englishApproval && englishContinuation);
}
