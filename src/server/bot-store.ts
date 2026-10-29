import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Session } from './tenant-store.ts';

export type BotShape = 'cloud' | 'drop' | 'hex' | 'round' | 'triangle';
export interface StoredBot { id: string; name: string; label: string; color: string; shape: BotShape; group: string }
const shapes = new Set<BotShape>(['cloud', 'drop', 'hex', 'round', 'triangle']);

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
  }
  async list(session: Session): Promise<StoredBot[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id, name, label, color, shape, bot_group AS `group` FROM bots WHERE tenant_id=? AND owner_id=? ORDER BY created_at DESC, id DESC',
      [session.tenantId, session.userId]);
    return rows as StoredBot[];
  }
  async create(session: Session, input: { name: string; color: string; shape: BotShape }): Promise<StoredBot> {
    const name = input.name.trim();
    if (!name || name.length > 60 || !/^#[0-9a-fA-F]{6}$/.test(input.color) || !shapes.has(input.shape)) throw new Error('Invalid bot');
    const bot: StoredBot = { id: randomUUID(), name, label: '', color: input.color.toLowerCase(), shape: input.shape, group: 'Unassigned' };
    await this.pool.execute('INSERT INTO bots (id, tenant_id, owner_id, name, color, shape) VALUES (?, ?, ?, ?, ?, ?)', [bot.id, session.tenantId, session.userId, bot.name, bot.color, bot.shape]);
    return bot;
  }
  async rename(session: Session, id: string, name: string): Promise<boolean> {
    const clean = name.trim();
    if (!clean || clean.length > 60) throw new Error('Invalid bot name');
    const [result] = await this.pool.execute<import('mysql2').ResultSetHeader>('UPDATE bots SET name=? WHERE id=? AND tenant_id=? AND owner_id=?', [clean, id, session.tenantId, session.userId]);
    return result.affectedRows > 0;
  }
}
