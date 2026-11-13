import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendControlOwnerEvent, computerScreenKey } from '../deploy/desktop/control-owner-audit.mjs';

test('computer control transitions are persisted without raw Bot IDs', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'grok-control-audit-'));
  const screenId = randomUUID();
  try {
    const first = await appendControlOwnerEvent(directory, { screenId, fromOwner: 'agent', toOwner: 'user', source: 'take-control', at: '2026-11-10T07:00:00.000Z' });
    const second = await appendControlOwnerEvent(directory, { screenId, fromOwner: 'user', toOwner: 'agent', source: 'return-to-bot', at: '2026-11-10T07:05:00.000Z' });
    const file = path.join(directory, `${computerScreenKey(screenId)}.control.jsonl`);
    const lines = (await readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(lines, [first, second]);
    assert.equal(lines[0].fromOwner, 'agent');
    assert.equal(lines[0].toOwner, 'user');
    assert.equal(lines[0].source, 'take-control');
    assert.equal(lines[1].source, 'return-to-bot');
    assert.ok(!JSON.stringify(lines).includes(screenId));
    assert.equal((await lstat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('computer control audit rejects invalid transitions and symlink files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'grok-control-audit-link-'));
  const outside = path.join(directory, 'outside.jsonl');
  const screenId = randomUUID();
  const key = computerScreenKey(screenId);
  try {
    await assert.rejects(appendControlOwnerEvent(directory, { screenId, fromOwner: 'agent', toOwner: 'agent', source: 'take-control' }), /Invalid computer control audit event/);
    await assert.rejects(appendControlOwnerEvent(directory, { screenId, fromOwner: 'agent', toOwner: 'user', source: 'unknown' }), /Invalid computer control audit event/);
    await mkdir(outside);
    await chmod(outside, 0o700);
    await symlink(outside, path.join(directory, `${key}.control.jsonl`));
    await assert.rejects(appendControlOwnerEvent(directory, { screenId, fromOwner: 'agent', toOwner: 'user', source: 'take-control' }), /audit file is unavailable/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
