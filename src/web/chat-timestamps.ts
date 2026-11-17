const dateKey = (date: Date): string => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

export function formatChatTimestamp(value: number | string | Date, now = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(date);
  if (dateKey(date) === dateKey(now)) return time;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const day = dateKey(date) === dateKey(yesterday)
    ? 'Yesterday'
    : new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
    }).format(date);
  return `${day} · ${time}`;
}

export function shouldShowChatTimestamp(current: number, previous: number | null, gapMs = 5 * 60 * 1000): boolean {
  if (!Number.isFinite(current) || current <= 0) return false;
  if (previous == null || !Number.isFinite(previous) || previous <= 0) return true;
  const currentDate = new Date(current), previousDate = new Date(previous);
  if (dateKey(currentDate) !== dateKey(previousDate)) return true;
  return current - previous >= gapMs;
}
