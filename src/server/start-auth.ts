import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { TenantStore } from './tenant-store.ts';
import { GoogleAuthService, GoogleIdentityProvider } from './google-auth.ts';
import { createAuthServer } from './auth-http.ts';
import { parsePublicUrl } from './public-url.ts';
import { BotStore } from './bot-store.ts';
import { startPiRuntime } from './pi-runtime.ts';

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}
async function secret(key: string): Promise<string> {
  const path = required(key);
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error(`${key} must refer to a private file (mode 0600)`);
  const value = (await readFile(path, 'utf8')).trim();
  if (!value) throw new Error(`${key} is empty`);
  return value;
}
async function main() {
  const origin = parsePublicUrl(required('COKE_GROK_PUBLIC_ORIGIN')).baseUrl;
  const googleClientId = required('COKE_GROK_GOOGLE_CLIENT_ID');
  const staticDirectory = process.env.COKE_GROK_STATIC_DIR;
  if (staticDirectory) {
    const metadata = JSON.parse(await readFile(join(staticDirectory, 'web-build.json'), 'utf8')) as { basePath?: string; requireAuth?: boolean };
    if (metadata.basePath !== `${parsePublicUrl(origin).prefix}/` || metadata.requireAuth !== true) throw new Error('Frontend build does not match the public path or require authentication');
  }
  const [password, googleSecret] = await Promise.all([secret('COKE_GROK_MYSQL_PASSWORD_FILE'), secret('COKE_GROK_GOOGLE_SECRET_FILE')]);
  const port = Number(process.env.COKE_GROK_AUTH_PORT || 3001);
  const mysqlPort = Number(process.env.COKE_GROK_MYSQL_PORT || 3306);
  if (![port, mysqlPort].every(value => Number.isInteger(value) && value > 0 && value <= 65535)) throw new Error('Invalid port');
  const provider = new GoogleIdentityProvider(googleClientId, googleSecret, `${origin}/auth/google/callback`, process.env.COKE_GROK_GOOGLE_OAUTH_PROXY_URL || '');
  const pool = mysql.createPool({ host: required('COKE_GROK_MYSQL_HOST'), port: mysqlPort, user: required('COKE_GROK_MYSQL_USER'), database: required('COKE_GROK_MYSQL_DATABASE'), password, timezone: 'Z', connectionLimit: 10 });
  const store = new TenantStore(pool);
  const bots = new BotStore(pool);
  try { await store.migrate(); await bots.migrate(); await store.pruneExpiredAuth(); }
  catch (error) { await pool.end(); throw error; }
  let pi: Awaited<ReturnType<typeof startPiRuntime>>;
  try { pi = await startPiRuntime(pool); } catch (error) { await pool.end(); throw error; }
  const cleanup = setInterval(() => { void store.pruneExpiredAuth().catch(() => console.error('Expired auth cleanup failed.')); }, 60 * 60 * 1000);
  cleanup.unref();
  const server = createAuthServer(new GoogleAuthService(store, provider, origin), origin, staticDirectory, bots, pi?.runs);
  server.listen(port, process.env.COKE_GROK_AUTH_HOST || '127.0.0.1', () => console.log(`Auth service listening on port ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { clearInterval(cleanup); server.close(() => { void (async () => { await pi?.close(); await pool.end(); })(); }); });
}
main().catch(error => { console.error(error instanceof Error && error.message === 'Frontend build does not match the public path or require authentication' ? 'Frontend build does not match the public path or require authentication.' : 'Auth service failed to start; check configuration and database access.'); process.exitCode = 1; });
