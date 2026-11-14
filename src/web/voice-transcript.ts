export type TranscriptLine = { role: 'you' | 'bot'; text: string };

export function realtimeInputTranscriptText(text: unknown, stash: unknown): string {
  return `${typeof text === 'string' ? text : ''}${typeof stash === 'string' ? stash : ''}`.slice(0, 10_000);
}

export function upsertInputTranscript(lines: TranscriptLine[], text: string, replaceCurrent: boolean): TranscriptLine[] {
  const value = text.slice(0, 10_000);
  if (!value.trim()) return lines;
  const last = lines.at(-1);
  if (replaceCurrent && last?.role === 'you') return [...lines.slice(0, -1), { role: 'you', text: value }];
  return [...lines, { role: 'you', text: value }];
}
