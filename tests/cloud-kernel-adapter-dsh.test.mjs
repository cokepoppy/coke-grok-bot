import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCloudKernel } from '../deploy/desktop/cloud-kernel-adapter.mjs';

test('DeepSeekHarness receives the supported SDK launch options', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'grok-dsh-sdk-options-'));
  const cwd = path.join(workspace, 'tasks', 'demo');
  await mkdir(cwd, { recursive: true });
  const realCwd = await realpath(cwd);
  const previousBin = process.env.DOTS_DSH_BIN;
  const previousProfile = process.env.DOTS_DSH_PROFILE;
  let options;
  let closeCalls = 0;

  class FakeDeepSeekHarness {
    constructor(value) { options = value; }
    async run(prompt, runOptions) {
      assert.equal(prompt, 'Return a structured completion.');
      assert.deepEqual(runOptions, { sessionId: undefined });
      return {
        finalResponse: JSON.stringify({ status: 'done', message: 'DSH adapter test passed' }),
        sessionId: 'fixture-session',
        events: [],
      };
    }
    async close() { closeCalls += 1; }
  }

  process.env.DOTS_DSH_BIN = '/opt/coke-grok/dsh-runtime/node_modules/.bin/dsh';
  process.env.DOTS_DSH_PROFILE = 'sdk-fixture';
  try {
    const result = await runCloudKernel({
      engine: 'dsh',
      modelConfig: { apiKey: 'test-only-key', baseUrl: 'https://models.example/v1', model: 'deepseek-v4.1-flash' },
      cwd: path.relative(workspace, cwd),
      workspace,
      prompt: 'Return a structured completion.',
      signal: new AbortController().signal,
    }, { dshSdk: { DeepSeekHarness: FakeDeepSeekHarness } });

    assert.deepEqual(result, { status: 'done', message: 'DSH adapter test passed', sessionId: 'fixture-session' });
    assert.equal(options.dshBin, process.env.DOTS_DSH_BIN);
    assert.equal(options.profile, process.env.DOTS_DSH_PROFILE);
    assert.equal(options.dshHome, path.join(realCwd, '.coke-dots-agent-runtime', 'dsh-home'));
    assert.equal(options.processCwd, realCwd);
    assert.equal(options.cwd, realCwd);
    assert.equal(options.provider, 'coke-dots-shared');
    assert.equal(options.model, 'deepseek-v4.1-flash');
    assert.equal(options.patches.length, 1);
    assert.equal(path.dirname(options.patches[0]), options.dshHome);
    assert.match(path.basename(options.patches[0]), /^coke-dots-[a-f0-9]+\.cordis\.yml$/);
    assert.equal(options.env.HOME, options.dshHome);
    assert.equal(options.env.DSH_HOME, options.dshHome);
    assert.equal(options.env.DEEPSEEK_API_KEY, 'test-only-key');
    assert.equal(options.env.DEEPSEEK_BASE_URL, 'https://models.example/v1');
    assert.equal(options.env.DSH_MODEL, 'deepseek-v4.1-flash');
    assert.equal(closeCalls, 1);
  } finally {
    if (previousBin === undefined) delete process.env.DOTS_DSH_BIN;
    else process.env.DOTS_DSH_BIN = previousBin;
    if (previousProfile === undefined) delete process.env.DOTS_DSH_PROFILE;
    else process.env.DOTS_DSH_PROFILE = previousProfile;
    await rm(workspace, { recursive: true, force: true });
  }
});
