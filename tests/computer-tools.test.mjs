import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSharedFiles, readSharedFile, runTaskTerminal } from '../deploy/desktop/computer-tools.mjs';

test('shared computer file reads stay inside the persistent shared folder and reject symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'grok-shared-files-'));
  try {
    await mkdir(join(root, 'shared'), { recursive: true });
    await writeFile(join(root, 'shared', 'notes.md'), 'shared notes\n');
    await writeFile(join(root, 'outside.txt'), 'outside');
    await symlink(join(root, 'outside.txt'), join(root, 'shared', 'escape.txt'));
    assert.deepEqual(await readSharedFile(root, 'notes.md'), 'shared notes\n');
    assert.deepEqual(await listSharedFiles(root), [{ name: 'notes.md', kind: 'file', size: 13 }]);
    await assert.rejects(readSharedFile(root, '../outside.txt'), /invalid/);
    await assert.rejects(readSharedFile(root, 'escape.txt'), /symbolic links/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('approved terminal runs once in the selected folder with a clean child environment and bounded output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'grok-terminal-'));
  const task = join(root, 'tasks', 'run');
  await mkdir(task, { recursive: true });
  const canonicalRoot = await realpath(root), canonicalTask = await realpath(task);
  const old = process.env.COKE_GROK_TEST_SECRET;
  process.env.COKE_GROK_TEST_SECRET = 'do-not-inherit';
  try {
    const result = await runTaskTerminal({ command: 'pwd && printf terminal-ok > result.txt && env', directory: 'task' }, { workspaceValue: canonicalRoot, taskDirectory: canonicalTask });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.startsWith(`${canonicalTask}\n`));
    assert.equal((await readFile(join(task, 'result.txt'), 'utf8')), 'terminal-ok');
    assert.doesNotMatch(result.stdout, /COKE_GROK_TEST_SECRET|do-not-inherit/);
    assert.equal(process.env.COKE_GROK_TEST_SECRET, 'do-not-inherit');
    const echoedSecret = await runTaskTerminal({ command: "printf '%s' 'do-not-inherit'", directory: 'task' }, { workspaceValue: canonicalRoot, taskDirectory: canonicalTask });
    assert.equal(echoedSecret.stdout, '[redacted]');

    const shared = await runTaskTerminal({ command: 'pwd && printf shared-ok > output.txt', directory: 'shared' }, { workspaceValue: canonicalRoot, taskDirectory: canonicalTask });
    assert.equal(shared.exitCode, 0);
    assert.ok(shared.stdout.startsWith(`${join(canonicalRoot, 'shared')}\n`));
    assert.equal(await readFile(join(root, 'shared', 'output.txt'), 'utf8'), 'shared-ok');
    await assert.rejects(runTaskTerminal({ command: 'yes x | head -c 40000', directory: 'task' }, { workspaceValue: canonicalRoot, taskDirectory: canonicalTask }), /exceeded 32 KiB/);
  } finally {
    if (old === undefined) delete process.env.COKE_GROK_TEST_SECRET; else process.env.COKE_GROK_TEST_SECRET = old;
    await rm(root, { recursive: true, force: true });
  }
});

test('terminal abort kills the command process group', async () => {
  const root = await mkdtemp(join(tmpdir(), 'grok-terminal-abort-'));
  const task = join(root, 'task'); await mkdir(task);
  const canonicalRoot = await realpath(root), canonicalTask = await realpath(task);
  const controller = new AbortController();
  const running = runTaskTerminal({ command: 'sleep 20', directory: 'task' }, { workspaceValue: canonicalRoot, taskDirectory: canonicalTask, signal: controller.signal });
  setTimeout(() => controller.abort(new Error('test stopped')), 100).unref();
  try { await assert.rejects(running, /test stopped/); }
  finally { await rm(root, { recursive: true, force: true }); }
});
