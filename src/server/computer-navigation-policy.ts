const directNavigationRequest = /^\s*(?:(?:please|can you|could you|help me|i want you to)\s+)*(?:open|navigate(?:\s+to)?|go\s+to|visit|load|read|inspect|check|search|access|log\s+in\s+to|sign\s+in\s+to)\b|^\s*for this (?:(?:read[- ]only|public|end[- ]to[- ]end|e2e|browser|gmail)\s+){0,4}(?:task|test|check)\b[^\n]{0,180}\b(?:open|navigate|visit|load|read|inspect|check|search|access)\b|^\s*(?:please\s+)?use\s+(?:(?:the\s+)?browser(?:\s+user)?|(?:the\s+)?cloud\s+browser|(?:the\s+)?browser\s+on\s+(?:the\s+)?cloud\s+computer)[^\n]{0,180}\b(?:open|navigate(?:\s+to)?|go\s+to|visit|load|read|inspect|check|search|access)\b|^\s*(?:(?:请帮我|麻烦|帮我|请|你)?\s*(?:(?:在|用)(?:云电脑|浏览器)(?:里面|里)?\s*)?(?:直接)?(?:打开|访问|进入|导航到|前往|查看|读取|搜索|登录|登陆))/i;
const groupAcceptanceNavigationRequest = /^\s*(?:fresh\s+)?(?:(?:public|read[- ]only|end[- ]to[- ]end|e2e|multi[- ]bot|six[- ]bot|group|direct[- ]navigation)\s+){1,6}(?:group\s+)?(?:acceptance|test|check)\b[\s\S]{0,800}\bbrowser(?:\s+user)?[^\n]{0,180}\b(?:open|navigate(?:\s+to)?|go\s+to|visit|load|read|inspect|check|access)\b/i;
const deniedNavigationVerbs = /\b(?:do\s+not|don't|never|avoid)\s+(?:open|navigate|visit|load|access)|不要(?:打开|访问|进入|导航)|禁止(?:打开|访问|进入)/i;
const quotedSourceInstructions = /^\s*(?:(?:please|help me|can you)\s+)?(?:read|inspect|check|open)\s+(?:this|the)\s+(?:email|message|webpage|page|file|document|attachment)\b[^\n]{0,120}\b(?:says|contains|instructions?|写着|内容|要求)/i;
const openedQuotedSource = /^\s*(?:(?:please|help me|can you)\s+)?(?:read|inspect|check|open)\s+(?:this|the)\s+(?:email|message|webpage|page|file|document|attachment|邮件|消息|网页|页面|文件|文档|附件)\b[^\n]{0,120}[:：“”"']/i;
const quotedChineseSourceInstructions = /^\s*(?:请)?(?:打开|查看|读取|检查)(?:这封|这个|该)?(?:邮件|消息|网页|页面|文件|文档|附件)[^\n]{0,100}(?:里面写着|内容是|要求|指示|说[:：])/iu;
// This only recognizes direct Browser task wording for continuation context;
// destination schemes are passed through to Chromium without an HTTP(S) list.
const urlPattern = /\b[a-z][a-z\d+.-]*:[^\s<>"'`()，。；]+/i;

const directBrowserTaskRequest = /(?:\b(?:use|through|via|in)\s+(?:the\s+)?(?:web\s+)?browser\b[\s\S]{0,180}\b(?:open|navigate|visit|search|read|review|inspect|check|browse|click|fill|upload|attach|complete|manage|draft|compose|reply)\b|\b(?:open|navigate(?:\s+to)?|visit|search|read|review|inspect|check|browse|click|fill|upload|attach|complete|manage|draft|compose|reply)\b[\s\S]{0,160}\b(?:website|webpage|web\s+page|browser|site|online|inbox|mailbox|email|e-mail|mail|gmail|calendar|drive|portal|dashboard|application|app|service|system|platform|form|account|page|url|github|repository|repo)\b|\b(?:website|webpage|web\s+page|browser|site|online|inbox|mailbox|email|e-mail|mail|gmail|calendar|drive|portal|dashboard|application|app|service|system|platform|form|account|page|url|github|repository|repo)\b[\s\S]{0,160}\b(?:open|navigate|visit|search|read|review|inspect|check|browse|click|fill|upload|attach|complete|manage|draft|compose|reply)\b|(?:使用|通过|在).{0,24}(?:浏览器|网页|网站|云电脑).{0,180}(?:打开|访问|浏览|导航|搜索|查找|阅读|查看|检查|点击|填写|上传|完成|操作|拟写|起草|回复)|(?:打开|访问|浏览|搜索|查找|阅读|查看|检查|操作|拟写|起草|回复|上传).{0,120}(?:网页|网站|浏览器|邮箱|收件箱|邮件|Gmail|谷歌邮箱|在线页面|日历|网盘|门户|后台|系统|平台|应用|工作区|表单|GitHub|仓库|代码库)|(?:在|用|通过).{0,24}[\p{L}\p{N}][\p{L}\p{N}._-]{1,60}(?:里|中|上|系统|平台|应用|工作区|网页|网站|邮箱|收件箱|仓库|代码库)?[\s\S]{0,100}(?:打开|访问|浏览|导航|搜索|查找|阅读|查看|检查|操作|拟写|起草|回复|填写|上传|管理))/iu;
// Tool-oriented task prompts often name the Browser User API instead of
// saying "use the browser" (for example, "用 computer_browser.open_artifact
// 打开本次任务的页面"). Treat an explicit invocation as task intent, while a
// discussion that merely asks about the tool name must not grant a capability.
const explicitComputerBrowserTaskRequest = /(?:\b(?:please\s+)?(?:use|call|invoke|run|execute)\s+`?computer_browser\.(?:navigate|open_artifact|upload_file|click|fill|press|select|check|uncheck|inspect)\b|(?:请|然后|再|随后|直接)?\s*(?:用|使用|调用|执行)\s*`?computer_browser\.(?:navigate|open_artifact|upload_file|click|fill|press|select|check|uncheck|inspect)\b|\bcomputer_browser\.(?:navigate|open_artifact|upload_file|click|fill|press|select|check|uncheck|inspect)\b[\s\S]{0,100}(?:打开|访问|导航|点击|填写|上传|检查|预览|open|navigate|click|fill|upload|inspect|preview))/iu;
// Chinese users commonly describe the outcome rather than naming a browser or
// site (for example, "找一封最近未读的邮件，点击进去看看"). Treat a direct
// request about online content as Browser User work so the model gets the same
// short-lived task capability as an English "search Gmail" request.
const directChineseBrowserTaskRequest = /(?:(?:打开|访问|浏览|导航到|搜索|查找|找|阅读|读取|查看|检查|点击|点开|进入|填写|选择|提交|管理|操作|拟写|起草|撰写|回复|筛选).{0,120}(?:网页|网站|浏览器|邮箱|收件箱|未读邮件|邮件|Gmail|谷歌邮箱|日历|网盘|云盘|门户|后台|系统|平台|应用|工作区|表单|工单|在线页面|页面)|(?:网页|网站|浏览器|邮箱|收件箱|未读邮件|邮件|Gmail|谷歌邮箱|日历|网盘|云盘|门户|后台|系统|平台|应用|工作区|表单|工单|在线页面|页面).{0,120}(?:打开|访问|浏览|导航|搜索|查找|找|阅读|读取|查看|检查|点击|点开|进入|填写|选择|提交|管理|操作|拟写|起草|撰写|回复|筛选))/iu;
// Direct Chinese research tasks often name authoritative sources and ask to
// verify or compare current rules without saying "open a webpage". They still
// need the same short-lived Browser User scope as ordinary site tasks.
const directChineseOnlineResearchRequest = /(?:(?:调研|研究|核对|核实|查询|查证|核验|检索|调查|对照).{0,120}(?:官方(?:网站|网页|渠道|公告|发布|规则|文档|资料)|官网|公开网页|公开公告|公开信息)|(?:官方(?:网站|网页|渠道|公告|发布|规则|文档|资料)|官网|公开网页|公开公告|公开信息).{0,120}(?:调研|研究|核对|核实|查询|查证|核验|检索|调查|对照))/iu;
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
 * Recognize an earlier direct Browser task only to restore its text after an
 * explicit same-Bot continuation. This result never grants or denies computer
 * actions; a live authenticated task lease always carries Browser and Computer access.
 */
export function requestsBrowserTask(request: string): boolean {
  const text = typeof request === 'string' ? request.trim().slice(0, 20_000) : '';
  if (!text || deniesBrowserTask.test(text) || quotedSourceInstructions.test(text) || openedQuotedSource.test(text) || quotedChineseSourceInstructions.test(text)) return false;
  // This is continuation context only, not a capability or approval classifier.
  return directBrowserTaskRequest.test(text) || directChineseBrowserTaskRequest.test(text) || directChineseOnlineResearchRequest.test(text) || explicitComputerBrowserTaskRequest.test(text) || namesUnregisteredBrowserDestination(text) || ((directNavigationRequest.test(text) || groupAcceptanceNavigationRequest.test(text)) && urlPattern.test(text));
}

/** Whether the owner explicitly asked the Agent to stop and hand off at sign-in. */
export function requestsUserSignInHandoff(request: string): boolean {
  const text = typeof request === 'string' ? request.trim().slice(0, 20_000) : '';
  if (!text) return false;
  // Require the stop/owner-control instruction to be tied to the sign-in
  // boundary itself. A broad "login ... stop" scan misclassified ordinary
  // tasks such as "do not log in ... if the control is missing, stop and report"
  // and then disabled every Browser/Computer action for the whole run.
  const chinese = /(?:(?:登录|登陆)(?:页|页面|界面)?时.{0,28}(?:停下(?:来)?|暂停|停止).{0,28}(?:让我(?:去)?|由我|我来|(?:提示|告诉)我).{0,40}(?:操作|登录|接管|Take\s+control)|(?:停下(?:来)?|暂停|停止).{0,28}(?:让我|由我|我来|(?:提示|告诉)我).{0,40}(?:登录|登陆|操作|接管|Take\s+control)|(?:到|遇到|若|如果|一旦|出现|看到).{0,18}(?:登录|登陆)(?:页|页面|界面)?.{0,32}(?:停下(?:来)?|暂停|停止).{0,28}(?:让我|由我|我来|(?:提示|告诉)我).{0,40}(?:操作|登录|接管|Take\s+control)|(?:云电脑|电脑|浏览器|控制权).{0,20}(?:交给|留给)我.{0,20}(?:操作|登录|接管)?)/i;
  const english = /(?:\b(?:stop|pause|wait)\b.{0,24}\b(?:at|on|when|if|once|until)\s+(?:the\s+)?(?:sign[ -]?in|log[ -]?in|authentication|verification)(?:\s+page)?[\s\S]{0,40}\b(?:so\s+)?(?:i|me|the user)\b[\s\S]{0,24}\b(?:take control|sign[ -]?in|log[ -]?in|handle|continue)\b|\b(?:sign[ -]?in|log[ -]?in)(?:\s+page)?[\s\S]{0,40}\b(?:let me|i(?:'ll| will)|take control|hand (?:control|it) to me|user can)\b)/i;
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
 * Return the prior Browser task text only for an unbroken same-Bot continuation.
 * This restores task context; it does not grant permissions. An unrelated user
 * prompt breaks the chain, and webpage text is never included in this history.
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
