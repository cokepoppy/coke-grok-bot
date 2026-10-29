import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { chromium } from 'playwright-core';
import { TenantStore } from '../src/server/tenant-store.ts';
import { GoogleAuthService, type IdentityProvider } from '../src/server/google-auth.ts';
import { createAuthServer } from '../src/server/auth-http.ts';
import { BotStore } from '../src/server/bot-store.ts';

const mysqlPort = Number(process.env.COKE_GROK_TEST_MYSQL_PORT);
if (!mysqlPort) throw new Error('Set COKE_GROK_TEST_MYSQL_PORT to a disposable local MySQL instance.');
async function availablePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as import('node:net').AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
const frontendPort = await availablePort(), backendPort = await availablePort(), identityPort = await availablePort();
const origin = `http://127.0.0.1:${frontendPort}`;
const base = process.env.COKE_GROK_TEST_BASE || '/';
const publicUrl = `${origin}${base}`;
const database = `grok_browser_${randomUUID().replaceAll('-', '')}`;
const admin = await mysql.createConnection({ host: '127.0.0.1', port: mysqlPort, user: 'root', timezone: 'Z' });
await admin.query(`CREATE DATABASE \`${database}\``);
const pool = mysql.createPool({ host: '127.0.0.1', port: mysqlPort, user: 'root', database, timezone: 'Z' });
const store = new TenantStore(pool); await store.migrate();
const bots = new BotStore(pool); await bots.migrate();
let activeState = '';
const flows = new Map<string, { nonce: string; challenge: string }>();
const provider: IdentityProvider = {
  authorizationUrl(state, nonce, challenge) { flows.set(state, { nonce, challenge }); return `http://127.0.0.1:${identityPort}/?state=${state}`; },
  async exchange(code, verifier) {
    const flow = flows.get(activeState)!;
    assert.equal(createHash('sha256').update(verifier).digest('base64url'), flow.challenge);
    return { sub: code, email: `${code}@example.test`, email_verified: true, name: code, nonce: flow.nonce };
  },
};
let identity = 'alice';
const identityServer = createHttpServer((req, res) => {
  activeState = new URL(req.url || '/', `http://127.0.0.1:${identityPort}`).searchParams.get('state')!;
  res.writeHead(302, { Location: `${publicUrl}auth/google/callback?state=${activeState}&code=${identity}` }); res.end();
});
identityServer.listen(identityPort, '127.0.0.1'); await once(identityServer, 'listening');
const backend = createAuthServer(new GoogleAuthService(store, provider, publicUrl), publicUrl, undefined, bots);
backend.listen(backendPort, '127.0.0.1'); await once(backend, 'listening');
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], { env: { ...process.env, VITE_REQUIRE_AUTH: 'true', VITE_BASE_PATH: base, VITE_AUTH_PROXY_TARGET: `http://127.0.0.1:${backendPort}` }, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i++) {
    if (vite.exitCode !== null) throw new Error('Vite exited early');
    try { if ((await fetch(publicUrl)).ok) break; } catch { /* wait for Vite */ }
    if (i === 99) throw new Error('Vite did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext(); const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('response', response => { const url = new URL(response.url()); if (url.origin === origin && (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/auth/'))) { const location = response.headers()['location'] || ''; const error = location.includes('authError=') ? new URL(location, origin).searchParams.get('authError') : ''; console.log('auth response', url.pathname, response.status(), error); } });
  await page.goto(`${publicUrl}?authError=cancelled`);
  await page.getByRole('alert').getByText('Sign-in was cancelled or expired. Please try again.').waitFor();
  assert.equal(new URL(page.url()).searchParams.has('authError'), false);
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  try { await page.getByRole('button', { name: 'Sign out' }).waitFor(); } catch (error) { console.log('browser page', new URL(page.url()).origin, new URL(page.url()).pathname, (await page.locator('body').innerText()).slice(0, 300)); throw error; }
  await page.getByRole('button', { name: 'Create new Bot' }).click();
  await page.getByRole('button', { name: 'Show bot details' }).click();
  await page.getByLabel('Bot name').fill('Alice Bot');
  const saved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes('/api/bots/'));
  await page.getByLabel('Bot name').blur();
  assert.equal((await saved).status(), 200);
  await page.getByLabel('Bot name').fill('   ');
  await page.getByLabel('Bot name').blur();
  await page.getByRole('alert').getByText('Bot name cannot be empty.').waitFor();
  await page.getByLabel('Bot name').waitFor();
  assert.equal(await page.getByLabel('Bot name').inputValue(), 'Alice Bot');
  await page.route('**/api/bots/*', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, body: '{}' }) : route.continue());
  await page.getByLabel('Bot name').fill('Unsaved name');
  await page.getByLabel('Bot name').blur();
  await page.getByRole('alert').getByText('Could not save the Bot name. Please try again.').waitFor();
  assert.equal(await page.getByLabel('Bot name').inputValue(), 'Alice Bot');
  await page.unroute('**/api/bots/*');
  let releaseFirst!: () => void, observedFirst!: () => void;
  const firstObserved = new Promise<void>(resolve => { observedFirst = resolve; });
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const requestedNames: string[] = [];
  await page.route('**/api/bots/*', async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    requestedNames.push(route.request().postDataJSON().name);
    if (requestedNames.length === 1) { observedFirst(); await firstGate; }
    await route.continue();
  });
  await page.getByLabel('Bot name').fill('First rename');
  await page.getByLabel('Bot name').blur();
  await firstObserved;
  await page.getByLabel('Bot name').fill('Alice Bot');
  await page.getByLabel('Bot name').blur();
  assert.deepEqual(requestedNames, ['First rename']);
  const finalSave = page.waitForResponse(response => response.request().method() === 'PATCH' && response.request().postDataJSON().name === 'Alice Bot');
  releaseFirst();
  assert.equal((await finalSave).status(), 200);
  assert.deepEqual(requestedNames, ['First rename', 'Alice Bot']);
  await page.unroute('**/api/bots/*');
  await page.getByRole('button', { name: 'Hide bot details' }).click();
  await page.getByLabel('Message Alice Bot').fill('Alice local note');
  await page.getByRole('button', { name: 'Save local message' }).click();
  await page.reload();
  await page.getByLabel('Message Alice Bot').waitFor();
  await page.locator('.conversation').getByText('Alice local note').waitFor();
  const aliceSession = (await context.cookies()).find(cookie => cookie.name === 'coke_grok_session')!;
  identity = 'bob';
  await page.goto(`${publicUrl}api/auth/google/start`);
  await page.getByRole('button', { name: 'Sign out' }).waitFor();
  assert.equal(await page.locator('.conversation').getByText('Alice local note').count(), 0);
  assert.equal(await page.getByText('Alice Bot').count(), 0);
  assert.equal((await fetch(`${publicUrl}api/auth/me`, { headers: { cookie: `${aliceSession.name}=${aliceSession.value}` } })).status, 401);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('link', { name: 'Continue with Google' }).waitFor();
  identity = 'bob';
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await page.getByRole('button', { name: 'Sign out' }).waitFor();
  assert.equal(await page.locator('.conversation').getByText('Alice local note').count(), 0);
  await page.getByRole('button', { name: 'Create new Bot' }).click();
  await page.getByLabel('Message New Bot').fill('Bob local note');
  await page.getByRole('button', { name: 'Save local message' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  identity = 'alice';
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await page.locator('.conversation').getByText('Alice local note').waitFor();
  assert.equal(await page.locator('.conversation').getByText('Bob local note').count(), 0);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByLabel('Message Alice Bot').waitFor();
  assert.equal(await page.locator('.conversation').getByText('Alice local note').count(), 0);
  const sessionCookies = await context.cookies();
  assert.equal(sessionCookies.find(cookie => cookie.name === 'coke_grok_session')?.path, base);
  if (base !== '/') assert.equal((await fetch(`${origin}/api/auth/me`)).status, 404);
  await context.close();
  console.log('Browser E2E passed using a simulated identity provider and real HTTP/MySQL: sign-in, refresh, sign-out and same-browser account switching.');
} finally {
  if (browser) await browser.close();
  vite.kill('SIGTERM');
  await new Promise<void>(resolve => backend.close(() => resolve()));
  await new Promise<void>(resolve => identityServer.close(() => resolve()));
  await pool.end(); await admin.query(`DROP DATABASE \`${database}\``); await admin.end();
}
