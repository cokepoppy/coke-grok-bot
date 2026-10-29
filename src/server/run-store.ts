import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { ResultSetHeader } from 'mysql2';
import type { Session } from './tenant-store.ts';

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'unknown';
export interface AgentRun { id: string; botId: string; prompt: string; status: RunStatus; result: string | null }
export type RunOwner = Pick<Session, 'tenantId' | 'userId'>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class RunRequestConflict extends Error {}

/** Persistent run queue. An expired lease is unknown, never automatically retried. */
export class RunStore {
  constructor(private readonly pool: Pool) {}
  async migrate(): Promise<void> {
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS agent_runs (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
      bot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      prompt TEXT NOT NULL,
      status ENUM('queued','running','completed','failed','unknown') NOT NULL,
      result TEXT NULL,
      lease_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      lease_until DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY request_dedup (bot_id, request_id),
      KEY queue_order (status, sequence),
      KEY bot_runs (bot_id, sequence),
      FOREIGN KEY (bot_id) REFERENCES bots(id)
    ) ENGINE=InnoDB`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS agent_run_events (
      sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status ENUM('queued','running','completed','failed','unknown') NOT NULL,
      detail TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY run_history (run_id, sequence),
      FOREIGN KEY (run_id) REFERENCES agent_runs(id)
    ) ENGINE=InnoDB`);
  }
  async create(session: Session, botId: string, requestId: string, prompt: string): Promise<AgentRun | null> {
    const clean = prompt.trim();
    if (!uuid.test(botId) || !uuid.test(requestId) || !clean || clean.length > 10000) throw new Error('Invalid run');
    return this.transaction(async connection => {
      const [owned] = await connection.execute<RowDataPacket[]>('SELECT id FROM bots WHERE id=? AND tenant_id=? AND owner_id=? FOR UPDATE', [botId,session.tenantId,session.userId]);
      if (!owned.length) return null;
      const [existing] = await connection.execute<RowDataPacket[]>('SELECT id, bot_id AS botId, prompt, status, result FROM agent_runs WHERE bot_id=? AND request_id=?', [botId,requestId]);
      if (existing.length) {
        if (existing[0].prompt !== clean) throw new RunRequestConflict('Request ID already used with a different prompt');
        return existing[0] as AgentRun;
      }
      const run: AgentRun = { id:randomUUID(), botId, prompt:clean, status:'queued', result:null };
      await connection.execute('INSERT INTO agent_runs (id,bot_id,request_id,prompt,status) VALUES (?,?,?,?,?)',[run.id,botId,requestId,clean,run.status]);
      await connection.execute('INSERT INTO agent_run_events (run_id,status) VALUES (?,?)',[run.id,run.status]);
      return run;
    });
  }
  async list(session: Session, botId: string): Promise<AgentRun[] | null> {
    const [owned] = await this.pool.execute<RowDataPacket[]>('SELECT id FROM bots WHERE id=? AND tenant_id=? AND owner_id=?',[botId,session.tenantId,session.userId]);
    if (!owned.length) return null;
    const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT id,bot_id AS botId,prompt,status,result FROM agent_runs WHERE bot_id=? ORDER BY sequence',[botId]);
    return rows as AgentRun[];
  }
  async queuedOwners(limit: number): Promise<RunOwner[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid owner limit');
    const [rows] = await this.pool.execute<RowDataPacket[]>(`SELECT b.tenant_id AS tenantId, b.owner_id AS userId, MIN(r.sequence) AS firstRun
      FROM agent_runs r JOIN bots b ON b.id=r.bot_id
      WHERE r.status='queued' AND NOT EXISTS (
        SELECT 1 FROM agent_runs active JOIN bots owner_bot ON owner_bot.id=active.bot_id
        WHERE owner_bot.tenant_id=b.tenant_id AND owner_bot.owner_id=b.owner_id AND active.status IN ('running','unknown')
      ) GROUP BY b.tenant_id,b.owner_id ORDER BY firstRun LIMIT ?`, [limit]);
    return rows.map(row => ({tenantId:String(row.tenantId),userId:String(row.userId)}));
  }
  /** A personal computer has at most one running or unresolved run across its Bots. */
  async claimNext(session: Pick<Session,'tenantId'|'userId'>, leaseSeconds: number): Promise<{ run: AgentRun; leaseId: string } | null> {
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 900) throw new Error('Invalid lease');
    return this.transaction(async connection => {
      const [membership] = await connection.execute<RowDataPacket[]>('SELECT user_id FROM memberships WHERE tenant_id=? AND user_id=? FOR UPDATE',[session.tenantId,session.userId]);
      if (!membership.length) return null;
      const [active] = await connection.execute<RowDataPacket[]>(`SELECT r.id FROM agent_runs r JOIN bots b ON b.id=r.bot_id WHERE b.tenant_id=? AND b.owner_id=? AND r.status IN ('running','unknown') LIMIT 1 FOR UPDATE`,[session.tenantId,session.userId]);
      if (active.length) return null;
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT r.id,r.bot_id AS botId,r.prompt,r.status,r.result FROM agent_runs r JOIN bots b ON b.id=r.bot_id WHERE b.tenant_id=? AND b.owner_id=? AND r.status='queued' ORDER BY r.sequence LIMIT 1 FOR UPDATE`,[session.tenantId,session.userId]);
      if (!rows.length) return null;
      const run = rows[0] as AgentRun, leaseId = randomUUID();
      await connection.execute(`UPDATE agent_runs SET status='running',lease_id=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND) WHERE id=?`,[leaseId,leaseSeconds,run.id]);
      await connection.execute(`INSERT INTO agent_run_events (run_id,status) VALUES (?,'running')`,[run.id]);
      return { run:{...run,status:'running'}, leaseId };
    });
  }
  async finish(runId: string, leaseId: string, status: 'completed' | 'failed', result: string): Promise<boolean> {
    if (!uuid.test(runId) || !uuid.test(leaseId) || !['completed','failed'].includes(status) || !result.trim() || result.length > 20000) throw new Error('Invalid run result');
    return this.transaction(async connection => {
      const [updated] = await connection.execute<ResultSetHeader>(`UPDATE agent_runs SET status=?,result=?,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=? AND status='running' AND lease_until>UTC_TIMESTAMP(3)`,[status,result,runId,leaseId]);
      if (!updated.affectedRows) return false;
      await connection.execute('INSERT INTO agent_run_events (run_id,status,detail) VALUES (?,?,?)',[runId,status,result]);
      return true;
    });
  }
  async renew(runId: string, leaseId: string, leaseSeconds: number): Promise<boolean> {
    if (!uuid.test(runId) || !uuid.test(leaseId) || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 900) throw new Error('Invalid lease');
    const [updated] = await this.pool.execute<ResultSetHeader>(`UPDATE agent_runs SET lease_until=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND) WHERE id=? AND lease_id=? AND status='running' AND lease_until>UTC_TIMESTAMP(3)`,[leaseSeconds,runId,leaseId]);
    return updated.affectedRows === 1;
  }
  async markUnknown(runId: string, leaseId: string): Promise<boolean> {
    if (!uuid.test(runId) || !uuid.test(leaseId)) throw new Error('Invalid lease');
    return this.transaction(async connection => {
      const [updated] = await connection.execute<ResultSetHeader>(`UPDATE agent_runs SET status='unknown',lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=? AND status='running'`,[runId,leaseId]);
      if (!updated.affectedRows) return false;
      await connection.execute(`INSERT INTO agent_run_events (run_id,status) VALUES (?,'unknown')`,[runId]);
      return true;
    });
  }
  async markExpiredUnknown(): Promise<number> {
    return this.transaction(async connection => {
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT id FROM agent_runs WHERE status='running' AND lease_until<=UTC_TIMESTAMP(3) ORDER BY lease_until LIMIT 100 FOR UPDATE`);
      for (const row of rows) {
        await connection.execute(`UPDATE agent_runs SET status='unknown',lease_id=NULL,lease_until=NULL WHERE id=?`,[row.id]);
        await connection.execute(`INSERT INTO agent_run_events (run_id,status) VALUES (?,'unknown')`,[row.id]);
      }
      return rows.length;
    });
  }
  async events(session: Session, runId: string): Promise<Array<{ sequence: number; status: RunStatus; detail: string | null }> | null> {
    const [owned] = await this.pool.execute<RowDataPacket[]>(`SELECT r.id FROM agent_runs r JOIN bots b ON b.id=r.bot_id WHERE r.id=? AND b.tenant_id=? AND b.owner_id=?`,[runId,session.tenantId,session.userId]);
    if (!owned.length) return null;
    const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT sequence,status,detail FROM agent_run_events WHERE run_id=? ORDER BY sequence',[runId]);
    return rows as Array<{ sequence:number; status:RunStatus; detail:string|null }>;
  }
  private async transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
    catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
}
