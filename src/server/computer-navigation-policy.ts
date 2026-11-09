const directNavigationRequest = /^\s*(?:(?:please|can you|could you|help me|i want you to)\s+)*(?:open|navigate(?:\s+to)?|go\s+to|visit|load|read|inspect|check|search|access|log\s+in\s+to|sign\s+in\s+to)\b|^\s*for this (?:(?:read[- ]only|public|end[- ]to[- ]end|e2e|browser|gmail)\s+){0,4}(?:task|test|check)\b[^\n]{0,180}\b(?:open|navigate|visit|load|read|inspect|check|search|access)\b|^\s*(?:please\s+)?use\s+(?:(?:the\s+)?browser(?:\s+user)?|(?:the\s+)?cloud\s+browser|(?:the\s+)?browser\s+on\s+(?:the\s+)?cloud\s+computer)[^\n]{0,180}\b(?:open|navigate(?:\s+to)?|go\s+to|visit|load|read|inspect|check|search|access)\b|^\s*(?:(?:请帮我|麻烦|帮我|请|你)?\s*(?:(?:在|用)(?:云电脑|浏览器)(?:里面|里)?\s*)?(?:直接)?(?:打开|访问|进入|导航到|前往|查看|读取|搜索|登录|登陆))/i;
const groupAcceptanceNavigationRequest = /^\s*(?:fresh\s+)?(?:(?:public|read[- ]only|end[- ]to[- ]end|e2e|multi[- ]bot|six[- ]bot|group|direct[- ]navigation)\s+){1,6}(?:group\s+)?(?:acceptance|test|check)\b[\s\S]{0,800}\bbrowser(?:\s+user)?[^\n]{0,180}\b(?:open|navigate(?:\s+to)?|go\s+to|visit|load|read|inspect|check|access)\b/i;
const deniedNavigationVerbs = /\b(?:do\s+not|don't|never|avoid)\s+(?:open|navigate|visit|load|access)|不要(?:打开|访问|进入|导航)|禁止(?:打开|访问|进入)/i;
const quotedSourceInstructions = /^\s*(?:(?:please|help me|can you)\s+)?(?:read|inspect|check|open)\s+(?:this|the)\s+(?:email|message|webpage|page|file|document|attachment)\b[^\n]{0,120}\b(?:says|contains|instructions?|写着|内容|要求)/i;
const openedQuotedSource = /^\s*(?:(?:please|help me|can you)\s+)?(?:read|inspect|check|open)\s+(?:this|the)\s+(?:email|message|webpage|page|file|document|attachment|邮件|消息|网页|页面|文件|文档|附件)\b[^\n]{0,120}[:：“”"']/i;
const quotedChineseSourceInstructions = /^\s*(?:请)?(?:打开|查看|读取|检查)(?:这封|这个|该)?(?:邮件|消息|网页|页面|文件|文档|附件)[^\n]{0,100}(?:里面写着|内容是|要求|指示|说[:：])/iu;
const urlPattern = /https?:\/\/[^\s<>"'`()，。；]+/gi;

const directBrowserTaskRequest = /(?:\b(?:use|through|via|in)\s+(?:the\s+)?(?:web\s+)?browser\b[\s\S]{0,180}\b(?:open|navigate|visit|search|read|review|inspect|check|browse|click|fill|complete|manage|draft|compose|reply)\b|\b(?:open|navigate(?:\s+to)?|visit|search|read|review|inspect|check|browse|click|fill|complete|manage|draft|compose|reply)\b[\s\S]{0,160}\b(?:website|webpage|web\s+page|browser|site|online|inbox|mailbox|email|e-mail|mail|gmail|calendar|drive|portal|dashboard|application|app|service|system|platform|form|account|page|url)\b|\b(?:website|webpage|web\s+page|browser|site|online|inbox|mailbox|email|e-mail|mail|gmail|calendar|drive|portal|dashboard|application|app|service|system|platform|form|account|page|url)\b[\s\S]{0,160}\b(?:open|navigate|visit|search|read|review|inspect|check|browse|click|fill|complete|manage|draft|compose|reply)\b|(?:使用|通过|在).{0,24}(?:浏览器|网页|网站|云电脑).{0,180}(?:打开|访问|浏览|导航|搜索|查找|阅读|查看|检查|点击|填写|完成|操作|拟写|起草|回复)|(?:打开|访问|浏览|搜索|查找|阅读|查看|检查|操作|拟写|起草|回复).{0,120}(?:网页|网站|浏览器|邮箱|收件箱|邮件|Gmail|谷歌邮箱|在线页面|日历|网盘|门户|后台|系统|平台|应用|工作区|表单)|(?:在|用|通过).{0,24}[\p{L}\p{N}][\p{L}\p{N}._-]{1,60}(?:里|中|上|系统|平台|应用|工作区|网页|网站|邮箱|收件箱)?[\s\S]{0,100}(?:打开|访问|浏览|导航|搜索|查找|阅读|查看|检查|操作|拟写|起草|回复|填写|管理))/iu;
// Chinese users commonly describe the outcome rather than naming a browser or
// site (for example, "找一封最近未读的邮件，点击进去看看"). Treat a direct
// request about online content as Browser User work so the model gets the same
// short-lived task capability as an English "search Gmail" request.
const directChineseBrowserTaskRequest = /(?:(?:打开|访问|浏览|导航到|搜索|查找|找|阅读|读取|查看|检查|点击|点开|进入|填写|选择|提交|管理|操作|拟写|起草|撰写|回复|筛选).{0,120}(?:网页|网站|浏览器|邮箱|收件箱|未读邮件|邮件|Gmail|谷歌邮箱|日历|网盘|云盘|门户|后台|系统|平台|应用|工作区|表单|工单|在线页面|页面)|(?:网页|网站|浏览器|邮箱|收件箱|未读邮件|邮件|Gmail|谷歌邮箱|日历|网盘|云盘|门户|后台|系统|平台|应用|工作区|表单|工单|在线页面|页面).{0,120}(?:打开|访问|浏览|导航|搜索|查找|找|阅读|读取|查看|检查|点击|点开|进入|填写|选择|提交|管理|操作|拟写|起草|撰写|回复|筛选))/iu;
const genericBrowserTaskPatterns = [
  /\b(?:open|go\s+to|navigate(?:\s+to)?|visit|load|access|launch)\s+(?:my\s+|the\s+)?(?<destination>[\p{L}\p{N}][\p{L}\p{N}._-]{1,60})\b/iu,
  /\b(?:search|find|look\s+up|check|review|read|view|inspect|browse|manage)\b[\s\S]{0,80}\b(?:in|on|at|from|using|via)\s+(?:my\s+|the\s+)?(?<destination>[\p{L}\p{N}][\p{L}\p{N}._-]{1,60})\b/iu,
  /\b(?:in|on|at|from|using|via)\s+(?:my\s+|the\s+)?(?<destination>\p{Lu}[\p{L}\p{N}._-]{1,60})\b[\s\S]{0,100}\b(?:search|find|look\s+up|check|review|read|view|inspect|browse|manage)\b/u,
  /\b(?:search|find|look\s+up|check|review|read|view|inspect|browse|manage)\s+(?:my\s+|the\s+)?(?<destination>\p{Lu}[\p{L}\p{N}._-]{1,60})\b(?!['’])/u,
  /\b(?:search|find|look\s+up|check|review|read|view|inspect|browse|manage)\s+(?:my\s+|the\s+)?(?<destination>[\p{L}\p{N}][\p{L}\p{N}._-]{1,60})\s+(?:for|about|with|and|then)\b/iu,
];
const nonBrowserDestinations = new Set([
  'a','an','the','my','your','this','that','these','those','it','them','local','new','latest','recent','all','unread',
  'file','files','document','documents','attachment','attachments','email','emails','message','messages','note','notes',
  'folder','directory','downloads','desktop','finder','computer','terminal','browser','tab','window','page','webpage',
  'report','invoice','pdf','image','photo','picture','video','spreadsheet','workbook','sheet','csv','artifact','output',
  'result','code','script','source','repository','repo','project','task','monday','tuesday','wednesday','thursday','friday',
  'saturday','sunday','january','february','march','april','may','june','july','august','september','october','november','december',
]);
const deniesBrowserTask = /\b(?:do\s+not|don't|never|avoid)\s+(?:use|open|navigate|browse)\s+(?:the\s+)?(?:web\s+)?browser\b|(?:不要|不准|禁止).{0,5}(?:使用|用|打开|访问|浏览|操作)(?:云电脑(?:里的|中的|上)?|网页)?浏览器/i;

function namesUnregisteredBrowserDestination(text:string):boolean{
  return genericBrowserTaskPatterns.some(pattern=>{
    const destination=pattern.exec(text)?.groups?.destination?.toLowerCase();
    return Boolean(destination&&!nonBrowserDestinations.has(destination)&&!/\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|md|png|jpe?g|gif|webp|mp[34])$/i.test(destination));
  });
}

/**
 * A short-lived permission derived only from the signed-in user's current
 * request. It recognizes direct site/app tasks even when the user doesn't
 * explicitly say "browser" and authorizes task-needed Browser User interactions
 * on any site; the desktop Worker stops at authentication and credential entry.
 */
export function requestsBrowserTask(request: string): boolean {
  const text = typeof request === 'string' ? request.trim().slice(0, 20_000) : '';
  if (!text || deniesBrowserTask.test(text) || quotedSourceInstructions.test(text) || openedQuotedSource.test(text) || quotedChineseSourceInstructions.test(text)) return false;
  // Explicit destinations (including arbitrary URLs and named services) and
  // plain-language mail/site tasks all use the same per-run browser scope.
  // Gmail's specialized read/draft policy is an additional task instruction,
  // not a prerequisite for using ordinary browser controls.
  return directBrowserTaskRequest.test(text) || directChineseBrowserTaskRequest.test(text) || namesUnregisteredBrowserDestination(text) || requestedNavigationOrigins(text).length > 0;
}

/**
 * Narrow, run-scoped destinations directly requested by the signed-in user.
 * This origin scope controls where the run may navigate. The broader,
 * run-scoped Browser User permission for routine page controls is represented
 * separately by requestsBrowserTask and is not restricted to these origins.
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

/** Extra task guidance for Gmail unread review and reply drafting. Browser access itself is site-generic. */
export function requestsGmailReadDraftWorkflow(request: string): boolean {
  const text = typeof request === 'string' ? request.trim().slice(0, 20_000) : '';
  if (!text || quotedSourceInstructions.test(text) || openedQuotedSource.test(text)) return false;
  const namesGmail = /\b(?:gmail|google mail|mail\.google\.com)\b/i.test(text);
  const readsUnread = /\b(?:review|read|inspect|check)\b.{0,120}\b(?:unread|inbox)\b|\b(?:unread|inbox)\b.{0,120}\b(?:review|read|inspect|check)\b|(?:查看|读取|检查|审阅).{0,30}未读|未读.{0,30}(?:查看|读取|检查|审阅)/i.test(text);
  const draftsReplies = /\b(?:draft|save|write|compose)\b.{0,100}\b(?:reply|replies)\b|\b(?:reply|replies)\b.{0,100}\b(?:draft|save|write|compose)\b|(?:拟写|起草|撰写|保存).{0,30}(?:回复|回信|草稿)|(?:回复|回信).{0,30}(?:草稿|拟写|起草)/i.test(text);
  const sendIntentText = text
    .replace(/\b(?:never|do not|don't|draft(?:s)? only)\b[\s\S]{0,32}\b(?:send|forward)\b(?:\s*(?:,|or|and)\s*\b(?:send|forward)\b)*/gi, ' ')
    .replace(/(?:不要|不准|禁止|绝不|别|仅|只).{0,8}(?:发送|转发)/g, ' ');
  const explicitlySending = /\b(?:send|forward)\b|(?:发送|转发)/i.test(sendIntentText);
  const deniesReadingOrDrafting = /\b(?:do not|don't|never)\s+(?:read|review|inspect|check|open|draft|write|compose)\b.{0,60}\b(?:unread|inbox|reply|replies)\b|(?:不要|不准|禁止).{0,8}(?:查看|读取|检查|审阅|打开).{0,16}(?:未读|收件箱|所有邮件|全部邮件|任何邮件|gmail|回复|回信)|(?:不要|不准|禁止).{0,8}(?:拟写|起草|撰写|草拟).{0,16}(?:回复|回信|草稿)|(?:不要|不准|禁止).{0,8}(?:回复|回信)(?:任何|所有|全部)?(?:邮件|消息|草稿)?/i.test(text);
  // A user request to draft a reply means save it as a draft; it does not
  // require an extra "do not send" phrase. Sending stays independently gated.
  return namesGmail && readsUnread && draftsReplies && !explicitlySending && !deniesReadingOrDrafting;
}

/** Whether the owner explicitly asked the Agent to stop and hand off at sign-in. */
export function requestsUserSignInHandoff(request: string): boolean {
  const text = typeof request === 'string' ? request.trim().slice(0, 20_000) : '';
  if (!text) return false;
  const chinese = /(?:登录|登陆).{0,60}(?:停下(?:来)?|暂停|停止|让我(?:去)?(?:操作|登录|接管)|由我(?:操作|登录|接管)|我来(?:操作|登录|接管)|(?:把)?(?:云电脑|电脑|浏览器|控制权).{0,20}(?:交给|留给)我.{0,20}(?:操作|登录|接管)?)|(?:停下(?:来)?|暂停|停止).{0,40}(?:让我|由我|我来).{0,20}(?:登录|登陆|操作|接管)/i;
  const english = /(?:\b(?:stop|pause|wait)\b.{0,60}\b(?:until|while|for)\s+(?:i|me|the user)\b.{0,30}\b(?:sign[ -]?in|log[ -]?in|take control)\b|\b(?:let|allow)\s+me\b.{0,40}\b(?:sign[ -]?in|log[ -]?in|take control)\b|\b(?:sign[ -]?in|log[ -]?in)\b.{0,50}\b(?:i(?:'ll| will)|let me|user can|take control)\b)/i;
  return chinese.test(text) || english.test(text);
}

/** A short owner message that explicitly continues the immediately preceding Browser User task. */
export function continuesUserSignInHandoff(request: string): boolean {
  const text = typeof request === 'string' ? request.trim().slice(0, 20_000) : '';
  if (!text) return false;
  // A short continuation can resume the same task after a long sign-in pause.
  // It never grants scope by itself; the caller must find an unbroken chain to
  // a direct Browser User request from this same Bot.
  if (/^(?:继续(?:啊|吧|一下|执行|刚才的任务|这个任务)?|接着(?:来|做|继续)?|(?:我)?(?:已|已经)?(?:登录|登陆)(?:成功|完成|好了|了)?(?:[，,、 ]*(?:并|然后|且)?[，,、 ]*(?:点击|点了|选择)?\s*(?:Return to Bot|归还控制权|把控制权还给你|继续(?:吧)?)?)?|控制权(?:已经|已)?(?:还给你|归还)(?:[，,、 ]*继续(?:吧)?)?|(?:i(?:'ve| have)?\s+)?(?:signed\s+in|logged\s+in)(?:\s+successfully)?(?:\s+and\s+(?:clicked\s+)?(?:return\s+to\s+bot|returned\s+control))?|(?:i\s+)?returned\s+control(?:\s+and\s+continue)?|continue(?:\s+(?:the\s+)?(?:task|now))?|resume(?:\s+(?:the\s+)?task)?)\s*[。.!！]?$/i.test(text)) return true;
  const chineseApproval = /(?:不需要|不用|别|不要).{0,24}(?:批准|审批)|(?:每步|每一步|每次).{0,12}(?:让我|我)?(?:批准|审批)/i.test(text);
  const chineseContinuation = /(?:直接.{0,12}(?:打开|进入|去)|继续.{0,12}(?:打开|进入|操作)?)/i.test(text);
  const englishApproval = /(?:don't|do not|stop asking).{0,48}(?:approve|approval)|(?:every|each)\s+step.{0,20}(?:approve|approval)/i.test(text);
  const englishContinuation = /(?:open|go ahead|continue|proceed).{0,24}(?:it|there|directly|now)?/i.test(text);
  return (chineseApproval && chineseContinuation) || (englishApproval && englishContinuation);
}

/**
 * Return the originating direct Browser User request only when the current
 * user message explicitly continues an unbroken same-Bot follow-up chain.
 * An unrelated user prompt breaks the chain; webpage text is never included
 * in this history and cannot grant permission.
 */
export function continuedBrowserTaskRequest(request: string, previousPrompts: readonly string[] = []): string | null {
  if (!continuesUserSignInHandoff(request)) return null;
  for (const previous of [...previousPrompts].reverse()) {
    if (requestsBrowserTask(previous)) return previous;
    if (continuesUserSignInHandoff(previous)) continue;
    return null;
  }
  return null;
}
