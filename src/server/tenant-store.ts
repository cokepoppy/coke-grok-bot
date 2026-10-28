import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

// The Google identity / personal workspace model follows Coke Dots origin/main
// 4213e769e49da7a479ab2ad186584c77b721fa69; storage is independently adapted to MySQL.
export interface Identity { subject: string; email: string; name: string }
export interface Session { userId: string; tenantId: string; email: string; name: string; role: string }
export interface OAuthFlow { stateHash: string; nonce: string; codeVerifier: string; expiresAt: Date }

const schema = [
  `CREATE TABLE IF NOT EXISTS users (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, issuer VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, subject VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, email VARCHAR(320) NOT NULL, name VARCHAR(255) NOT NULL, UNIQUE KEY identity_key (issuer, subject)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS tenants (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, name VARCHAR(255) NOT NULL, owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, UNIQUE KEY personal_owner (owner_id), FOREIGN KEY (owner_id) REFERENCES users(id)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS memberships (tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, role ENUM('owner','admin','member') NOT NULL, PRIMARY KEY (tenant_id, user_id), FOREIGN KEY (tenant_id) REFERENCES tenants(id), FOREIGN KEY (user_id) REFERENCES users(id)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, expires_at DATETIME(3) NOT NULL, FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS oauth_flows (state_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, nonce VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, code_verifier VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, expires_at DATETIME(3) NOT NULL) ENGINE=InnoDB`,
];
const hashPattern = /^[a-f0-9]{64}$/;

export class TenantStore {
  constructor(private readonly pool: Pool) {}
  async ready(): Promise<void> { await this.pool.query({ sql: 'SELECT 1', timeout: 2000 }); }
  async migrate(): Promise<void> { for (const sql of schema) await this.pool.execute(sql); }

  async signInGoogle(identity: Identity): Promise<{ userId: string; tenantId: string }> {
    if (!identity.subject || identity.subject.length > 255 || !identity.email || identity.email.length > 320 || !identity.name || identity.name.length > 255) throw new Error('Invalid identity');
    return this.transaction(async connection => {
      const userId = randomUUID();
      await connection.execute(`INSERT INTO users (id, issuer, subject, email, name) VALUES (?, 'https://accounts.google.com', ?, ?, ?) ON DUPLICATE KEY UPDATE email=VALUES(email), name=VALUES(name)`, [userId, identity.subject, identity.email, identity.name]);
      const [users] = await connection.execute<RowDataPacket[]>(`SELECT id FROM users WHERE issuer='https://accounts.google.com' AND subject=? FOR UPDATE`, [identity.subject]);
      const actualId = String(users[0].id);
      await connection.execute(`INSERT INTO tenants (id, name, owner_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE owner_id=owner_id`, [randomUUID(), `${identity.name.slice(0, 240)}'s workspace`, actualId]);
      const [tenants] = await connection.execute<RowDataPacket[]>('SELECT id FROM tenants WHERE owner_id=?', [actualId]);
      const tenantId = String(tenants[0].id);
      await connection.execute(`INSERT INTO memberships (tenant_id, user_id, role) VALUES (?, ?, 'owner') ON DUPLICATE KEY UPDATE role=role`, [tenantId, actualId]);
      return { userId: actualId, tenantId };
    });
  }
  async createSession(tokenHash: string, userId: string, tenantId: string, expiresAt: Date): Promise<void> {
    if (!hashPattern.test(tokenHash) || !Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw new Error('Invalid session');
    await this.pool.execute('INSERT INTO sessions (token_hash, tenant_id, user_id, expires_at) VALUES (?, ?, ?, ?)', [tokenHash, tenantId, userId, expiresAt]);
  }
  async replaceSession(tokenHash: string, userId: string, tenantId: string, expiresAt: Date, oldTokenHash?: string): Promise<void> {
    if (!hashPattern.test(tokenHash) || (oldTokenHash && !hashPattern.test(oldTokenHash)) || !Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw new Error('Invalid session');
    await this.transaction(async connection => {
      if (oldTokenHash) await connection.execute('DELETE FROM sessions WHERE token_hash=?', [oldTokenHash]);
      await connection.execute('INSERT INTO sessions (token_hash, tenant_id, user_id, expires_at) VALUES (?, ?, ?, ?)', [tokenHash, tenantId, userId, expiresAt]);
    });
  }
  async getSession(tokenHash: string): Promise<Session | null> {
    if (!hashPattern.test(tokenHash)) return null;
    const [rows] = await this.pool.execute<RowDataPacket[]>(`SELECT s.user_id AS userId, s.tenant_id AS tenantId, u.email, u.name, m.role FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3)`, [tokenHash]);
    return (rows[0] as Session | undefined) || null;
  }
  async removeSession(tokenHash: string): Promise<void> { if (hashPattern.test(tokenHash)) await this.pool.execute('DELETE FROM sessions WHERE token_hash=?', [tokenHash]); }
  async pruneExpiredAuth(): Promise<void> {
    // Bounded batches avoid a single unbounded delete; live records are never selected.
    await this.pool.execute('DELETE FROM oauth_flows WHERE expires_at <= UTC_TIMESTAMP(3) LIMIT 500');
    await this.pool.execute('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP(3) LIMIT 500');
  }
  async createOAuthFlow(flow: OAuthFlow): Promise<void> {
    if (!hashPattern.test(flow.stateHash) || !flow.nonce || !flow.codeVerifier || !Number.isFinite(flow.expiresAt.getTime()) || flow.expiresAt <= new Date()) throw new Error('Invalid OAuth flow');
    await this.pool.execute('INSERT INTO oauth_flows (state_hash, nonce, code_verifier, expires_at) VALUES (?, ?, ?, ?)', [flow.stateHash, flow.nonce, flow.codeVerifier, flow.expiresAt]);
  }
  async consumeOAuthFlow(stateHash: string): Promise<OAuthFlow | null> {
    if (!hashPattern.test(stateHash)) return null;
    return this.transaction(async connection => {
      const [rows] = await connection.execute<RowDataPacket[]>('SELECT nonce, code_verifier, expires_at FROM oauth_flows WHERE state_hash=? FOR UPDATE', [stateHash]);
      if (!rows.length) return null;
      await connection.execute('DELETE FROM oauth_flows WHERE state_hash=?', [stateHash]);
      const row = rows[0];
      const expiresAt = new Date(row.expires_at);
      return expiresAt > new Date() ? { stateHash, nonce: String(row.nonce), codeVerifier: String(row.code_verifier), expiresAt } : null;
    });
  }
  private async transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try { await connection.beginTransaction(); const value = await work(connection); await connection.commit(); return value; }
    catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
}
