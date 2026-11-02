import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureSharedComputerRoots } from '../deploy/desktop/shared-computer-root.mjs';

test('shared computer folders get explicit cross-container group permissions', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'grok-shared-root-'));
  const shared = join(workspace, 'shared');
  await mkdir(shared);
  await chmod(shared, 0o755);
  try {
    const screenState = await ensureSharedComputerRoots(workspace);
    assert.equal(screenState, join(await realpath(shared), 'computer-screens'));
    assert.equal((await lstat(shared)).mode & 0o777, 0o770);
    assert.equal((await lstat(screenState)).mode & 0o777, 0o750);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('shared computer root refuses symlinks', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'grok-shared-link-'));
  const outside = await mkdtemp(join(tmpdir(), 'grok-shared-outside-'));
  try {
    await symlink(outside, join(workspace, 'shared'));
    await assert.rejects(ensureSharedComputerRoots(workspace), /Shared computer directory is not available/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
