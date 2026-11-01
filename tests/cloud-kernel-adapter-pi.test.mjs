import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { runCloudKernel } from '../deploy/desktop/cloud-kernel-adapter.mjs';

test('Pi exposes a shared computer terminal only through exact owner approval, not the built-in Bash tool', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'grok-pi-tools-'));
  const cwd = path.join(workspace, 'tasks', 'shell-policy');
  await mkdir(cwd, { recursive: true });
  let options;
  const oldFetch = globalThis.fetch;
  const approvalId = randomUUID(), requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    requests.push({ pathname, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    if (pathname.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
    if (pathname.endsWith('/computer/actions')) return Response.json({ id: approvalId });
    if (pathname.endsWith(`/computer/actions/${approvalId}`)) return Response.json({ status: 'approved' });
    if (pathname.endsWith(`/computer/actions/${approvalId}/execute`)) return Response.json({ approved: true });
    throw new Error('Unexpected computer gateway request');
  };
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
      computer: { mode: 'mediated', gatewayUrl: 'https://gateway.example.test/v1', gatewayToken: 'x'.repeat(43) },
      prompt: 'Check the available tools.',
      signal: new AbortController().signal,
    }, { piSdk: sdk });

    assert.ok(options.tools.includes('read'));
    assert.ok(options.tools.includes('write'));
    assert.ok(options.tools.includes('computer_files'));
    assert.ok(options.tools.includes('computer_terminal'));
    assert.equal(options.tools.includes('bash'), false);
    const terminal = options.customTools.find(tool => tool.name === 'computer_terminal');
    const command = `printf PI_TERMINAL_OK > pi-${approvalId}.txt`;
    const result = await terminal.execute('run', { command, directory: 'shared' }, new AbortController().signal);
    assert.match(result.content[0].text, /"exitCode":0/);
    assert.equal(await readFile(path.join(workspace, 'shared', `pi-${approvalId}.txt`), 'utf8'), 'PI_TERMINAL_OK');
    assert.deepEqual(requests.find(request => request.pathname.endsWith('/computer/actions'))?.body, { action: { kind: 'terminal', action: 'run', command, directory: 'shared' } });
    assert.equal(requests.filter(request => request.pathname.endsWith(`/computer/actions/${approvalId}/execute`)).length, 1);
  } finally {
    globalThis.fetch = oldFetch;
    await rm(workspace, { recursive: true, force: true });
  }
});
