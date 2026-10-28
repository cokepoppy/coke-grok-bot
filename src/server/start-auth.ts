import { readFile, stat } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { TenantStore } from './tenant-store.ts';
import { GoogleAuthService, GoogleIdentityProvider } from './google-auth.ts';
import { createAuthServer } from './auth-http.ts';
import { parsePublicUrl } from './public-url.ts';

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
  const [password, googleSecret] = await Promise.all([secret('COKE_GROK_MYSQL_PASSWORD_FILE'), secret('COKE_GROK_GOOGLE_SECRET_FILE')]);
  const port = Number(process.env.COKE_GROK_AUTH_PORT || 3001);
  const mysqlPort = Number(process.env.COKE_GROK_MYSQL_PORT || 3306);
  if (![port, mysqlPort].every(value => Number.isInteger(value) && value > 0 && value <= 65535)) throw new Error('Invalid port');
  const pool = mysql.createPool({ host: required('COKE_GROK_MYSQL_HOST'), port: mysqlPort, user: required('COKE_GROK_MYSQL_USER'), database: required('COKE_GROK_MYSQL_DATABASE'), password, timezone: 'Z', connectionLimit: 10 });
  const store = new TenantStore(pool);
  await store.migrate();
  const provider = new GoogleIdentityProvider(googleClientId, googleSecret, `${origin}/auth/google/callback`);
  const server = createAuthServer(new GoogleAuthService(store, provider, origin), origin);
  server.listen(port, process.env.COKE_GROK_AUTH_HOST || '127.0.0.1', () => console.log(`Auth service listening on port ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => server.close(() => { void pool.end(); }));
}
main().catch(() => { console.error('Auth service failed to start; check configuration and database access.'); process.exitCode = 1; });
