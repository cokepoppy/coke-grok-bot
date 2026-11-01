import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { ResultSetHeader } from 'mysql2';
import type { Session } from './tenant-store.ts';
import { WorkspaceFileStore, type RunFile } from './file-store.ts';
import { isRunDiagnosticCode, type RunDiagnosticCode } from './run-diagnostics.ts';

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'unknown';
export type RecoveryState = 'none' | 'pending' | 'retried' | 'acknowledged';
export interface AgentRun { id: string; botId: string; prompt: string; status: RunStatus; result: string | null; recoveryState: RecoveryState; replacementRunId: string | null; files: RunFile[] }
export interface RunRecoveryResult { decision: 'retry' | 'acknowledge'; run: AgentRun | null }
export type RunOwner = Pick<Session, 'tenantId' | 'userId'>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class RunRequestConflict extends Error {}
export class RunRecoveryConflict extends Error {}

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
      recovery_state ENUM('none','pending','retried','acknowledged') NOT NULL DEFAULT 'none',
      replacement_run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      attachment_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
      lease_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      lease_until DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY request_dedup (bot_id, request_id),
      KEY queue_order (status, sequence),
      KEY bot_runs (bot_id, sequence),
      FOREIGN KEY (bot_id) REFERENCES bots(id)
    ) ENGINE=InnoDB`);
    const [columns] = await this.pool.execute<RowDataPacket[]>(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='agent_runs'`);
    const names = new Set(columns.map(column => String(column.COLUMN_NAME)));
    if (!names.has('recovery_state')) await this.pool.execute(`ALTER TABLE agent_runs ADD COLUMN recovery_state ENUM('none','pending','retried','acknowledged') NOT NULL DEFAULT 'none' AFTER result`);
    if (!names.has('replacement_run_id')) await this.pool.execute('ALTER TABLE agent_runs ADD COLUMN replacement_run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER recovery_state');
    if (!names.has('attachment_hash')) await this.pool.execute("ALTER TABLE agent_runs ADD COLUMN attachment_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' AFTER replacement_run_id");
    await this.pool.execute(`UPDATE agent_runs SET recovery_state='pending' WHERE status='unknown' AND recovery_state='none'`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS agent_run_events (
      sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status ENUM('queued','running','completed','failed','unknown') NOT NULL,
      detail TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY run_history (run_id, sequence),
      FOREIGN KEY (run_id) REFERENCES agent_runs(id)
    ) ENGINE=InnoDB`);
    await new WorkspaceFileStore(this.pool).migrate();
  }
  async create(session: Session, botId: string, requestId: string, prompt: string, fileIdsValue?: unknown): Promise<AgentRun | null> {
    const clean = prompt.trim();
    if (!uuid.test(botId) || !uuid.test(requestId) || !clean || clean.length > 10000) throw new Error('Invalid run');
    const fileIds = WorkspaceFileStore.validateFileIds(fileIdsValue);
    const attachmentHash = createHash('sha256').update(JSON.stringify([...fileIds].sort())).digest('hex');
    return this.transaction(async connection => {
      const [owned] = await connection.execute<RowDataPacket[]>('SELECT id FROM bots WHERE id=? AND tenant_id=? AND owner_id=? FOR UPDATE', [botId,session.tenantId,session.userId]);
      if (!owned.length) return null;
      const inputs = await this.inputFiles(connection,session,botId,fileIds);
      const [existing] = await connection.execute<RowDataPacket[]>('SELECT id, bot_id AS botId, prompt, status, result, recovery_state AS recoveryState, replacement_run_id AS replacementRunId, attachment_hash AS attachmentHash FROM agent_runs WHERE bot_id=? AND request_id=?', [botId,requestId]);
      if (existing.length) {
        const storedHash=String(existing[0].attachmentHash||'');
        if (existing[0].prompt !== clean || (storedHash ? storedHash !== attachmentHash : fileIds.length > 0)) throw new RunRequestConflict('Request ID already used with different content');
        return { ...existing[0], files:await this.filesForRun(connection,String(existing[0].id)) } as AgentRun;
      }
      const run: AgentRun = { id:randomUUID(), botId, prompt:clean, status:'queued', result:null, recoveryState:'none', replacementRunId:null, files:inputs };
      await connection.execute('INSERT INTO agent_runs (id,bot_id,request_id,prompt,status,recovery_state,attachment_hash) VALUES (?,?,?,?,?,?,?)',[run.id,botId,requestId,clean,run.status,run.recoveryState,attachmentHash]);
      for (const fileId of fileIds) await connection.execute("INSERT INTO agent_run_files (run_id,file_id,kind) VALUES (?,?,'input')",[run.id,fileId]);
      await connection.execute('INSERT INTO agent_run_events (run_id,status) VALUES (?,?)',[run.id,run.status]);
      return run;
    });
  }
  async list(session: Session, botId: string): Promise<AgentRun[] | null> {
    const [owned] = await this.pool.execute<RowDataPacket[]>('SELECT id FROM bots WHERE id=? AND tenant_id=? AND owner_id=?',[botId,session.tenantId,session.userId]);
    if (!owned.length) return null;
    const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT id,bot_id AS botId,prompt,status,result,recovery_state AS recoveryState,replacement_run_id AS replacementRunId FROM agent_runs WHERE bot_id=? ORDER BY sequence',[botId]);
    if (!rows.length) return [];
    const files = await this.filesForRuns(this.pool,rows.map(row=>String(row.id)));
    return rows.map(row=>({...row,files:files.get(String(row.id))||[]})) as AgentRun[];
  }
  async queuedOwners(limit: number): Promise<RunOwner[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid owner limit');
    const [rows] = await this.pool.execute<RowDataPacket[]>(`SELECT b.tenant_id AS tenantId, b.owner_id AS userId, MIN(r.sequence) AS firstRun
      FROM agent_runs r JOIN bots b ON b.id=r.bot_id
      WHERE r.status='queued' AND NOT EXISTS (
        SELECT 1 FROM agent_runs active JOIN bots owner_bot ON owner_bot.id=active.bot_id
        WHERE owner_bot.tenant_id=b.tenant_id AND owner_bot.owner_id=b.owner_id AND (active.status='running' OR (active.status='unknown' AND active.recovery_state='pending'))
      ) GROUP BY b.tenant_id,b.owner_id ORDER BY firstRun LIMIT ?`, [limit]);
    return rows.map(row => ({tenantId:String(row.tenantId),userId:String(row.userId)}));
  }
  /** A personal computer has at most one running or unresolved run across its Bots. */
  async claimNext(session: Pick<Session,'tenantId'|'userId'>, leaseSeconds: number): Promise<{ run: AgentRun; leaseId: string } | null> {
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 900) throw new Error('Invalid lease');
    return this.transaction(async connection => {
      const [membership] = await connection.execute<RowDataPacket[]>('SELECT user_id FROM memberships WHERE tenant_id=? AND user_id=? FOR UPDATE',[session.tenantId,session.userId]);
      if (!membership.length) return null;
      const [active] = await connection.execute<RowDataPacket[]>(`SELECT r.id FROM agent_runs r JOIN bots b ON b.id=r.bot_id WHERE b.tenant_id=? AND b.owner_id=? AND (r.status='running' OR (r.status='unknown' AND r.recovery_state='pending')) LIMIT 1 FOR UPDATE`,[session.tenantId,session.userId]);
      if (active.length) return null;
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT r.id,r.bot_id AS botId,r.prompt,r.status,r.result,r.recovery_state AS recoveryState,r.replacement_run_id AS replacementRunId FROM agent_runs r JOIN bots b ON b.id=r.bot_id WHERE b.tenant_id=? AND b.owner_id=? AND r.status='queued' ORDER BY r.sequence LIMIT 1 FOR UPDATE`,[session.tenantId,session.userId]);
      if (!rows.length) return null;
      const run = rows[0] as AgentRun, leaseId = randomUUID();
      await connection.execute(`UPDATE agent_runs SET status='running',lease_id=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND) WHERE id=?`,[leaseId,leaseSeconds,run.id]);
      await connection.execute(`INSERT INTO agent_run_events (run_id,status) VALUES (?,'running')`,[run.id]);
      return { run:{...run,status:'running',files:await this.filesForRun(connection,run.id)}, leaseId };
    });
  }
  async finish(runId: string, leaseId: string, status: 'completed' | 'failed', result: string, artifactsValue: unknown = []): Promise<boolean> {
    if (!uuid.test(runId) || !uuid.test(leaseId) || !['completed','failed'].includes(status) || !result.trim() || result.length > 20000) throw new Error('Invalid run result');
    const artifacts=WorkspaceFileStore.validateArtifacts(artifactsValue,runId);
    return this.transaction(async connection => {
      const [runs]=await connection.execute<RowDataPacket[]>('SELECT bot_id AS botId FROM agent_runs WHERE id=? AND lease_id=? AND status=\'running\' AND lease_until>UTC_TIMESTAMP(3) FOR UPDATE',[runId,leaseId]);
      if(!runs.length)return false;
      const [updated] = await connection.execute<ResultSetHeader>(`UPDATE agent_runs SET status=?,result=?,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=? AND status='running' AND lease_until>UTC_TIMESTAMP(3)`,[status,result,runId,leaseId]);
      if (!updated.affectedRows) return false;
      for(const file of artifacts){
        const id=randomUUID();
        await connection.execute('INSERT INTO bot_files (id,bot_id,display_name,mime_type,size,sha256,storage_key) VALUES (?,?,?,?,?,?,?)',[id,runs[0].botId,file.name,file.mimeType,file.size,file.sha256,file.storageKey]);
        await connection.execute("INSERT INTO agent_run_files (run_id,file_id,kind) VALUES (?,?,'output')",[runId,id]);
      }
      await connection.execute('INSERT INTO agent_run_events (run_id,status,detail) VALUES (?,?,?)',[runId,status,result]);
      return true;
    });
  }
  async renew(runId: string, leaseId: string, leaseSeconds: number): Promise<boolean> {
    if (!uuid.test(runId) || !uuid.test(leaseId) || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 900) throw new Error('Invalid lease');
    const [updated] = await this.pool.execute<ResultSetHeader>(`UPDATE agent_runs SET lease_until=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND) WHERE id=? AND lease_id=? AND status='running' AND lease_until>UTC_TIMESTAMP(3)`,[leaseSeconds,runId,leaseId]);
    return updated.affectedRows === 1;
  }
  async hasLiveLease(owner: RunOwner, runId:string, leaseId:string):Promise<boolean> {
    if(!uuid.test(owner.tenantId)||!uuid.test(owner.userId)||!uuid.test(runId)||!uuid.test(leaseId))return false;
    const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT r.id FROM agent_runs r JOIN bots b ON b.id=r.bot_id WHERE r.id=? AND r.lease_id=? AND r.status='running' AND r.lease_until>UTC_TIMESTAMP(3) AND b.tenant_id=? AND b.owner_id=?`,[runId,leaseId,owner.tenantId,owner.userId]);
    return rows.length===1;
  }
  async markUnknown(runId: string, leaseId: string, diagnosticCode: RunDiagnosticCode = 'executor_error'): Promise<boolean> {
    if (!uuid.test(runId) || !uuid.test(leaseId) || !isRunDiagnosticCode(diagnosticCode)) throw new Error('Invalid lease');
    return this.transaction(async connection => {
      const [updated] = await connection.execute<ResultSetHeader>(`UPDATE agent_runs SET status='unknown',recovery_state='pending',replacement_run_id=NULL,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=? AND status='running'`,[runId,leaseId]);
      if (!updated.affectedRows) return false;
      await connection.execute(`INSERT INTO agent_run_events (run_id,status,detail) VALUES (?,'unknown',?)`,[runId,`diagnostic:${diagnosticCode}`]);
      return true;
    });
  }
  async markExpiredUnknown(): Promise<number> {
    return this.transaction(async connection => {
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT id FROM agent_runs WHERE status='running' AND lease_until<=UTC_TIMESTAMP(3) ORDER BY lease_until LIMIT 100 FOR UPDATE`);
      for (const row of rows) {
        await connection.execute(`UPDATE agent_runs SET status='unknown',recovery_state='pending',replacement_run_id=NULL,lease_id=NULL,lease_until=NULL WHERE id=?`,[row.id]);
        await connection.execute(`INSERT INTO agent_run_events (run_id,status,detail) VALUES (?,'unknown','diagnostic:lease_expired')`,[row.id]);
      }
      return rows.length;
    });
  }
  /** The owner must explicitly acknowledge uncertainty before the per-user queue can resume. */
  async resolveUnknown(session: Session, runId: string, decision: 'retry' | 'acknowledge'): Promise<RunRecoveryResult | null> {
    if (!uuid.test(runId) || !['retry','acknowledge'].includes(decision)) throw new Error('Invalid run recovery');
    return this.transaction(async connection => {
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT r.id,r.bot_id AS botId,r.prompt,r.status,r.recovery_state AS recoveryState,r.replacement_run_id AS replacementRunId
        FROM agent_runs r JOIN bots b ON b.id=r.bot_id WHERE r.id=? AND b.tenant_id=? AND b.owner_id=? FOR UPDATE`,[runId,session.tenantId,session.userId]);
      if (!rows.length) return null;
      const current = rows[0] as AgentRun;
      if (current.status !== 'unknown') throw new RunRecoveryConflict('Only an unknown run can be resolved');
      if (decision === 'acknowledge') {
        if (current.recoveryState === 'acknowledged') return {decision,run:null};
        if (current.recoveryState !== 'pending') throw new RunRecoveryConflict('This unknown run already has a different resolution');
        await connection.execute(`UPDATE agent_runs SET recovery_state='acknowledged' WHERE id=? AND status='unknown' AND recovery_state='pending'`,[runId]);
        await connection.execute(`INSERT INTO agent_run_events (run_id,status,detail) VALUES (?,'unknown','Owner reviewed the uncertain outcome and resumed the queue.')`,[runId]);
        return {decision,run:null};
      }
      if (current.recoveryState === 'retried' && current.replacementRunId) {
        const [replacement] = await connection.execute<RowDataPacket[]>(`SELECT id,bot_id AS botId,prompt,status,result,recovery_state AS recoveryState,replacement_run_id AS replacementRunId FROM agent_runs WHERE id=? AND bot_id=?`,[current.replacementRunId,current.botId]);
        if (replacement.length) return {decision,run:{...replacement[0],files:await this.filesForRun(connection,String(replacement[0].id))} as AgentRun};
        throw new RunRecoveryConflict('The replacement run is unavailable');
      }
      if (current.recoveryState !== 'pending') throw new RunRecoveryConflict('This unknown run already has a different resolution');
      const [inputs]=await connection.execute<RowDataPacket[]>("SELECT f.id FROM agent_run_files rf JOIN bot_files f ON f.id=rf.file_id WHERE rf.run_id=? AND rf.kind='input' ORDER BY f.id",[runId]);
      const fileIds=inputs.map(file=>String(file.id));
      const attachmentHash=createHash('sha256').update(JSON.stringify([...fileIds].sort())).digest('hex');
      const replacement: AgentRun = {id:randomUUID(),botId:current.botId,prompt:current.prompt,status:'queued',result:null,recoveryState:'none',replacementRunId:null,files:await this.filesForRun(connection,runId)};
      const requestId=randomUUID();
      await connection.execute(`INSERT INTO agent_runs (id,bot_id,request_id,prompt,status,recovery_state,attachment_hash) VALUES (?,?,?,?,?,'none',?)`,[replacement.id,replacement.botId,requestId,replacement.prompt,replacement.status,attachmentHash]);
      for(const fileId of fileIds)await connection.execute("INSERT INTO agent_run_files (run_id,file_id,kind) VALUES (?,?,'input')",[replacement.id,fileId]);
      await connection.execute(`UPDATE agent_runs SET recovery_state='retried',replacement_run_id=? WHERE id=? AND status='unknown' AND recovery_state='pending'`,[replacement.id,runId]);
      await connection.execute(`INSERT INTO agent_run_events (run_id,status,detail) VALUES (?,'unknown','Owner explicitly approved a new run after reviewing the uncertain outcome.')`,[runId]);
      await connection.execute(`INSERT INTO agent_run_events (run_id,status,detail) VALUES (?,'queued',?)`,[replacement.id,`Explicit retry of run ${runId}.`]);
      return {decision,run:replacement};
    });
  }
  async events(session: Session, runId: string): Promise<Array<{ sequence: number; status: RunStatus; detail: string | null }> | null> {
    const [owned] = await this.pool.execute<RowDataPacket[]>(`SELECT r.id FROM agent_runs r JOIN bots b ON b.id=r.bot_id WHERE r.id=? AND b.tenant_id=? AND b.owner_id=?`,[runId,session.tenantId,session.userId]);
    if (!owned.length) return null;
    const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT sequence,status,detail FROM agent_run_events WHERE run_id=? ORDER BY sequence',[runId]);
    return rows as Array<{ sequence:number; status:RunStatus; detail:string|null }>;
  }
  async fileForDownload(session: Session,fileId:string):Promise<import('./file-store.ts').StoredWorkspaceFile|null>{
    const files=new WorkspaceFileStore(this.pool);
    return files.fileForDownload(session,fileId);
  }
  private async inputFiles(connection:PoolConnection,session:Session,botId:string,fileIds:string[]):Promise<RunFile[]>{
    if(!fileIds.length)return [];
    const [rows]=await connection.execute<RowDataPacket[]>(`SELECT f.id,f.display_name AS name,f.mime_type AS mimeType,f.size,f.sha256,f.storage_key AS storageKey
      FROM bot_files f JOIN bots b ON b.id=f.bot_id WHERE f.bot_id=? AND b.tenant_id=? AND b.owner_id=? AND f.id IN (${fileIds.map(()=>'?').join(',')})`,[botId,session.tenantId,session.userId,...fileIds]);
    const mapped=WorkspaceFileStore.validateInputRows(rows,fileIds);
    const byId=new Map(mapped.map(file=>[file.id,file]));
    return fileIds.map(id=>byId.get(id)!);
  }
  private async filesForRun(database:{execute:PoolConnection['execute']},runId:string):Promise<RunFile[]>{
    const [rows]=await database.execute<RowDataPacket[]>(`SELECT f.id,f.display_name AS name,f.mime_type AS mimeType,f.size,f.sha256,f.storage_key AS storageKey,rf.kind
      FROM agent_run_files rf JOIN bot_files f ON f.id=rf.file_id WHERE rf.run_id=? ORDER BY rf.created_at,f.id`,[runId]);
    return rows.map(row=>({...row,id:String(row.id),name:String(row.name),mimeType:String(row.mimeType),size:Number(row.size),sha256:String(row.sha256),kind:row.kind as RunFile['kind']})) as RunFile[];
  }
  private async filesForRuns(database:{execute:PoolConnection['execute']},runIds:string[]):Promise<Map<string,RunFile[]>>{
    const result=new Map<string,RunFile[]>();
    if(!runIds.length)return result;
    const [rows]=await database.execute<RowDataPacket[]>(`SELECT rf.run_id AS runId,f.id,f.display_name AS name,f.mime_type AS mimeType,f.size,f.sha256,f.storage_key AS storageKey,rf.kind
      FROM agent_run_files rf JOIN bot_files f ON f.id=rf.file_id WHERE rf.run_id IN (${runIds.map(()=>'?').join(',')}) ORDER BY rf.created_at,f.id`,runIds);
    for(const row of rows){const key=String(row.runId);const files=result.get(key)||[];files.push({...row,id:String(row.id),name:String(row.name),mimeType:String(row.mimeType),size:Number(row.size),sha256:String(row.sha256),kind:row.kind as RunFile['kind']} as RunFile);result.set(key,files)}
    return result;
  }
  private async transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
    catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
}
