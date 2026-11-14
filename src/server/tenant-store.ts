import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

// The Google identity / personal workspace model follows Coke Dots origin/main
// 4213e769e49da7a479ab2ad186584c77b721fa69; storage is independently adapted to MySQL.
export interface Identity { subject: string; email: string; name: string }
export interface Session { userId: string; tenantId: string; email: string; name: string; role: string }
export interface OAuthFlow { stateHash: string; nonce: string; codeVerifier: string; expiresAt: Date }
export interface WorkspaceMembership { tenantId: string; name: string; tenantType: 'personal' | 'team'; role: string; memberCount: number }
export interface TenantInvitation { id: string; email: string; createdAt: string; expiresAt: string; status: 'pending' | 'expired' | 'accepted' | 'revoked' }
export class TenantWorkspaceError extends Error {
  constructor(readonly code: 'invalid-name' | 'not-authorized' | 'session-expired' | 'personal-workspace-required') { super(code); }
}
export class TenantInvitationError extends Error {
  constructor(readonly code: 'invalid-email' | 'not-authorized' | 'already-member' | 'already-invited' | 'too-many-pending' | 'invalid' | 'expired' | 'revoked' | 'email-mismatch' | 'session-expired' | 'workspace-unavailable' | 'team-workspace-required') { super(code); }
}

const schema = [
  `CREATE TABLE IF NOT EXISTS users (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, issuer VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, subject VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, email VARCHAR(320) NOT NULL, name VARCHAR(255) NOT NULL, UNIQUE KEY identity_key (issuer, subject)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS tenants (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, name VARCHAR(255) NOT NULL, owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, tenant_type ENUM('personal','team') NOT NULL DEFAULT 'personal', personal_owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN tenant_type='personal' THEN owner_id ELSE NULL END) STORED, UNIQUE KEY personal_owner (personal_owner_id), KEY tenant_owner (owner_id), FOREIGN KEY (owner_id) REFERENCES users(id)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS memberships (tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, role ENUM('owner','admin','member') NOT NULL, PRIMARY KEY (tenant_id, user_id), FOREIGN KEY (tenant_id) REFERENCES tenants(id), FOREIGN KEY (user_id) REFERENCES users(id)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS tenant_invitations (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    invited_email VARCHAR(320) NOT NULL,
    role ENUM('member') NOT NULL DEFAULT 'member',
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    accepted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at DATETIME(3) NOT NULL,
    accepted_at DATETIME(3) NULL,
    revoked_at DATETIME(3) NULL,
    KEY tenant_invitation_status (tenant_id,accepted_at,revoked_at,expires_at),
    FOREIGN KEY (tenant_id,created_by) REFERENCES memberships(tenant_id,user_id),
    FOREIGN KEY (accepted_by) REFERENCES users(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, expires_at DATETIME(3) NOT NULL, FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS oauth_flows (state_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, nonce VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, code_verifier VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, expires_at DATETIME(3) NOT NULL) ENGINE=InnoDB`,
];
const hashPattern = /^[a-f0-9]{64}$/;
const invitationTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const normalizeEmail = (email: string) => email.trim().toLowerCase();

export class TenantStore {
  constructor(private readonly pool: Pool) {}
  async ready(): Promise<void> { await this.pool.query({ sql: 'SELECT 1', timeout: 2000 }); }
  async migrate(): Promise<void> {
    for (const sql of schema) await this.pool.execute(sql);
    await this.migrateTenantTypes();
  }

  private async migrateTenantTypes(): Promise<void> {
    const [columns] = await this.pool.execute<RowDataPacket[]>(`SELECT column_name AS name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='tenants'`);
    const columnNames = new Set(columns.map(row => String(row.name)));
    if (!columnNames.has('tenant_type')) {
      await this.pool.execute(`ALTER TABLE tenants ADD COLUMN tenant_type ENUM('personal','team') NOT NULL DEFAULT 'personal' AFTER owner_id`);
      // Legacy shared workspaces and workspaces with invitations already represent teams.
      await this.pool.execute(`UPDATE tenants t
        LEFT JOIN (SELECT tenant_id FROM memberships GROUP BY tenant_id HAVING COUNT(*)>1) m ON m.tenant_id=t.id
        LEFT JOIN (SELECT DISTINCT tenant_id FROM tenant_invitations) i ON i.tenant_id=t.id
        SET t.tenant_type='team' WHERE t.tenant_type='personal' AND (m.tenant_id IS NOT NULL OR i.tenant_id IS NOT NULL)`);
    }
    if (!columnNames.has('personal_owner_id')) {
      await this.pool.execute(`ALTER TABLE tenants ADD COLUMN personal_owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN tenant_type='personal' THEN owner_id ELSE NULL END) STORED`);
    }
    const [ownerIndexes] = await this.pool.execute<RowDataPacket[]>(`SELECT index_name AS name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='tenants' AND index_name='tenant_owner' LIMIT 1`);
    if (!ownerIndexes.length) await this.pool.execute('ALTER TABLE tenants ADD KEY tenant_owner (owner_id)');
    const [indexes] = await this.pool.execute<RowDataPacket[]>(`SELECT column_name AS name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='tenants' AND index_name='personal_owner' ORDER BY seq_in_index`);
    if (indexes.length && indexes.length === 1 && String(indexes[0].name) !== 'personal_owner_id') {
      await this.pool.execute('ALTER TABLE tenants DROP INDEX personal_owner');
    }
    if (!indexes.some(row => String(row.name) === 'personal_owner_id')) {
      await this.pool.execute('ALTER TABLE tenants ADD UNIQUE KEY personal_owner (personal_owner_id)');
    }
  }

  async signInGoogle(identity: Identity): Promise<{ userId: string; tenantId: string }> {
    if (!identity.subject || identity.subject.length > 255 || !identity.email || identity.email.length > 320 || !identity.name || identity.name.length > 255) throw new Error('Invalid identity');
    return this.transaction(async connection => {
      const userId = randomUUID();
      await connection.execute(`INSERT INTO users (id, issuer, subject, email, name) VALUES (?, 'https://accounts.google.com', ?, ?, ?) ON DUPLICATE KEY UPDATE email=VALUES(email), name=VALUES(name)`, [userId, identity.subject, identity.email, identity.name]);
      const [users] = await connection.execute<RowDataPacket[]>(`SELECT id FROM users WHERE issuer='https://accounts.google.com' AND subject=? FOR UPDATE`, [identity.subject]);
      const actualId = String(users[0].id);
      await connection.execute(`INSERT INTO tenants (id, name, owner_id, tenant_type) VALUES (?, ?, ?, 'personal') ON DUPLICATE KEY UPDATE id=id`, [randomUUID(), `${identity.name.slice(0, 240)}'s workspace`, actualId]);
      const [personalTenants] = await connection.execute<RowDataPacket[]>('SELECT id FROM tenants WHERE owner_id=? AND tenant_type=\'personal\'', [actualId]);
      const tenantId = String(personalTenants[0].id);
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
  async workspaces(session: Pick<Session,'userId'>): Promise<WorkspaceMembership[]> {
    if (!/^[0-9a-f-]{36}$/i.test(session.userId)) return [];
    const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT t.id AS tenantId,t.name,t.tenant_type AS tenantType,m.role,(SELECT COUNT(*) FROM memberships all_members WHERE all_members.tenant_id=t.id) AS memberCount
      FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? ORDER BY (m.role='owner') DESC,t.name,t.id`,[session.userId]);
    return rows.map(row=>({tenantId:String(row.tenantId),name:String(row.name),tenantType:String(row.tenantType) as WorkspaceMembership['tenantType'],role:String(row.role),memberCount:Number(row.memberCount)}));
  }
  async createTeamWorkspace(sessionHash:string,session:Session,name:string):Promise<string>{
    const normalizedName=name.trim();
    if(!normalizedName||Array.from(normalizedName).length>120||/[\u0000-\u001f\u007f]/.test(normalizedName))throw new TenantWorkspaceError('invalid-name');
    if(!hashPattern.test(sessionHash))throw new TenantWorkspaceError('session-expired');
    return this.transaction(async connection=>{
      const [active]=await connection.execute<RowDataPacket[]>('SELECT tenant_id FROM sessions WHERE token_hash=? AND user_id=? AND tenant_id=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE',[sessionHash,session.userId,session.tenantId]);
      if(!active.length)throw new TenantWorkspaceError('session-expired');
      const [actors]=await connection.execute<RowDataPacket[]>(`SELECT t.tenant_type AS tenantType,m.role FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE t.id=? AND m.user_id=? FOR UPDATE`,[session.tenantId,session.userId]);
      if(String(actors[0]?.tenantType||'')!=='personal')throw new TenantWorkspaceError('personal-workspace-required');
      if(String(actors[0]?.role||'')!=='owner')throw new TenantWorkspaceError('not-authorized');
      const tenantId=randomUUID();
      await connection.execute(`INSERT INTO tenants (id,name,owner_id,tenant_type) VALUES (?,?,?,'team')`,[tenantId,normalizedName,session.userId]);
      await connection.execute(`INSERT INTO memberships (tenant_id,user_id,role) VALUES (?,?,'owner')`,[tenantId,session.userId]);
      const [switched]=await connection.execute<import('mysql2').ResultSetHeader>('UPDATE sessions SET tenant_id=? WHERE token_hash=? AND user_id=? AND expires_at>UTC_TIMESTAMP(3)',[tenantId,sessionHash,session.userId]);
      if(switched.affectedRows!==1)throw new TenantWorkspaceError('session-expired');
      return tenantId;
    });
  }
  async createInvitation(session: Session,email: string): Promise<{id:string;token:string;email:string;expiresAt:Date}> {
    const invitedEmail=normalizeEmail(email);
    if(invitedEmail.length>320||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitedEmail)) throw new TenantInvitationError('invalid-email');
    const token=randomBytes(32).toString('base64url'),tokenHash=createHash('sha256').update(token).digest('hex'),id=randomUUID(),expiresAt=new Date(Date.now()+7*86400000);
    await this.transaction(async connection=>{
      const [tenantRows]=await connection.execute<RowDataPacket[]>(`SELECT id,tenant_type AS tenantType FROM tenants WHERE id=? FOR UPDATE`,[session.tenantId]);
      if(!tenantRows.length)throw new TenantInvitationError('workspace-unavailable');
      if(String(tenantRows[0].tenantType)!=='team')throw new TenantInvitationError('team-workspace-required');
      const [actors]=await connection.execute<RowDataPacket[]>('SELECT role FROM memberships WHERE tenant_id=? AND user_id=? FOR UPDATE',[session.tenantId,session.userId]);
      if(!['owner','admin'].includes(String(actors[0]?.role||''))) throw new TenantInvitationError('not-authorized');
      const [members]=await connection.execute<RowDataPacket[]>('SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND LOWER(u.email)=? LIMIT 1',[session.tenantId,invitedEmail]);
      if(members.length) throw new TenantInvitationError('already-member');
      const [pending]=await connection.execute<RowDataPacket[]>(`SELECT id FROM tenant_invitations WHERE tenant_id=? AND invited_email=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(3) LIMIT 1 FOR UPDATE`,[session.tenantId,invitedEmail]);
      if(pending.length) throw new TenantInvitationError('already-invited');
      const [pendingInvitations]=await connection.execute<RowDataPacket[]>(`SELECT id FROM tenant_invitations WHERE tenant_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE`,[session.tenantId]);
      if(pendingInvitations.length>=20) throw new TenantInvitationError('too-many-pending');
      await connection.execute('INSERT INTO tenant_invitations (id,tenant_id,invited_email,token_hash,created_by,expires_at) VALUES (?,?,?,?,?,?)',[id,session.tenantId,invitedEmail,tokenHash,session.userId,expiresAt]);
    });
    return {id,token,email:invitedEmail,expiresAt};
  }
  async listInvitations(session: Session): Promise<TenantInvitation[] | null> {
    const [actors]=await this.pool.execute<RowDataPacket[]>(`SELECT m.role,t.tenant_type AS tenantType FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=?`,[session.tenantId,session.userId]);
    if(String(actors[0]?.tenantType||'')!=='team')return null;
    if(!['owner','admin'].includes(String(actors[0]?.role||''))) return null;
    const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT id,invited_email AS email,
      DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,DATE_FORMAT(expires_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS expiresAt,
      CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN accepted_at IS NOT NULL THEN 'accepted' WHEN expires_at<=UTC_TIMESTAMP(3) THEN 'expired' ELSE 'pending' END AS status
      FROM tenant_invitations WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT 100`,[session.tenantId]);
    return rows.map(row=>({id:String(row.id),email:String(row.email),createdAt:String(row.createdAt),expiresAt:String(row.expiresAt),status:String(row.status) as TenantInvitation['status']}));
  }
  async revokeInvitation(session:Session,id:string):Promise<boolean>{
    if(!/^[0-9a-f-]{36}$/i.test(id))return false;
    return this.transaction(async connection=>{
      const [actors]=await connection.execute<RowDataPacket[]>(`SELECT m.role,t.tenant_type AS tenantType FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? FOR UPDATE`,[session.tenantId,session.userId]);
      if(String(actors[0]?.tenantType||'')!=='team')return false;
      if(!['owner','admin'].includes(String(actors[0]?.role||'')))return false;
      const [result]=await connection.execute<import('mysql2').ResultSetHeader>(`UPDATE tenant_invitations SET revoked_at=UTC_TIMESTAMP(3) WHERE id=? AND tenant_id=? AND accepted_at IS NULL AND revoked_at IS NULL`,[id,session.tenantId]);
      return result.affectedRows===1;
    });
  }
  async acceptInvitation(sessionHash:string,session:Session,token:string):Promise<{tenantId:string;alreadyMember:boolean}>{
    if(!hashPattern.test(sessionHash)||!invitationTokenPattern.test(token))throw new TenantInvitationError('invalid');
    const tokenHash=createHash('sha256').update(token).digest('hex');
    return this.transaction(async connection=>{
      const [active]=await connection.execute<RowDataPacket[]>('SELECT token_hash FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE',[sessionHash,session.userId]);
      if(!active.length)throw new TenantInvitationError('session-expired');
      const [rows]=await connection.execute<RowDataPacket[]>(`SELECT i.id,i.tenant_id AS tenantId,i.invited_email AS email,i.expires_at AS expiresAt,i.accepted_at AS acceptedAt,i.revoked_at AS revokedAt,i.accepted_by AS acceptedBy,t.tenant_type AS tenantType FROM tenant_invitations i JOIN tenants t ON t.id=i.tenant_id WHERE i.token_hash=? FOR UPDATE`,[tokenHash]);
      const invitation=rows[0];if(!invitation)throw new TenantInvitationError('invalid');
      if(String(invitation.tenantType)!=='team')throw new TenantInvitationError('team-workspace-required');
      if(normalizeEmail(String(invitation.email))!==normalizeEmail(session.email))throw new TenantInvitationError('email-mismatch');
      if(invitation.revokedAt)throw new TenantInvitationError('revoked');
      if(new Date(invitation.expiresAt)<=new Date())throw new TenantInvitationError('expired');
      if(invitation.acceptedAt)throw new TenantInvitationError('invalid');
      const tenantId=String(invitation.tenantId);
      const [members]=await connection.execute<RowDataPacket[]>('SELECT user_id FROM memberships WHERE tenant_id=? AND user_id=? FOR UPDATE',[tenantId,session.userId]);
      const alreadyMember=members.length>0;
      if(!alreadyMember)await connection.execute(`INSERT INTO memberships (tenant_id,user_id,role) VALUES (?,?,'member')`,[tenantId,session.userId]);
      await connection.execute('UPDATE tenant_invitations SET accepted_by=?,accepted_at=UTC_TIMESTAMP(3) WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL',[session.userId,invitation.id]);
      if(session.tenantId!==tenantId){
        const [switched]=await connection.execute<import('mysql2').ResultSetHeader>('UPDATE sessions SET tenant_id=? WHERE token_hash=? AND user_id=? AND expires_at>UTC_TIMESTAMP(3)',[tenantId,sessionHash,session.userId]);
        if(switched.affectedRows!==1)throw new TenantInvitationError('session-expired');
      }
      return {tenantId,alreadyMember};
    });
  }
  async switchWorkspace(sessionHash:string,session:Pick<Session,'userId'>,tenantId:string):Promise<boolean>{
    if(!hashPattern.test(sessionHash)||!/^[0-9a-f-]{36}$/i.test(session.userId)||!/^[0-9a-f-]{36}$/i.test(tenantId))return false;
    const [result]=await this.pool.execute<import('mysql2').ResultSetHeader>(`UPDATE sessions s SET s.tenant_id=? WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>UTC_TIMESTAMP(3)
      AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=? AND m.user_id=s.user_id)`,[tenantId,sessionHash,session.userId,tenantId]);
    return result.affectedRows===1;
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
