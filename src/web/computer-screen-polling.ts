const SCREEN_POLL_BASE_DELAY_MS = 2_000;
const SCREEN_POLL_MAX_DELAY_MS = 15_000;

export function computerScreenRetryDelay(consecutiveFailures: number): number {
  const failures = Number.isSafeInteger(consecutiveFailures) ? Math.max(0, consecutiveFailures) : 1;
  const exponent = Math.max(0, failures - 1);
  return Math.min(SCREEN_POLL_MAX_DELAY_MS, SCREEN_POLL_BASE_DELAY_MS * 2 ** exponent);
}
