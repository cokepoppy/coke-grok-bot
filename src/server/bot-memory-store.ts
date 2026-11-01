import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { RunOwner } from './run-store.ts';

export interface BotMemoryScope { owner: RunOwner; botId: string; runId: string; leaseId: string }
export interface BotMemory { id: string; title: string; content: string; createdAt: string; updatedAt: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const secretOrContact = /(?:\b(?:password|passphrase|api[ _-]?key|access token|refresh token|bearer token|private key|credit card|card number|cvv|ssn|social security|passport)\b|密码|口令|密钥|令牌|登录凭据|信用卡|卡号|身份证号|私钥|手机号|电话号码|家庭住址)/i;
const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const chinesePhone = /(?<!\d)1[3-9]\d{9}(?!\d)/;
const longNumber = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/;

/** Persistent memories are private to one Bot and only accessible through a live run lease. */
export class BotMemoryStore {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS bot_memories (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      bot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      title VARCHAR(120) NOT NULL,
      memory_text VARCHAR(2000) NOT NULL,
      content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY bot_memory_recent (bot_id, updated_at, id),
      KEY bot_memory_dedupe (bot_id, content_hash),
      FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE,
      FOREIGN KEY (source_run_id) REFERENCES agent_runs(id)
    ) ENGINE=InnoDB`);
  }

  async list(scope: BotMemoryScope, limit = 100): Promise<BotMemory[] | null> {
    if (!validScope(scope) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return null;
    const [rows] = await this.pool.execute<RowDataPacket[]>(`SELECT m.id,m.title,m.memory_text AS content,
      DATE_FORMAT(m.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,
      DATE_FORMAT(m.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt
      FROM bot_memories m JOIN bots b ON b.id=m.bot_id
      JOIN agent_runs r ON r.id=? AND r.bot_id=m.bot_id
      WHERE m.bot_id=? AND b.tenant_id=? AND b.owner_id=? AND r.lease_id=? AND r.status='running' AND r.lease_until>UTC_TIMESTAMP(3)
      ORDER BY m.updated_at DESC,m.id DESC LIMIT ?`, [scope.runId,scope.botId,scope.owner.tenantId,scope.owner.userId,scope.leaseId,limit]);
    // A valid empty list is distinct from a stale lease or an ownership mismatch.
    if (!rows.length) {
      const [live] = await this.pool.execute<RowDataPacket[]>(`SELECT r.id FROM agent_runs r JOIN bots b ON b.id=r.bot_id
        WHERE r.id=? AND r.bot_id=? AND r.lease_id=? AND r.status='running' AND r.lease_until>UTC_TIMESTAMP(3) AND b.tenant_id=? AND b.owner_id=?`,
      [scope.runId,scope.botId,scope.leaseId,scope.owner.tenantId,scope.owner.userId]);
      if (!live.length) return null;
    }
    return rows.map(row => ({ id:String(row.id),title:String(row.title),content:String(row.content),createdAt:String(row.createdAt),updatedAt:String(row.updatedAt) }));
  }

  async remember(scope: BotMemoryScope, titleValue: unknown, contentValue: unknown, idValue?: unknown): Promise<BotMemory | null> {
    const title = typeof titleValue === 'string' ? titleValue.trim() : '';
    const content = typeof contentValue === 'string' ? contentValue.trim() : '';
    if (!validScope(scope) || !title || title.length > 120 || !content || content.length > 2000 || containsSensitiveData(`${title}\n${content}`)) throw new Error('This memory cannot be saved. Keep secrets and contact details in a secure vault.');
    const id = idValue === undefined ? undefined : String(idValue);
    if (id !== undefined && !uuid.test(id)) throw new Error('Invalid memory identity');
    const hash = createHash('sha256').update(content).digest('hex');
    return this.transaction(async connection => {
      if (!await this.liveOwnedRun(connection,scope,true)) return null;
      if (id) {
        const [result] = await connection.execute<import('mysql2').ResultSetHeader>(`UPDATE bot_memories SET title=?,memory_text=?,content_hash=?,source_run_id=? WHERE id=? AND bot_id=?`,
          [title,content,hash,scope.runId,id,scope.botId]);
        if (!result.affectedRows) return null;
      } else {
        const [existing] = await connection.execute<RowDataPacket[]>('SELECT id FROM bot_memories WHERE bot_id=? AND content_hash=? ORDER BY updated_at DESC LIMIT 1 FOR UPDATE',[scope.botId,hash]);
        if (existing.length) {
          await connection.execute('UPDATE bot_memories SET title=?,memory_text=?,source_run_id=? WHERE id=? AND bot_id=?',[title,content,scope.runId,existing[0].id,scope.botId]);
        } else {
          const [count] = await connection.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM bot_memories WHERE bot_id=? FOR UPDATE',[scope.botId]);
          if (Number(count[0]?.total||0) >= 200) throw new Error('This Bot has reached its memory limit. Forget an old memory before saving another.');
          await connection.execute('INSERT INTO bot_memories (id,bot_id,source_run_id,title,memory_text,content_hash) VALUES (?,?,?,?,?,?)',[randomUUID(),scope.botId,scope.runId,title,content,hash]);
        }
      }
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT id,title,memory_text AS content,
        DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,DATE_FORMAT(updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt
        FROM bot_memories WHERE bot_id=? AND ${id?'id=?':'content_hash=?'} ORDER BY updated_at DESC LIMIT 1`,[scope.botId,id||hash]);
      return rows.length ? mapMemory(rows[0]) : null;
    });
  }

  async forget(scope: BotMemoryScope, id: string): Promise<boolean | null> {
    if (!validScope(scope) || !uuid.test(id)) return null;
    return this.transaction(async connection => {
      if (!await this.liveOwnedRun(connection,scope,true)) return null;
      const [result] = await connection.execute<import('mysql2').ResultSetHeader>('DELETE FROM bot_memories WHERE id=? AND bot_id=?',[id,scope.botId]);
      return result.affectedRows === 1;
    });
  }

  private async liveOwnedRun(connection: PoolConnection, scope: BotMemoryScope, lock: boolean): Promise<boolean> {
    const [rows] = await connection.execute<RowDataPacket[]>(`SELECT r.id FROM agent_runs r JOIN bots b ON b.id=r.bot_id
      WHERE r.id=? AND r.bot_id=? AND r.lease_id=? AND r.status='running' AND r.lease_until>UTC_TIMESTAMP(3) AND b.tenant_id=? AND b.owner_id=?${lock?' FOR UPDATE':''}`,
      [scope.runId,scope.botId,scope.leaseId,scope.owner.tenantId,scope.owner.userId]);
    return rows.length === 1;
  }

  private async transaction<T>(fn:(connection:PoolConnection)=>Promise<T>):Promise<T>{
    const connection=await this.pool.getConnection();try{await connection.beginTransaction();const value=await fn(connection);await connection.commit();return value}catch(error){await connection.rollback();throw error}finally{connection.release()}
  }
}

export function containsSensitiveData(value: string): boolean {
  return secretOrContact.test(value) || email.test(value) || chinesePhone.test(value) || longNumber.test(value);
}

function validScope(scope: BotMemoryScope): boolean {
  return Boolean(scope && uuid.test(scope.botId) && uuid.test(scope.runId) && uuid.test(scope.leaseId) && uuid.test(scope.owner?.tenantId) && uuid.test(scope.owner?.userId));
}

function mapMemory(row:RowDataPacket):BotMemory {
  return {id:String(row.id),title:String(row.title),content:String(row.content),createdAt:String(row.createdAt),updatedAt:String(row.updatedAt)};
}
