import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAgentExecutionAudit } from '../src/server/execution-audit.ts';

test('execution audit keeps only the bounded engine, model and allowlisted tool status', () => {
  const audit = validateAgentExecutionAudit({
    engine: 'pi',
    model: 'deepseek-v4.1-flash',
    modelCompleted: true,
    calls: [{
      tool: 'computer_browser', action: 'navigate', outcome: 'succeeded',
      url: 'https://example.test/private?access_token=never-store',
      result: 'Private page contents',
    }],
    truncated: false,
    apiKey: 'never-store',
  });

  assert.deepEqual(audit, {
    engine: 'pi', model: 'deepseek-v4.1-flash', modelCompleted: true,
    calls: [{ tool: 'computer_browser', action: 'navigate', outcome: 'succeeded' }],
    truncated: false,
  });
});

test('execution audit rejects malformed and oversized records but preserves any action label', () => {
  assert.equal(validateAgentExecutionAudit('{not-json'), null);
  assert.deepEqual(validateAgentExecutionAudit({
    engine: 'pi', model: 'deepseek-v4.1-flash', modelCompleted: true,
    calls: [{ tool: 'computer_browser', action: 'custom-action-name', outcome: 'succeeded' }], truncated: false,
  })?.calls, [{ tool: 'computer_browser', action: 'custom-action-name', outcome: 'succeeded' }]);
  assert.equal(validateAgentExecutionAudit({
    engine: 'pi', model: 'deepseek-v4.1-flash', modelCompleted: true,
    calls: Array.from({ length: 65 }, () => ({ tool: 'computer_desktop', action: 'screenshot', outcome: 'succeeded' })),
    truncated: false,
  }), null);
  assert.equal(validateAgentExecutionAudit({
    engine: 'pi', model: 'deepseek-v4.1-flash?token=secret', modelCompleted: true, calls: [], truncated: false,
  }), null);
  assert.equal(validateAgentExecutionAudit({
    engine: 'pi', model: 'deepseek-v4.1-flash', modelCompleted: true,
    calls: [{ tool: 'open_public_page', action: 'read', outcome: 'succeeded' }], truncated: false,
  }), null);
});
