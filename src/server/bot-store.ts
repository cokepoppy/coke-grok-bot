import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Session } from './tenant-store.ts';

export type BotShape = 'cloud' | 'drop' | 'hex' | 'round' | 'triangle' | 'oval' | 'square' | 'pill' | 'spark' | 'heart' | 'flower' | 'pentagon' | 'star';
export interface StoredBot { id: string; name: string; label: string; color: string; shape: BotShape; group: string; pinned: boolean; hidden: boolean; preview: string; lastActivityAt: string | null }
export type VoiceCallLine = { role: 'user' | 'bot'; text: string };
export type VoiceCallData = { durationSeconds: number; transcript: VoiceCallLine[]; feedback: 'good' | 'bad' | null };
export interface StoredMessage { id: string; role: 'user' | 'bot' | 'system' | 'voice'; text: string; createdAt: string; voiceCall?: VoiceCallData }
export interface RenameResult { ok: boolean; event?: StoredMessage }
const shapes = new Set<BotShape>(['cloud', 'drop', 'hex', 'round', 'triangle', 'oval', 'square', 'pill', 'spark', 'heart', 'flower', 'pentagon', 'star']);

export class BotStore {
  constructor(private readonly pool: Pool) {}
  async migrate(): Promise<void> {
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS bots (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      name VARCHAR(60) NOT NULL, label VARCHAR(60) NOT NULL DEFAULT '',
      color CHAR(7) CHARACTER SET ascii NOT NULL, shape VARCHAR(16) CHARACTER SET ascii NOT NULL,
      bot_group VARCHAR(60) NOT NULL DEFAULT 'Unassigned', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY owner_bots (tenant_id, owner_id, created_at, id),
      FOREIGN KEY (tenant_id, owner_id) REFERENCES memberships(tenant_id, user_id)
    ) ENGINE=InnoDB`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS bot_messages (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      bot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
      message_role ENUM('user','system') NOT NULL DEFAULT 'user',
      message_text TEXT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY bot_history (bot_id, sequence),
      FOREIGN KEY (bot_id) REFERENCES bots(id)
    ) ENGINE=InnoDB`);
    const [messageColumns] = await this.pool.execute<RowDataPacket[]>(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bot_messages'`);
    if (!new Set(messageColumns.map(column => String(column.COLUMN_NAME))).has('message_role')) {
      await this.pool.execute("ALTER TABLE bot_messages ADD COLUMN message_role ENUM('user','system') NOT NULL DEFAULT 'user' AFTER sequence");
    }
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS bot_voice_calls (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      bot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      duration_seconds INT UNSIGNED NOT NULL,
      transcript_json JSON NOT NULL,
      feedback ENUM('good','bad') NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY bot_voice_history (bot_id, created_at, id),
      FOREIGN KEY (bot_id) REFERENCES bots(id)
    ) ENGINE=InnoDB`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS bot_sidebar_state (
      bot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      pinned BOOLEAN NOT NULL DEFAULT FALSE, hidden BOOLEAN NOT NULL DEFAULT FALSE,
      FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  }
  async messages(session: Session, botId: string): Promise<StoredMessage[] | null> {
    const [owners] = await this.pool.execute<RowDataPacket[]>('SELECT id FROM bots WHERE id=? AND tenant_id=? AND owner_id=?', [botId, session.tenantId, session.userId]);
    if (!owners.length) return null;
    const [rows] = await this.pool.execute<RowDataPacket[]>("SELECT id,message_role AS role,message_text AS text,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt FROM bot_messages WHERE bot_id=? ORDER BY sequence", [botId]);
    const [calls] = await this.pool.execute<RowDataPacket[]>("SELECT id,duration_seconds AS durationSeconds,transcript_json AS transcript,feedback,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt FROM bot_voice_calls WHERE bot_id=? ORDER BY created_at,id", [botId]);
    const voiceMessages:StoredMessage[]=calls.map(row=>{
      let transcript:unknown=row.transcript;
      if(typeof transcript==='string'){try{transcript=JSON.parse(transcript)}catch{transcript=[]}}
      const rawTranscript:unknown[]=Array.isArray(transcript)?transcript as unknown[]:[];
      const cleanTranscript=rawTranscript.filter((line:unknown):line is VoiceCallLine=>Boolean(line&&typeof line==='object'&&((line as VoiceCallLine).role==='user'||(line as VoiceCallLine).role==='bot')&&typeof (line as VoiceCallLine).text==='string')).slice(0,50).map((line:VoiceCallLine)=>({role:line.role,text:line.text.slice(0,10_000)}));
      const durationSeconds=Number(row.durationSeconds);
      const feedback=row.feedback==='good'||row.feedback==='bad'?row.feedback:null;
      return{id:String(row.id),role:'voice',text:'',createdAt:String(row.createdAt),voiceCall:{durationSeconds:Number.isSafeInteger(durationSeconds)&&durationSeconds>=0&&durationSeconds<=36_000?durationSeconds:0,transcript:cleanTranscript,feedback}};
    });
    return [...rows as StoredMessage[],...voiceMessages].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.id.localeCompare(b.id));
  }
  async addMessage(session: Session, botId: string, text: string): Promise<StoredMessage | null> {
    const clean = text.trim();
    if (!clean || clean.length > 10000) throw new Error('Invalid message');
    const message: StoredMessage = { id: randomUUID(), role: 'user', text: clean, createdAt: new Date().toISOString() };
    const [result] = await this.pool.execute<import('mysql2').ResultSetHeader>(
      "INSERT INTO bot_messages (id,bot_id,message_role,message_text) SELECT ?,id,'user',? FROM bots WHERE id=? AND tenant_id=? AND owner_id=?",
      [message.id, clean, botId, session.tenantId, session.userId]);
    if (!result.affectedRows) return null;
    const [rows] = await this.pool.execute<RowDataPacket[]>("SELECT id,message_role AS role,message_text AS text,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt FROM bot_messages WHERE id=?", [message.id]);
    return rows[0] as StoredMessage;
  }
  async addVoiceCall(session:Session,botId:string,durationSeconds:number,messages:VoiceCallLine[]):Promise<StoredMessage|null>{
    if(!Number.isSafeInteger(durationSeconds)||durationSeconds<0||durationSeconds>36_000||!Array.isArray(messages)||messages.length>50||messages.some(message=>!message||!['user','bot'].includes(message.role)||typeof message.text!=='string'||!message.text.trim()||message.text.length>10_000)||messages.reduce((total,message)=>total+message.text.length,0)>40_000)throw new Error('Invalid voice call');
    const id=randomUUID();
    const [result]=await this.pool.execute<import('mysql2').ResultSetHeader>("INSERT INTO bot_voice_calls (id,bot_id,duration_seconds,transcript_json) SELECT ?,id,?,? FROM bots WHERE id=? AND tenant_id=? AND owner_id=?",[id,durationSeconds,JSON.stringify(messages.map(message=>({role:message.role,text:message.text.trim()}))),botId,session.tenantId,session.userId]);
    if(!result.affectedRows)return null;
    const [rows]=await this.pool.execute<RowDataPacket[]>("SELECT id,duration_seconds AS durationSeconds,transcript_json AS transcript,feedback,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt FROM bot_voice_calls WHERE id=? AND bot_id=?",[id,botId]);
    if(!rows.length)return null;
    const row=rows[0];
    let transcript:unknown=row.transcript;if(typeof transcript==='string'){try{transcript=JSON.parse(transcript)}catch{transcript=[]}}
    return{id:String(row.id),role:'voice',text:'',createdAt:String(row.createdAt),voiceCall:{durationSeconds:Number(row.durationSeconds),transcript:Array.isArray(transcript)?transcript as VoiceCallLine[]:[],feedback:null}};
  }
  async setVoiceCallFeedback(session:Session,botId:string,callId:string,feedback:'good'|'bad'):Promise<boolean>{
    if(feedback!=='good'&&feedback!=='bad')throw new Error('Invalid voice feedback');
    const [result]=await this.pool.execute<import('mysql2').ResultSetHeader>("UPDATE bot_voice_calls call_record JOIN bots b ON b.id=call_record.bot_id SET call_record.feedback=? WHERE call_record.id=? AND call_record.bot_id=? AND b.tenant_id=? AND b.owner_id=?",[feedback,callId,botId,session.tenantId,session.userId]);
    if(result.affectedRows)return true;
    const [rows]=await this.pool.execute<RowDataPacket[]>("SELECT call_record.id FROM bot_voice_calls call_record JOIN bots b ON b.id=call_record.bot_id WHERE call_record.id=? AND call_record.bot_id=? AND b.tenant_id=? AND b.owner_id=?",[callId,botId,session.tenantId,session.userId]);
    return rows.length>0;
  }
  async list(session: Session, includeRuns = false): Promise<StoredBot[]> {
    const summaries = includeRuns
      ? `LEFT JOIN (SELECT m.bot_id,m.message_text,m.created_at FROM bot_messages m JOIN (SELECT bot_id,MAX(sequence) AS sequence FROM bot_messages GROUP BY bot_id) latest_message ON latest_message.bot_id=m.bot_id AND latest_message.sequence=m.sequence) m ON m.bot_id=b.id
         LEFT JOIN (SELECT r.bot_id,r.prompt,r.result,r.status,r.updated_at FROM agent_runs r JOIN (SELECT bot_id,MAX(sequence) AS sequence FROM agent_runs GROUP BY bot_id) latest_run ON latest_run.bot_id=r.bot_id AND latest_run.sequence=r.sequence) r ON r.bot_id=b.id`
      : `LEFT JOIN (SELECT m.bot_id,m.message_text,m.created_at FROM bot_messages m JOIN (SELECT bot_id,MAX(sequence) AS sequence FROM bot_messages GROUP BY bot_id) latest_message ON latest_message.bot_id=m.bot_id AND latest_message.sequence=m.sequence) m ON m.bot_id=b.id`;
    const preview = includeRuns
      ? `CASE WHEN r.updated_at IS NOT NULL AND (m.created_at IS NULL OR r.updated_at>=m.created_at) THEN
           CASE WHEN r.status='completed' THEN COALESCE(NULLIF(LEFT(TRIM(r.result),180),''),'Done.')
                WHEN r.status='running' THEN 'Working…' WHEN r.status='queued' THEN 'Queued'
                WHEN r.status='unknown' THEN 'Outcome unknown' ELSE COALESCE(NULLIF(LEFT(TRIM(r.result),180),''),'Failed') END
         ELSE COALESCE(NULLIF(LEFT(TRIM(m.message_text),180),''),'Start a conversation') END`
      : `COALESCE(NULLIF(LEFT(TRIM(m.message_text),180),''),'Start a conversation')`;
    const lastActivity = includeRuns
      ? `CASE WHEN r.updated_at IS NOT NULL AND (m.created_at IS NULL OR r.updated_at>=m.created_at) THEN r.updated_at ELSE COALESCE(m.created_at,b.created_at) END`
      : `COALESCE(m.created_at,b.created_at)`;
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT b.id,b.name,b.label,b.color,b.shape,b.bot_group AS \`group\`,COALESCE(s.pinned,0) AS pinned,COALESCE(s.hidden,0) AS hidden,
        ${preview} AS preview,DATE_FORMAT(${lastActivity},'%Y-%m-%dT%H:%i:%s.%fZ') AS lastActivityAt
       FROM bots b LEFT JOIN bot_sidebar_state s ON s.bot_id=b.id ${summaries}
       WHERE b.tenant_id=? AND b.owner_id=? ORDER BY ${lastActivity} DESC,b.created_at DESC,b.id DESC`,
      [session.tenantId, session.userId]);
    return rows.map(row => ({ ...row, pinned: Boolean(row.pinned), hidden: Boolean(row.hidden), preview:String(row.preview||'Start a conversation'), lastActivityAt:row.lastActivityAt==null?null:String(row.lastActivityAt) })) as StoredBot[];
  }
  async create(session: Session, input: { name: string; color: string; shape: BotShape }): Promise<StoredBot> {
    const name = input.name.trim();
    if (!name || name.length > 60 || !/^#[0-9a-fA-F]{6}$/.test(input.color) || !shapes.has(input.shape)) throw new Error('Invalid bot');
    const bot: StoredBot = { id: randomUUID(), name, label: '', color: input.color.toLowerCase(), shape: input.shape, group: 'Unassigned', pinned: false, hidden: false, preview:'Start a conversation', lastActivityAt:null };
    await this.pool.execute('INSERT INTO bots (id, tenant_id, owner_id, name, color, shape) VALUES (?, ?, ?, ?, ?, ?)', [bot.id, session.tenantId, session.userId, bot.name, bot.color, bot.shape]);
    return bot;
  }
  async rename(session: Session, id: string, name: string): Promise<RenameResult> {
    const clean = name.trim();
    if (!clean || clean.length > 60) throw new Error('Invalid bot name');
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [owned] = await connection.execute<RowDataPacket[]>('SELECT name FROM bots WHERE id=? AND tenant_id=? AND owner_id=? FOR UPDATE', [id, session.tenantId, session.userId]);
      if (!owned.length) { await connection.rollback(); return { ok: false }; }
      if (String(owned[0].name) === clean) { await connection.commit(); return { ok: true }; }
      await connection.execute('UPDATE bots SET name=? WHERE id=? AND tenant_id=? AND owner_id=?', [clean, id, session.tenantId, session.userId]);
      const eventId = randomUUID();
      await connection.execute("INSERT INTO bot_messages (id,bot_id,message_role,message_text) VALUES (?,?,'system',?)", [eventId, id, `Renamed to ${clean}`]);
      const [events] = await connection.execute<RowDataPacket[]>("SELECT id,message_role AS role,message_text AS text,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt FROM bot_messages WHERE id=?", [eventId]);
      await connection.commit();
      return { ok: true, event: events[0] as StoredMessage };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }
  async setLabel(session: Session, id: string, label: string): Promise<boolean> {
    const clean = label.trim();
    if (clean.length > 60) throw new Error('Invalid bot label');
    const [result] = await this.pool.execute<import('mysql2').ResultSetHeader>('UPDATE bots SET label=? WHERE id=? AND tenant_id=? AND owner_id=?', [clean, id, session.tenantId, session.userId]);
    return result.affectedRows > 0;
  }
  async setAvatar(session: Session, id: string, shape: BotShape, color: string): Promise<boolean> {
    if (!shapes.has(shape) || !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('Invalid bot avatar');
    const [result] = await this.pool.execute<import('mysql2').ResultSetHeader>('UPDATE bots SET shape=?, color=? WHERE id=? AND tenant_id=? AND owner_id=?', [shape, color.toLowerCase(), id, session.tenantId, session.userId]);
    return result.affectedRows > 0;
  }
  async setSidebarState(session: Session, id: string, field: 'pinned' | 'hidden', value: boolean): Promise<boolean> {
    const column = field === 'pinned' ? 'pinned' : 'hidden';
    const [result] = await this.pool.execute<import('mysql2').ResultSetHeader>(
      `INSERT INTO bot_sidebar_state (bot_id, ${column}) SELECT id, ? FROM bots WHERE id=? AND tenant_id=? AND owner_id=? ON DUPLICATE KEY UPDATE ${column}=?`,
      [value, id, session.tenantId, session.userId, value]);
    if (result.affectedRows) return true;
    const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT id FROM bots WHERE id=? AND tenant_id=? AND owner_id=?', [id, session.tenantId, session.userId]);
    return rows.length > 0;
  }
}
