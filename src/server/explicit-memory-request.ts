export interface ExplicitMemoryRequest {
  title: string;
  content: string;
}

/**
 * Recognize only clear, first-party requests for durable Bot memory. This is a
 * persistence fallback for explicit instructions; autonomous memory choices
 * remain with the Agent runtime.
 */
export function explicitMemoryRequest(prompt: string): ExplicitMemoryRequest | null {
  const input = prompt.trim();
  if (!input || input.length > 20_000 || isNegated(input)) return null;

  const patterns: Array<{ pattern: RegExp; title: string; stable: boolean }> = [
    {
      pattern: /^(?:please\s+)?remember\s+this\s+(?:lasting|long[- ]term|durable|permanent)\s+(preference|rule|fact|role|responsibility|work summary)\s+for\s+(?:this\s+)?bot\s*[:：]\s*([\s\S]+)$/i,
      title: "Bot preference",
      stable: true,
    },
    {
      pattern: /^(?:please\s+)?(?:remember|save|store)\s+(?:this\s+)?(?:lasting|long[- ]term|durable|permanent)\s+(preference|rule|fact|role|responsibility|work summary)\s*(?:for\s+(?:this\s+)?bot)?\s*[:：]\s*([\s\S]+)$/i,
      title: "Bot preference",
      stable: true,
    },
    {
      pattern: /^(?:please\s+)?remember\s+that\s+((?:I|my|we|our)\b[\s\S]+)$/i,
      title: "User preference",
      stable: false,
    },
    {
      pattern: /^(?:please\s+)?(?:save|store)\s+(?:this\s+)?(preference|rule|fact|role|responsibility)\s*(?:for\s+(?:this\s+)?bot)?\s*[:：]\s*([\s\S]+)$/i,
      title: "Bot preference",
      stable: true,
    },
    {
      pattern: /^(?:请)?(?:记住|记下来|保存到记忆(?:里|中)?|保存|存下)(?:我的|我|这个|以下|这条)?(?:长期|持久|永久)?(?:的)?(?:偏好|规则|事实|角色|职责|工作摘要|信息|内容)?\s*[:：]\s*([\s\S]+)$/u,
      title: "Bot 偏好",
      stable: true,
    },
    {
      pattern: /^(?:请)?记住(我(?:的)?[\s\S]+)$/u,
      title: "用户偏好",
      stable: false,
    },
  ];

  for (const entry of patterns) {
    const match = input.match(entry.pattern);
    if (!match) continue;
    const content = cleanContent(match.at(-1) || "");
    if (!content || (!entry.stable && !hasDurableCue(content))) return null;
    return { title: titleFor(entry.title, input), content };
  }
  return null;
}

function cleanContent(value: string): string {
  let content = value.trim();
  const testSuffix = /\s+(?:This is (?:a )?synthetic test value, not a secret\.?|Confirm(?: briefly)? after saving it\.?|Do not use the computer\.?)\s*$/i;
  while (testSuffix.test(content)) content = content.replace(testSuffix, "").trim();
  return content;
}

function isNegated(value: string): boolean {
  return /\b(?:do not|don't|never)\s+(?:remember|save|store)\b|\bremember\s+not\s+to\b|(?:不要|别)(?:记住|保存|存储)/i.test(value);
}

function hasDurableCue(value: string): boolean {
  return /\b(?:I prefer|I like|I work|I am|my role|my responsibility|my timezone|I always|I never|when I ask|when I want|our rule|we prefer)\b|(?:我(?:喜欢|偏好|负责|通常|习惯|希望|是)|我的(?:角色|职责|偏好|时区)|我们(?:的)?(?:规则|偏好)|以后|总是)/iu.test(value);
}

function titleFor(fallback: string, prompt: string): string {
  const kind = prompt.match(/\b(preference|rule|fact|role|responsibility|work summary)\b/i)?.[1];
  if (!kind) return fallback;
  const labels: Record<string, string> = {
    preference: "Bot preference",
    rule: "Bot rule",
    fact: "User fact",
    role: "User role",
    responsibility: "User responsibility",
    "work summary": "Work summary",
  };
  return labels[kind.toLowerCase()] || fallback;
}
