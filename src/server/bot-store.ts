import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Session } from './tenant-store.ts';

export type BotShape = 'cloud' | 'drop' | 'hex' | 'round' | 'triangle' | 'oval' | 'square' | 'pill' | 'spark' | 'heart' | 'flower' | 'pentagon' | 'star';
export interface StoredBot { id: string; name: string; label: string; color: string; shape: BotShape; group: string; pinned: boolean; hidden: boolean }
export interface StoredMessage { id: string; role: 'user'; text: string }
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
      message_text TEXT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY bot_history (bot_id, sequence),
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
    const [rows] = await this.pool.execute<RowDataPacket[]>("SELECT id, 'user' AS role, message_text AS text FROM bot_messages WHERE bot_id=? ORDER BY sequence", [botId]);
    return rows as StoredMessage[];
  }
  async addMessage(session: Session, botId: string, text: string): Promise<StoredMessage | null> {
    const clean = text.trim();
    if (!clean || clean.length > 10000) throw new Error('Invalid message');
    const message: StoredMessage = { id: randomUUID(), role: 'user', text: clean };
    const [result] = await this.pool.execute<import('mysql2').ResultSetHeader>(
      'INSERT INTO bot_messages (id, bot_id, message_text) SELECT ?, id, ? FROM bots WHERE id=? AND tenant_id=? AND owner_id=?',
      [message.id, clean, botId, session.tenantId, session.userId]);
    return result.affectedRows ? message : null;
  }
  async list(session: Session): Promise<StoredBot[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT b.id, b.name, b.label, b.color, b.shape, b.bot_group AS `group`, COALESCE(s.pinned, 0) AS pinned, COALESCE(s.hidden, 0) AS hidden FROM bots b LEFT JOIN bot_sidebar_state s ON s.bot_id=b.id WHERE b.tenant_id=? AND b.owner_id=? ORDER BY b.created_at DESC, b.id DESC',
      [session.tenantId, session.userId]);
    return rows.map(row => ({ ...row, pinned: Boolean(row.pinned), hidden: Boolean(row.hidden) })) as StoredBot[];
  }
  async create(session: Session, input: { name: string; color: string; shape: BotShape }): Promise<StoredBot> {
    const name = input.name.trim();
    if (!name || name.length > 60 || !/^#[0-9a-fA-F]{6}$/.test(input.color) || !shapes.has(input.shape)) throw new Error('Invalid bot');
    const bot: StoredBot = { id: randomUUID(), name, label: '', color: input.color.toLowerCase(), shape: input.shape, group: 'Unassigned', pinned: false, hidden: false };
    await this.pool.execute('INSERT INTO bots (id, tenant_id, owner_id, name, color, shape) VALUES (?, ?, ?, ?, ?, ?)', [bot.id, session.tenantId, session.userId, bot.name, bot.color, bot.shape]);
    return bot;
  }
  async rename(session: Session, id: string, name: string): Promise<boolean> {
    const clean = name.trim();
    if (!clean || clean.length > 60) throw new Error('Invalid bot name');
    const [result] = await this.pool.execute<import('mysql2').ResultSetHeader>('UPDATE bots SET name=? WHERE id=? AND tenant_id=? AND owner_id=?', [clean, id, session.tenantId, session.userId]);
    return result.affectedRows > 0;
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
