import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mysql from 'mysql2/promise';

const mysqlPort = Number(process.env.COKE_GROK_TEST_MYSQL_PORT);
if (!mysqlPort) throw new Error('Set COKE_GROK_TEST_MYSQL_PORT to a disposable local MySQL instance.');
const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = (socket.address() as import('node:net').AddressInfo).port;
await new Promise<void>(resolve => socket.close(() => resolve()));
const id = randomUUID().replaceAll('-', '').slice(0, 20), database = `grok_bundle_${id}`, user = `grok_${id}`;
const password = randomBytes(24).toString('hex');
const temp = await mkdtemp(join(tmpdir(), 'coke-grok-test-'));
const admin = await mysql.createConnection({ host: '127.0.0.1', port: mysqlPort, user: 'root', timezone: 'Z' });
let child: ReturnType<typeof spawn> | undefined;
try {
  await admin.query(`CREATE DATABASE \`${database}\``);
  await admin.query(mysql.format('CREATE USER ?@? IDENTIFIED BY ?', [user, '%', password]));
  await admin.query(mysql.format(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO ?@?`, [user, '%']));
  const dbSecret = join(temp, 'db'), googleSecret = join(temp, 'google');
  await writeFile(dbSecret, password, { mode: 0o600 });
  await writeFile(googleSecret, 'synthetic-test-secret', { mode: 0o600 });
  const origin = `http://127.0.0.1:${port}`, base = `${origin}/grok-bot`;
  if (process.env.COKE_GROK_TEST_IMAGE) {
    const args = ['run', '--rm', '--user', `${process.getuid?.()}:${process.getgid?.()}`, '-v', `${temp}:/run/coke-secrets:ro`, '-p', `127.0.0.1:${port}:3001`];
    const config: Record<string, string> = { COKE_GROK_PUBLIC_ORIGIN: base, COKE_GROK_GOOGLE_CLIENT_ID: 'synthetic-test-client', COKE_GROK_GOOGLE_SECRET_FILE: '/run/coke-secrets/google', COKE_GROK_MYSQL_HOST: 'host.docker.internal', COKE_GROK_MYSQL_PORT: String(mysqlPort), COKE_GROK_MYSQL_USER: user, COKE_GROK_MYSQL_PASSWORD_FILE: '/run/coke-secrets/db', COKE_GROK_MYSQL_DATABASE: database, COKE_GROK_AUTH_HOST: '0.0.0.0', COKE_GROK_AUTH_PORT: '3001' };
    for (const [key, value] of Object.entries(config)) args.push('-e', `${key}=${value}`);
    args.push(process.env.COKE_GROK_TEST_IMAGE);
    child = spawn('docker', args, { stdio: 'ignore' });
  } else {
    child = spawn(process.execPath, ['dist/server/auth.cjs'], { env: { ...process.env, COKE_GROK_PUBLIC_ORIGIN: base, COKE_GROK_GOOGLE_CLIENT_ID: 'synthetic-test-client', COKE_GROK_GOOGLE_SECRET_FILE: googleSecret, COKE_GROK_MYSQL_HOST: '127.0.0.1', COKE_GROK_MYSQL_PORT: String(mysqlPort), COKE_GROK_MYSQL_USER: user, COKE_GROK_MYSQL_PASSWORD_FILE: dbSecret, COKE_GROK_MYSQL_DATABASE: database, COKE_GROK_AUTH_PORT: String(port) }, stdio: 'ignore' });
  }
  let response: Response | undefined;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Bundled server exited during startup');
    try { response = await fetch(`${base}/api/auth/me`); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.equal(response?.status, 401);
  const start = await fetch(`${base}/api/auth/google/start`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get('location')!);
  assert.equal(location.origin, 'https://accounts.google.com');
  assert.equal(location.searchParams.get('redirect_uri'), `${base}/auth/google/callback`);
  assert.match(start.headers.get('set-cookie')!, /Path=\/grok-bot\/auth\/google\/callback/);
  console.log('Bundled server smoke passed against a disposable MySQL instance; no live OAuth exchange was performed.');
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  await admin.query(mysql.format('DROP USER IF EXISTS ?@?', [user, '%']));
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.end(); await rm(temp, { recursive: true, force: true });
}
