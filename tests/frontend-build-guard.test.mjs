import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('deployment frontend build rejects a disabled login gate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grok-build-guard-'));
  try {
    const secret = join(dir, 'secret');
    await writeFile(secret, 'synthetic', { mode: 0o600 });
    for (const build of [{ basePath: '/grok-bot/', requireAuth: false }, { basePath: '/', requireAuth: true }]) {
      await writeFile(join(dir, 'web-build.json'), JSON.stringify(build));
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/start-auth.ts'], {
        env: { ...process.env, COKE_GROK_PUBLIC_ORIGIN: 'http://127.0.0.1:3010/grok-bot', COKE_GROK_GOOGLE_CLIENT_ID: 'synthetic', COKE_GROK_STATIC_DIR: dir, COKE_GROK_GOOGLE_SECRET_FILE: secret, COKE_GROK_MYSQL_PASSWORD_FILE: secret }, encoding: 'utf8', timeout: 5000,
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Frontend build does not match the public path or require authentication/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('database startup failure exits without leaving a connection pool running', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grok-startup-'));
  try {
    const secret = join(dir, 'secret');
    await writeFile(secret, 'synthetic', { mode: 0o600 });
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/start-auth.ts'], {
      env: { ...process.env, COKE_GROK_PUBLIC_ORIGIN: 'http://127.0.0.1:3010', COKE_GROK_GOOGLE_CLIENT_ID: 'synthetic', COKE_GROK_STATIC_DIR: '', COKE_GROK_GOOGLE_SECRET_FILE: secret, COKE_GROK_MYSQL_PASSWORD_FILE: secret, COKE_GROK_MYSQL_HOST: '127.0.0.1', COKE_GROK_MYSQL_PORT: '1', COKE_GROK_MYSQL_USER: 'synthetic', COKE_GROK_MYSQL_DATABASE: 'synthetic' }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Auth service failed to start/);
    assert.equal(result.signal, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
