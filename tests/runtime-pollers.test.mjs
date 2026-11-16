import test from 'node:test';
import assert from 'node:assert/strict';
import { startRuntimePollers } from '../src/server/runtime-pollers.ts';

async function waitFor(check, timeoutMs = 1_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for independent runtime pollers');
}

test('a slow routine dispatch does not block queued work, handoffs, or expired lease recovery', async () => {
  let routineCalls = 0, schedulerCalls = 0, handoffCalls = 0, recoveryCalls = 0;
  let releaseRoutine;
  const events = [];
  const pollers = startRuntimePollers({
    scheduler: { async tick() { schedulerCalls++; } },
    routines: { dispatchDue() { routineCalls++; return new Promise(resolve => { releaseRoutine = resolve; }); } },
    handoffs: { async deliverReplies() { handoffCalls++; } },
    runs: { async markExpiredUnknown() { recoveryCalls++; } },
  }, { intervalMs: 10, slowAfterMs: 25, onEvent: event => events.push(event) });
  try {
    await waitFor(() => schedulerCalls >= 3 && handoffCalls >= 3 && recoveryCalls >= 3 && events.some(event => event.component === 'routine_dispatch'));
    assert.equal(routineCalls, 1, 'a single poller must never overlap itself');
    assert.ok(schedulerCalls >= 3, 'the run queue continues to advance while routine dispatch is slow');
    assert.ok(handoffCalls >= 3, 'Bot handoff delivery has its own progress loop');
    assert.ok(recoveryCalls >= 3, 'expired lease recovery has its own progress loop');
    assert.deepEqual(events.filter(event => event.component === 'routine_dispatch').map(event => event.event), ['grok_runtime_poll_still_running']);
  } finally {
    pollers.stop();
    releaseRoutine?.();
  }
});

test('a failed poll is logged without raw error text and retried on the next interval', async () => {
  let schedulerCalls = 0;
  const events = [];
  const pollers = startRuntimePollers({
    scheduler: { async tick() { schedulerCalls++; if (schedulerCalls === 1) throw new Error('sensitive prompt text'); } },
    routines: { async dispatchDue() {} },
    handoffs: { async deliverReplies() {} },
    runs: { async markExpiredUnknown() {} },
  }, { intervalMs: 10, slowAfterMs: 100, onEvent: event => events.push(event) });
  try {
    await waitFor(() => schedulerCalls >= 2 && events.some(event => event.event === 'grok_runtime_poll_failed'));
    const failure = events.find(event => event.event === 'grok_runtime_poll_failed');
    assert.equal(failure.component, 'run_scheduler');
    assert.equal('error' in failure, false);
    assert.equal(JSON.stringify(failure).includes('sensitive prompt text'), false);
  } finally {
    pollers.stop();
  }
});
