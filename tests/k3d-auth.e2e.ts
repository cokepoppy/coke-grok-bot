import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import mysql from 'mysql2/promise';
import { chromium } from 'playwright-core';

const port = Number(process.env.COKE_GROK_TEST_MYSQL_PORT), mysqlHost = process.env.COKE_GROK_TEST_MYSQL_K3D_HOST;
if (!port || !mysqlHost) throw new Error('Specify the isolated test MySQL port and its K3D-reachable host.');
if (execFileSync('kubectl', ['config', 'current-context'], { encoding: 'utf8' }).trim() !== 'k3d-tp1121-sandbox-dev') throw new Error('Unexpected Kubernetes context.');
const id = randomUUID().replaceAll('-', '').slice(0, 12), namespace = `coke-grok-auth-test-${id}`, database = `grok_k3d_${id}`, user = `grok_${id}`;
const password = randomBytes(24).toString('hex');
const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
const httpPort = (server.address() as import('node:net').AddressInfo).port;
await new Promise<void>(resolve => server.close(() => resolve()));
const origin = `http://127.0.0.1:${httpPort}`, base = `${origin}/grok-bot`;
const admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', timezone: 'Z' });
let forward: ReturnType<typeof spawn> | undefined, created = false;
const kubectl = (args: string[], input?: string) => execFileSync('kubectl', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
try {
  await admin.query(`CREATE DATABASE \`${database}\``);
  await admin.query(mysql.format('CREATE USER ?@? IDENTIFIED BY ?', [user, '%', password]));
  await admin.query(mysql.format(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO ?@?`, [user, '%']));
  kubectl(['create', 'namespace', namespace]); created = true;
  const resources = { apiVersion: 'v1', kind: 'List', items: [
    { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'auth-config', namespace }, data: { COKE_GROK_PUBLIC_ORIGIN: base, COKE_GROK_GOOGLE_CLIENT_ID: 'synthetic-test-client', COKE_GROK_MYSQL_HOST: mysqlHost, COKE_GROK_MYSQL_PORT: '3306', COKE_GROK_MYSQL_USER: user, COKE_GROK_MYSQL_DATABASE: database } },
    { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'auth-secrets', namespace }, type: 'Opaque', data: { 'mysql-password': Buffer.from(password).toString('base64'), 'google-secret': Buffer.from('synthetic-test-secret').toString('base64') } },
  ] };
  kubectl(['apply', '-f', '-'], JSON.stringify(resources));
  kubectl(['apply', '-n', namespace, '-f', 'deploy/k3d/auth.yaml']);
  kubectl(['rollout', 'status', '-n', namespace, 'deployment/coke-grok-auth', '--timeout=90s']);
  forward = spawn('kubectl', ['port-forward', '-n', namespace, 'service/coke-grok-auth', `${httpPort}:3001`, '--address=127.0.0.1'], { stdio: 'ignore' });
  let res: Response | undefined;
  for (let i = 0; i < 100; i++) {
    if (forward.exitCode !== null) throw new Error('Port-forward exited early');
    try { res = await fetch(`${base}/api/auth/me`); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.equal(res?.status, 401);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${base}/`);
    await page.getByRole('link', { name: 'Continue with Google' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Continue with Google' }).getAttribute('href'), '/grok-bot/api/auth/google/start');
  } finally { await browser.close(); }
  const start = await fetch(`${base}/api/auth/google/start`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const redirect = new URL(start.headers.get('location')!);
  assert.equal(redirect.origin, 'https://accounts.google.com');
  assert.equal(redirect.searchParams.get('redirect_uri'), `${base}/auth/google/callback`);
  assert.match(start.headers.get('set-cookie')!, /Path=\/grok-bot\/auth\/google\/callback/);
  console.log(`K3D auth smoke passed in ${namespace}: non-root Pod, private secret files, isolated MySQL, browser login page and prefixed HTTP routes. Google login was not performed.`);
} finally {
  if (forward && forward.exitCode === null) { forward.kill('SIGTERM'); await once(forward, 'exit'); }
  if (created) { try { kubectl(['scale', '-n', namespace, 'deployment/coke-grok-auth', '--replicas=0']); } catch { /* A failed apply may not have created the Deployment. */ } }
  await admin.query(mysql.format('DROP USER IF EXISTS ?@?', [user, '%']));
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.end();
}
