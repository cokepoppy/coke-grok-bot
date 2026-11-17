import { execFileSync } from 'node:child_process';
import mysql from 'mysql2/promise';
import { TestDataCleanupStore } from '../src/server/test-data-cleanup-store.ts';
import type { Session } from '../src/server/tenant-store.ts';

type Options = { email: string; botNamePrefixes: string[]; groupNamePrefixes: string[]; apply: boolean; confirmation: string };

function args(argv: string[]): Options {
  const options: Options = { email: '', botNamePrefixes: [], groupNamePrefixes: [], apply: false, confirmation: '' };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--apply') { options.apply = true; continue; }
    const value = argv[++index];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === '--email') options.email = value.trim().toLowerCase();
    else if (flag === '--bot-prefix') options.botNamePrefixes.push(value);
    else if (flag === '--group-prefix') options.groupNamePrefixes.push(value);
    else if (flag === '--confirm') options.confirmation = value;
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.email)) throw new Error('Provide exactly one account with --email.');
  if (!options.botNamePrefixes.length && !options.groupNamePrefixes.length) throw new Error('Provide at least one --bot-prefix or --group-prefix.');
  if (options.apply && options.confirmation !== 'DELETE_MATCHING_TEST_FIXTURES') throw new Error('Applying cleanup requires --confirm DELETE_MATCHING_TEST_FIXTURES.');
  if (!options.apply && options.confirmation) throw new Error('--confirm is accepted only together with --apply.');
  return options;
}

function command(name: string, commandArgs: string[]): string {
  return execFileSync(name, commandArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function main(): Promise<void> {
  const options = args(process.argv.slice(2));
  const context = command('kubectl', ['config', 'current-context']);
  if (context !== 'k3d-tp1121-sandbox-dev') throw new Error(`Refusing cleanup outside the known local K3D context (current: ${context}).`);
  const databaseConfig = JSON.parse(command('kubectl', ['get', 'configmap', 'auth-config', '-n', 'coke-grok-bot', '-o', 'json'])) as { data?: Record<string, string> };
  const user = databaseConfig.data?.COKE_GROK_MYSQL_USER;
  const database = databaseConfig.data?.COKE_GROK_MYSQL_DATABASE;
  if (user !== 'coke_grok_k3d' || database !== 'coke_grok_local') throw new Error('Refusing cleanup: the app database does not match the local development database.');
  const mysqlContainer = JSON.parse(command('docker', ['inspect', 'coke-grok-local-auth-mysql'])) as Array<{ State?: { Status?: string }; NetworkSettings?: { Ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null> } }>;
  const published = mysqlContainer[0]?.NetworkSettings?.Ports?.['3306/tcp'] || [];
  if (mysqlContainer[0]?.State?.Status !== 'running' || !published.some(port => port.HostIp === '127.0.0.1' && port.HostPort === '13316')) {
    throw new Error('Refusing cleanup: the expected single local app MySQL container is not running at 127.0.0.1:13316.');
  }
  const password = command('kubectl', ['exec', '-n', 'coke-grok-bot', 'deploy/coke-grok-auth', '-c', 'auth', '--', 'cat', '/run/coke-secrets/mysql-password']);
  const pool = mysql.createPool({ host: '127.0.0.1', port: 13316, user, database, password, timezone: 'Z', connectionLimit: 2 });
  try {
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(`SELECT u.id AS userId,t.id AS tenantId,u.email
      FROM users u JOIN tenants t ON t.owner_id=u.id AND t.tenant_type='personal'
      JOIN memberships m ON m.tenant_id=t.id AND m.user_id=u.id AND m.role='owner'
      WHERE LOWER(u.email)=? ORDER BY t.id`, [options.email]);
    if (rows.length !== 1) throw new Error(`Expected one personal workspace for ${options.email}; found ${rows.length}.`);
    const row = rows[0];
    const session: Session = { userId: String(row.userId), tenantId: String(row.tenantId), email: String(row.email), name: '', role: 'owner' };
    const cleanup = new TestDataCleanupStore(pool);
    const request = { botNamePrefixes: options.botNamePrefixes, groupNamePrefixes: options.groupNamePrefixes };
    const plan = options.apply ? await cleanup.apply(session, request) : await cleanup.preview(session, request);
    process.stdout.write(JSON.stringify({ mode: options.apply ? 'applied' : 'preview', workspace: 'personal', account: options.email,
      bots: plan.bots, groups: plan.groups, counts: plan.counts, blockers: plan.blockers, workspaceFilesTouched: plan.workspaceFilesTouched }, null, 2) + '\n');
    if (!options.apply) process.stdout.write('Preview only. Add --apply --confirm DELETE_MATCHING_TEST_FIXTURES to remove these exact matches.\n');
  } finally { await pool.end(); }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Test data cleanup failed.'}\n`);
  process.exitCode = 1;
});
