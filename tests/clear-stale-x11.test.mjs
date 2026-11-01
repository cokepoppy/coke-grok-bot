import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../deploy/desktop/clear-stale-x11.sh', import.meta.url);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'grok-stale-x11-'));
  const socketDir = join(root, '.X11-unix'), bin = join(root, 'bin');
  await Promise.all([mkdir(socketDir), mkdir(bin)]);
  const xdpyinfo = join(bin, 'xdpyinfo'), ps = join(bin, 'ps');
  await writeFile(xdpyinfo, '#!/bin/sh\n[ "${COKE_TEST_X11_ACTIVE:-0}" = 1 ]\n');
  await writeFile(ps, '#!/bin/sh\nprintf "%s\\n" "${COKE_TEST_XVFB_PROCESS:-}"\n');
  await Promise.all([chmod(xdpyinfo, 0o755), chmod(ps, 0o755)]);
  return { root, socketDir, bin, lock: join(root, '.X7-lock'), socket: join(socketDir, 'X7') };
}

function run(f, extras = {}) {
  return spawnSync('/bin/bash', [script.pathname], {
    encoding: 'utf8',
    env: { ...process.env, DISPLAY: ':7', COKE_DESKTOP_X11_RUNTIME_DIR: f.root, PATH: `${f.bin}:${process.env.PATH}`, ...extras },
  });
}

test('only removes stale display lock and socket when no X server responds or runs', async () => {
  const f = await fixture();
  try {
    await writeFile(f.lock, '12'); await writeFile(f.socket, 'stale socket fixture');
    const result = run(f);
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(readFile(f.lock)); await assert.rejects(readFile(f.socket));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('keeps X11 runtime files when the display responds or Xvfb is still running', async () => {
  const f = await fixture();
  try {
    await writeFile(f.lock, '12'); await writeFile(f.socket, 'fixture');
    assert.equal(run(f, { COKE_TEST_X11_ACTIVE: '1' }).status, 0);
    assert.equal(await readFile(f.lock, 'utf8'), '12'); assert.equal(await readFile(f.socket, 'utf8'), 'fixture');
    const busy = run(f, { COKE_TEST_XVFB_PROCESS: 'Xvfb' });
    assert.notEqual(busy.status, 0);
    assert.equal(await readFile(f.lock, 'utf8'), '12'); assert.equal(await readFile(f.socket, 'utf8'), 'fixture');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('rejects malformed display names without touching runtime files', async () => {
  const f = await fixture();
  try {
    await writeFile(f.lock, '12'); await writeFile(f.socket, 'fixture');
    const result = spawnSync('/bin/bash', [script.pathname], { encoding: 'utf8', env: { ...process.env, DISPLAY: 'localhost:7', COKE_DESKTOP_X11_RUNTIME_DIR: f.root, PATH: `${f.bin}:${process.env.PATH}` } });
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(f.lock, 'utf8'), '12'); assert.equal(await readFile(f.socket, 'utf8'), 'fixture');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
