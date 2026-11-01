import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCloudKernel } from '../deploy/desktop/cloud-kernel-adapter.mjs';

test('Pi computer runtime does not expose shell execution outside the approval gateway', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'grok-pi-tools-'));
  const cwd = path.join(workspace, 'tasks', 'shell-policy');
  await mkdir(cwd, { recursive: true });
  let options;
  const sdk = {
    AuthStorage: { inMemory: () => ({ setRuntimeApiKey() {} }) },
    ModelRegistry: { inMemory: () => ({ registerProvider() {}, find: () => ({ id: 'deepseek-v4.1-flash' }) }) },
    SessionManager: {
      list: async () => [],
      create: () => ({ getSessionId: () => 'shell-policy-session' }),
    },
    createAgentSession: async value => {
      options = value;
      return { session: {
        messages: [{ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: '{"status":"done","message":"tools checked"}' }] }],
        async prompt() {},
        dispose() {},
      } };
    },
  };

  try {
    await runCloudKernel({
      engine: 'pi',
      modelConfig: { apiKey: 'test-only-key', baseUrl: 'https://models.example/v1', model: 'deepseek-v4.1-flash' },
      workspace,
      cwd: 'tasks/shell-policy',
      prompt: 'Check the available tools.',
      signal: new AbortController().signal,
    }, { piSdk: sdk });

    assert.ok(options.tools.includes('read'));
    assert.ok(options.tools.includes('write'));
    assert.equal(options.tools.includes('bash'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
