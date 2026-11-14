export type GroupMentionToken =
  | { kind: 'bot'; botId: string; name: string; start: number; end: number }
  | { kind: 'everyone'; name: 'everyone'; start: number; end: number };
export type GroupMentionQuery = { start: number; end: number; query: string };

/** Expand an explicit @everyone token to the group's current, server-owned Bot roster. */
export function groupMentionRecipientBotIds(memberIds: string[], tokens: GroupMentionToken[]): string[] {
  if (tokens.some(token => token.kind === 'everyone')) return [...new Set(memberIds)];
  const members = new Set(memberIds);
  return [...new Set(tokens.flatMap(token => token.kind === 'bot' && members.has(token.botId) ? [token.botId] : []))];
}

/** Use recipients persisted in the latest group turn for optimistic Bot activity. */
export function groupRecipientBotIds(memberIds: string[], targetBotIds?: string[]): string[] {
  if (!targetBotIds?.length) return memberIds;
  const members = new Set(memberIds);
  return [...new Set(targetBotIds.filter(id => members.has(id)))];
}

/** A mention is actionable only after the user selects a Bot from the group roster. */
export function findGroupMentionQuery(text: string, caret: number): GroupMentionQuery | null {
  const end = Math.max(0, Math.min(text.length, Math.trunc(caret)));
  const start = text.lastIndexOf('@', Math.max(0, end - 1));
  if (start < 0 || start >= end || (start > 0 && !/[\s([{>]/.test(text[start - 1]))) return null;
  const query = text.slice(start + 1, end);
  if (/[\s@]/.test(query)) return null;
  return { start, end, query };
}

/** Keep selected Bot IDs attached only to unchanged visible mention text while the draft is edited. */
export function rebaseGroupMentionTokens(previous: string, next: string, tokens: GroupMentionToken[]): GroupMentionToken[] {
  if (previous === next) return tokens;
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  const editedEnd = previous.length - suffix;
  const delta = next.length - previous.length;
  return tokens.flatMap(token => {
    if (token.start < 0 || token.end > previous.length || token.start >= token.end) return [];
    if (token.end <= prefix) return [token];
    if (token.start >= editedEnd) return [{ ...token, start: token.start + delta, end: token.end + delta }];
    return [];
  });
}
