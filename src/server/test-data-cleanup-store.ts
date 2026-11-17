import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { ExecuteValues } from 'mysql2';
import type { Session } from './tenant-store.ts';

export interface TestDataCleanupRequest {
  botNamePrefixes: string[];
  groupNamePrefixes: string[];
}

export interface TestDataCleanupPlan {
  botNamePrefixes: string[];
  groupNamePrefixes: string[];
  bots: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
  counts: {
    botMessages: number;
    voiceCalls: number;
    runs: number;
    groupMessages: number;
    groupTurns: number;
    routines: number;
    memories: number;
    fileMetadata: number;
  };
  blockers: string[];
  workspaceFilesTouched: false;
};

const maxPrefixes = 8;
const maxPrefixLength = 60;

function normalizePrefixes(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length > maxPrefixes || value.some(item => typeof item !== 'string')) throw new Error(`Invalid ${name}`);
  const values = [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
  if (values.some(prefix => prefix.length > maxPrefixLength || /[\u0000-\u001f\u007f]/.test(prefix))) throw new Error(`Invalid ${name}`);
  return values;
}

export function validateTestDataCleanupRequest(value: unknown): TestDataCleanupRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cleanup request');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !['botNamePrefixes', 'groupNamePrefixes'].includes(key))) throw new Error('Invalid cleanup request');
  const botNamePrefixes = normalizePrefixes(body.botNamePrefixes ?? [], 'Bot name prefixes');
  const groupNamePrefixes = normalizePrefixes(body.groupNamePrefixes ?? [], 'group name prefixes');
  if (!botNamePrefixes.length && !groupNamePrefixes.length) throw new Error('Choose a Bot or group test-name prefix');
  return { botNamePrefixes, groupNamePrefixes };
}

function prefixCondition(column: string, prefixes: string[], parameters: ExecuteValues[]): string {
  if (!prefixes.length) return 'FALSE';
  return `(${prefixes.map(prefix => {
    parameters.push(prefix, prefix);
    return `LEFT(${column}, CHAR_LENGTH(?)) = ?`;
  }).join(' OR ')})`;
}

function inCondition(column: string, ids: string[], parameters: ExecuteValues[]): string {
  if (!ids.length) return 'FALSE';
  parameters.push(...ids);
  return `${column} IN (${ids.map(() => '?').join(',')})`;
}

async function tableExists(connection: Pool | PoolConnection, table: string): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
  return rows.length > 0;
}

async function countByIds(connection: Pool | PoolConnection, table: string, column: string, ids: string[]): Promise<number> {
  if (!ids.length || !await tableExists(connection, table)) return 0;
  const parameters: ExecuteValues[] = [];
  const where = inCondition(column, ids, parameters);
  const [rows] = await connection.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${table}\` WHERE ${where}`, parameters);
  return Number(rows[0]?.total || 0);
}

async function buildPlan(connection: Pool | PoolConnection, session: Session, request: TestDataCleanupRequest, lock = false): Promise<TestDataCleanupPlan> {
  const botParameters: ExecuteValues[] = [session.tenantId, session.userId];
  const botFilter = prefixCondition('name', request.botNamePrefixes, botParameters);
  const botLock = lock ? ' FOR UPDATE' : '';
  const [botRows] = request.botNamePrefixes.length
    ? await connection.execute<RowDataPacket[]>(`SELECT id,name FROM bots WHERE tenant_id=? AND owner_id=? AND ${botFilter} ORDER BY created_at,id${botLock}`, botParameters)
    : [[], []] as unknown as [RowDataPacket[], unknown];
  const bots = botRows.map(row => ({ id: String(row.id), name: String(row.name) }));

  const groupTableAvailable = await tableExists(connection, 'bot_group_chats');
  if (request.groupNamePrefixes.length && !groupTableAvailable) throw new Error('Group chat storage is unavailable');
  const groupParameters: ExecuteValues[] = [session.tenantId, session.userId];
  const groupFilter = prefixCondition('name', request.groupNamePrefixes, groupParameters);
  const [groupRows] = request.groupNamePrefixes.length
    ? await connection.execute<RowDataPacket[]>(`SELECT id,name FROM bot_group_chats WHERE tenant_id=? AND owner_id=? AND ${groupFilter} ORDER BY created_at,id${lock ? ' FOR UPDATE' : ''}`, groupParameters)
    : [[], []] as unknown as [RowDataPacket[], unknown];
  const groups = groupRows.map(row => ({ id: String(row.id), name: String(row.name) }));
  const botIds = bots.map(bot => bot.id);
  const groupIds = groups.map(group => group.id);
  const blockers: string[] = [];

  if (groupIds.length) {
    const [members] = await connection.execute<RowDataPacket[]>(`SELECT m.group_id AS groupId,b.id AS botId
      FROM bot_group_members m JOIN bot_group_chats g ON g.id=m.group_id
      LEFT JOIN bots b ON b.id=m.bot_id AND b.tenant_id=g.tenant_id AND b.owner_id=g.owner_id
      WHERE g.tenant_id=? AND g.owner_id=? AND m.group_id IN (${groupIds.map(() => '?').join(',')})`, [session.tenantId, session.userId, ...groupIds]);
    if (members.some(row => row.botId == null)) blockers.push('A selected group contains a Bot outside this account.');
  }

  if (botIds.length && await tableExists(connection, 'bot_group_members')) {
    const parameters: ExecuteValues[] = [session.tenantId, session.userId];
    const selectedBots = inCondition('m.bot_id', botIds, parameters);
    const selectedGroups = inCondition('g.id', groupIds, parameters);
    const [rows] = await connection.execute<RowDataPacket[]>(`SELECT COUNT(DISTINCT g.id) AS total
      FROM bot_group_members m JOIN bot_group_chats g ON g.id=m.group_id
      WHERE g.tenant_id=? AND g.owner_id=? AND ${selectedBots} AND NOT ${selectedGroups}`, parameters);
    if (Number(rows[0]?.total || 0) > 0) blockers.push('A selected Bot belongs to a group that was not selected for cleanup.');
  }

  let runIds: string[] = [];
  if (botIds.length && await tableExists(connection, 'agent_runs')) {
    const parameters: ExecuteValues[] = [];
    const where = inCondition('bot_id', botIds, parameters);
    const [rows] = await connection.execute<RowDataPacket[]>(`SELECT id,status FROM agent_runs WHERE ${where} ORDER BY sequence${lock ? ' FOR UPDATE' : ''}`, parameters);
    runIds = rows.map(row => String(row.id));
    if (rows.some(row => row.status === 'queued' || row.status === 'running')) blockers.push('A selected Bot still has a queued or running task.');
  }

  if (botIds.length && await tableExists(connection, 'bot_handoffs')) {
    const parameters: ExecuteValues[] = [session.tenantId, session.userId];
    const clauses = [
      inCondition('source_bot_id', botIds, parameters),
      inCondition('target_bot_id', botIds, parameters),
    ];
    if (runIds.length) {
      for (const column of ['root_run_id', 'source_run_id', 'delegated_run_id', 'target_run_id', 'response_run_id']) clauses.push(inCondition(column, runIds, parameters));
    }
    const [rows] = await connection.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM bot_handoffs WHERE tenant_id=? AND owner_id=? AND (${clauses.join(' OR ')})`, parameters);
    if (Number(rows[0]?.total || 0) > 0) blockers.push('A selected Bot has Bot-to-Bot handoff records; those runs are preserved for a separate cleanup.');
  }
  if (runIds.length && botIds.length && await tableExists(connection, 'bot_memories')) {
    const [rows] = await connection.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM bot_memories
      WHERE source_run_id IN (${runIds.map(() => '?').join(',')}) AND bot_id NOT IN (${botIds.map(() => '?').join(',')})`, [...runIds, ...botIds]);
    if (Number(rows[0]?.total || 0) > 0) blockers.push('A different Bot has memory linked to one of these test runs.');
  }

  const countForBots = async (table: string): Promise<number> => countByIds(connection, table, 'bot_id', botIds);
  const countForGroups = async (table: string): Promise<number> => countByIds(connection, table, 'group_id', groupIds);
  const [runCount, botMessages, voiceCalls, groupMessages, groupTurns, routines, memories, fileMetadata] = await Promise.all([
    countByIds(connection, 'agent_runs', 'bot_id', botIds),
    countForBots('bot_messages'),
    countForBots('bot_voice_calls'),
    countForGroups('bot_group_messages'),
    countForGroups('bot_group_turns'),
    countForBots('bot_routines'),
    countForBots('bot_memories'),
    countForBots('bot_files'),
  ]);
  return { botNamePrefixes: request.botNamePrefixes, groupNamePrefixes: request.groupNamePrefixes, bots, groups,
    counts: { botMessages, voiceCalls, runs: runCount, groupMessages, groupTurns, routines, memories, fileMetadata }, blockers, workspaceFilesTouched: false };
}

async function deleteIds(connection: PoolConnection, table: string, column: string, ids: string[]): Promise<void> {
  if (!ids.length || !await tableExists(connection, table)) return;
  const parameters: ExecuteValues[] = [];
  const where = inCondition(column, ids, parameters);
  await connection.execute(`DELETE FROM \`${table}\` WHERE ${where}`, parameters);
}

/** Removes only explicitly name-prefixed Bots/groups owned by the current session. PVC bytes and browser sign-ins are never touched. */
export class TestDataCleanupStore {
  constructor(private readonly pool: Pool) {}

  async preview(session: Session, requestValue: unknown): Promise<TestDataCleanupPlan> {
    const request = validateTestDataCleanupRequest(requestValue);
    return buildPlan(this.pool, session, request);
  }

  async apply(session: Session, requestValue: unknown): Promise<TestDataCleanupPlan> {
    const request = validateTestDataCleanupRequest(requestValue);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const plan = await buildPlan(connection, session, request, true);
      if (plan.blockers.length) throw new Error(`Cleanup blocked: ${plan.blockers.join(' ')}`);
      const botIds = plan.bots.map(bot => bot.id);
      const groupIds = plan.groups.map(group => group.id);
      const runIds = botIds.length && await tableExists(connection, 'agent_runs')
        ? (await connection.execute<RowDataPacket[]>(`SELECT id FROM agent_runs WHERE bot_id IN (${botIds.map(() => '?').join(',')})`, botIds))[0].map(row => String(row.id))
        : [];
      const routineIds = botIds.length && await tableExists(connection, 'bot_routines')
        ? (await connection.execute<RowDataPacket[]>(`SELECT id FROM bot_routines WHERE bot_id IN (${botIds.map(() => '?').join(',')})`, botIds))[0].map(row => String(row.id))
        : [];
      if (runIds.length) {
        if (await tableExists(connection, 'approval_screenshots')) await connection.execute(`DELETE s FROM approval_screenshots s JOIN run_approvals a ON a.id=s.approval_id WHERE a.run_id IN (${runIds.map(() => '?').join(',')})`, runIds);
        await deleteIds(connection, 'run_approvals', 'run_id', runIds);
        await deleteIds(connection, 'bot_memories', 'source_run_id', runIds);
      }
      if (routineIds.length && await tableExists(connection, 'routine_runs')) await deleteIds(connection, 'routine_runs', 'routine_id', routineIds);
      if (groupIds.length) await deleteIds(connection, 'bot_group_chats', 'id', groupIds);
      if (runIds.length) {
        await deleteIds(connection, 'agent_run_events', 'run_id', runIds);
        await deleteIds(connection, 'agent_runs', 'id', runIds);
      }
      if (botIds.length) {
        await deleteIds(connection, 'bot_messages', 'bot_id', botIds);
        await deleteIds(connection, 'bot_voice_calls', 'bot_id', botIds);
        await deleteIds(connection, 'bot_memories', 'bot_id', botIds);
        await deleteIds(connection, 'routine_runs', 'routine_id', routineIds);
        await deleteIds(connection, 'bot_routines', 'bot_id', botIds);
        await deleteIds(connection, 'bots', 'id', botIds);
      }
      await connection.commit();
      return plan;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }
}
