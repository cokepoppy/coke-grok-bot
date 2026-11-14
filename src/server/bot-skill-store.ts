import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { containsSensitiveData } from './bot-memory-store.ts';
import type { RunOwner } from './run-store.ts';
import type { Session } from './tenant-store.ts';

export type BotSkillVisibility = 'private' | 'bot';
export interface BotSkillScope { owner: RunOwner; botId: string; runId: string; leaseId: string }
export interface BotSkillInput { name: string; description: string; instructions: string; visibility: BotSkillVisibility }
export interface BotSkill extends BotSkillInput { id: string; creatorBotId: string | null; enabled: boolean; published: boolean; publishedTenantIds: string[]; outOfSyncTenantIds: string[]; isOwner: boolean; sharedBy: string | null; outOfSync: boolean; createdAt: string; updatedAt: string }
export interface BotSkillPublishTarget { tenantId: string; name: string; memberCount: number }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Owner library with per-Bot enablement; all Agent operations require a live run lease. */
export class BotSkillStore {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS bot_skills (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      creator_bot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      source_run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      name VARCHAR(120) NOT NULL,
      description VARCHAR(1000) NOT NULL,
      instructions TEXT NOT NULL,
      visibility ENUM('private','bot') NOT NULL DEFAULT 'private',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY bot_skill_request (tenant_id, owner_id, request_id),
      UNIQUE KEY bot_skill_name (tenant_id, owner_id, name),
      KEY bot_skill_owner (tenant_id, owner_id, updated_at, id),
      KEY bot_skill_bot (creator_bot_id, updated_at, id),
      FOREIGN KEY (creator_bot_id) REFERENCES bots(id) ON DELETE SET NULL,
      FOREIGN KEY (source_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
    ) ENGINE=InnoDB`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS bot_skill_access (
      skill_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      bot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (skill_id, bot_id),
      KEY bot_skill_access_bot (bot_id, enabled, skill_id),
      FOREIGN KEY (skill_id) REFERENCES bot_skills(id) ON DELETE CASCADE,
      FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS bot_skill_publications (
      skill_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      name VARCHAR(120) NOT NULL,
      description VARCHAR(1000) NOT NULL,
      instructions TEXT NOT NULL,
      source_updated_at DATETIME(3) NOT NULL,
      published_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (skill_id,tenant_id),
      KEY bot_skill_publication_tenant (tenant_id, updated_at, skill_id),
      FOREIGN KEY (skill_id) REFERENCES bot_skills(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    const [publicationPrimary] = await this.pool.execute<RowDataPacket[]>(`SELECT column_name AS name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='bot_skill_publications' AND index_name='PRIMARY' ORDER BY seq_in_index`);
    if(publicationPrimary.length===1&&String(publicationPrimary[0].name)==='skill_id'){
      await this.pool.execute('ALTER TABLE bot_skill_publications DROP PRIMARY KEY, ADD PRIMARY KEY (skill_id,tenant_id)');
    }
  }

  async teamShareAvailable(session: Session): Promise<boolean> {
    return (await this.teamShareTargets(session)).length>0;
  }

  async teamShareTargets(session:Session):Promise<BotSkillPublishTarget[]>{
    const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT t.id AS tenantId,t.name,(SELECT COUNT(*) FROM memberships all_members WHERE all_members.tenant_id=t.id) AS memberCount
      FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND t.tenant_type='team'
      ORDER BY t.name,t.id`,[session.userId]);
    return rows.map(row=>({tenantId:String(row.tenantId),name:String(row.name),memberCount:Number(row.memberCount)}));
  }

  async listForBot(session: Session, botId: string): Promise<BotSkill[] | null> {
    if (!uuid.test(botId)) return null;
    const [bots] = await this.pool.execute<RowDataPacket[]>('SELECT id FROM bots WHERE id=? AND tenant_id=? AND owner_id=?', [botId, session.tenantId, session.userId]);
    if (!bots.length) return null;
    const [rows] = await this.pool.execute<RowDataPacket[]>(`SELECT s.id,s.creator_bot_id AS creatorBotId,
      CASE WHEN s.owner_id=? THEN s.name ELSE p.name END AS name,
      CASE WHEN s.owner_id=? THEN s.description ELSE p.description END AS description,
      CASE WHEN s.owner_id=? THEN s.instructions ELSE p.instructions END AS instructions,s.visibility,
      COALESCE(a.enabled,FALSE) AS enabled,p.skill_id IS NOT NULL AS published,
      s.owner_id=? AS isOwner,CASE WHEN s.owner_id=? THEN NULL ELSE u.name END AS sharedBy,
      p.skill_id IS NOT NULL AND s.updated_at>p.source_updated_at AS outOfSync,
      DATE_FORMAT(s.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,
      DATE_FORMAT(s.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt
      FROM bot_skills s
      LEFT JOIN bot_skill_publications p ON p.skill_id=s.id AND p.tenant_id=?
      LEFT JOIN bot_skill_access a ON a.skill_id=s.id AND a.bot_id=?
      LEFT JOIN users u ON u.id=s.owner_id
      WHERE (s.owner_id=? AND (s.visibility='private' OR (s.visibility='bot' AND s.creator_bot_id=?))) OR p.skill_id IS NOT NULL
      ORDER BY s.updated_at DESC,s.id DESC LIMIT 100`, [session.userId, session.userId, session.userId, session.userId, session.userId, session.tenantId, botId, session.userId, botId]);
    const skills=rows.map(mapSkill),ownedIds=skills.filter(skill=>skill.isOwner&&skill.visibility==='private').map(skill=>skill.id);
    if(!ownedIds.length)return skills;
    const [publications]=await this.pool.execute<RowDataPacket[]>(`SELECT p.skill_id AS skillId,p.tenant_id AS tenantId,p.source_updated_at AS sourceUpdatedAt,s.updated_at AS currentUpdatedAt
      FROM bot_skill_publications p JOIN bot_skills s ON s.id=p.skill_id AND s.owner_id=p.owner_id
      JOIN memberships m ON m.tenant_id=p.tenant_id AND m.user_id=?
      WHERE p.owner_id=? AND p.skill_id IN (${ownedIds.map(()=>'?').join(',')})`,[session.userId,session.userId,...ownedIds]);
    const bySkill=new Map<string,{publishedTenantIds:string[];outOfSyncTenantIds:string[]}>();
    for(const row of publications){const id=String(row.skillId),state=bySkill.get(id)||{publishedTenantIds:[],outOfSyncTenantIds:[]};state.publishedTenantIds.push(String(row.tenantId));if(new Date(row.currentUpdatedAt)>new Date(row.sourceUpdatedAt))state.outOfSyncTenantIds.push(String(row.tenantId));bySkill.set(id,state)}
    return skills.map(skill=>({...skill,...(bySkill.get(skill.id)||{publishedTenantIds:[],outOfSyncTenantIds:[]})}));
  }

  async listForRun(scope: BotSkillScope): Promise<BotSkill[] | null> {
    if (!validScope(scope)) return null;
    const [rows] = await this.pool.execute<RowDataPacket[]>(`SELECT s.id,s.creator_bot_id AS creatorBotId,
      CASE WHEN s.owner_id=? THEN s.name ELSE p.name END AS name,
      CASE WHEN s.owner_id=? THEN s.description ELSE p.description END AS description,
      CASE WHEN s.owner_id=? THEN s.instructions ELSE p.instructions END AS instructions,s.visibility,
      TRUE AS enabled,p.skill_id IS NOT NULL AS published,s.owner_id=? AS isOwner,NULL AS sharedBy,FALSE AS outOfSync,
      DATE_FORMAT(s.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,
      DATE_FORMAT(s.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt
      FROM bot_skills s JOIN bot_skill_access a ON a.skill_id=s.id AND a.bot_id=? AND a.enabled=TRUE
      JOIN bots b ON b.id=? AND b.tenant_id=? AND b.owner_id=?
      JOIN agent_runs r ON r.id=? AND r.bot_id=b.id AND r.lease_id=? AND r.status='running' AND r.lease_until>UTC_TIMESTAMP(3)
      LEFT JOIN bot_skill_publications p ON p.skill_id=s.id AND p.tenant_id=b.tenant_id
      WHERE (s.owner_id=b.owner_id AND (s.visibility='private' OR (s.visibility='bot' AND s.creator_bot_id=b.id))) OR p.skill_id IS NOT NULL
      ORDER BY s.updated_at DESC,s.id DESC LIMIT 30`, [scope.owner.userId, scope.owner.userId, scope.owner.userId, scope.owner.userId, scope.botId, scope.botId, scope.owner.tenantId, scope.owner.userId, scope.runId, scope.leaseId]);
    if (!rows.length && !await this.liveOwnedRun(this.pool, scope, false)) return null;
    return rows.map(mapSkill);
  }

  async createForRun(scope: BotSkillScope, inputValue: unknown, allowed: boolean): Promise<BotSkill | null> {
    if (!validScope(scope)) return null;
    if (!allowed) throw new Error('The user must directly ask to save or create a Skill.');
    const input = validateSkillInput(inputValue);
    const requestId = deterministicRequestId(scope.runId, input);
    return this.transaction(async connection => {
      if (!await this.liveOwnedRun(connection, scope, true)) return null;
      const [existing] = await connection.execute<RowDataPacket[]>(`SELECT s.id,s.creator_bot_id AS creatorBotId,s.name,s.description,s.instructions,s.visibility,
        COALESCE(a.enabled,FALSE) AS enabled,DATE_FORMAT(s.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,DATE_FORMAT(s.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt
        FROM bot_skills s LEFT JOIN bot_skill_access a ON a.skill_id=s.id AND a.bot_id=?
        WHERE s.tenant_id=? AND s.owner_id=? AND s.request_id=? FOR UPDATE`, [scope.botId, scope.owner.tenantId, scope.owner.userId, requestId]);
      if (existing.length) return mapSkill(existing[0]);
      const [count] = await connection.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM bot_skills WHERE owner_id=? FOR UPDATE', [scope.owner.userId]);
      if (Number(count[0]?.total || 0) >= 100) throw new Error('Skill library limit reached.');
      const id = randomUUID();
      await connection.execute('INSERT INTO bot_skills (id,tenant_id,owner_id,creator_bot_id,source_run_id,request_id,name,description,instructions,visibility) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id, scope.owner.tenantId, scope.owner.userId, scope.botId, scope.runId, requestId, input.name, input.description, input.instructions, input.visibility]);
      await connection.execute('INSERT INTO bot_skill_access (skill_id,bot_id,enabled) VALUES (?,?,TRUE)', [id, scope.botId]);
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT id,creator_bot_id AS creatorBotId,name,description,instructions,visibility,TRUE AS enabled,
        DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,DATE_FORMAT(updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt FROM bot_skills WHERE id=?`, [id]);
      return rows.length ? mapSkill(rows[0]) : null;
    });
  }

  async setEnabledForBot(session: Session, botId: string, skillId: string, enabled: boolean): Promise<boolean | null> {
    if (!uuid.test(botId) || !uuid.test(skillId) || typeof enabled !== 'boolean') return null;
    return this.transaction(async connection => {
      const [bots] = await connection.execute<RowDataPacket[]>('SELECT id FROM bots WHERE id=? AND tenant_id=? AND owner_id=? FOR UPDATE', [botId, session.tenantId, session.userId]);
      if (!bots.length) return null;
      const [skills] = await connection.execute<RowDataPacket[]>(`SELECT s.id,s.owner_id AS ownerId,s.creator_bot_id AS creatorBotId,s.visibility,p.skill_id AS publishedId
        FROM bot_skills s LEFT JOIN bot_skill_publications p ON p.skill_id=s.id AND p.tenant_id=?
        WHERE s.id=? AND (s.owner_id=? OR p.skill_id IS NOT NULL) FOR UPDATE`, [session.tenantId, skillId, session.userId]);
      if (!skills.length || (skills[0].visibility === 'bot' && (String(skills[0].ownerId) !== session.userId || String(skills[0].creatorBotId || '') !== botId))) return null;
      if (enabled) await connection.execute('INSERT INTO bot_skill_access (skill_id,bot_id,enabled) VALUES (?,?,TRUE) ON DUPLICATE KEY UPDATE enabled=TRUE', [skillId, botId]);
      else await connection.execute('UPDATE bot_skill_access SET enabled=FALSE WHERE skill_id=? AND bot_id=?', [skillId, botId]);
      return enabled;
    });
  }

  async updateForRun(scope: BotSkillScope, skillId: string, inputValue: unknown, allowed: boolean): Promise<BotSkill | null> {
    if (!validScope(scope) || !uuid.test(skillId)) return null;
    if (!allowed) throw new Error('The user must directly ask to edit a Skill.');
    const input = validateSkillInput(inputValue);
    return this.transaction(async connection => {
      if (!await this.liveOwnedRun(connection, scope, true)) return null;
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT id,creator_bot_id AS creatorBotId,visibility
        FROM bot_skills WHERE id=? AND owner_id=? FOR UPDATE`, [skillId, scope.owner.userId]);
      if (!rows.length || (rows[0].visibility === 'bot' && String(rows[0].creatorBotId || '') !== scope.botId)) return null;
      await connection.execute('UPDATE bot_skills SET name=?,description=?,instructions=?,visibility=? WHERE id=? AND owner_id=?',
        [input.name,input.description,input.instructions,input.visibility,skillId,scope.owner.userId]);
      if(input.visibility==='bot') await this.removeAllPublications(connection,scope.owner.userId,skillId);
      const [updated] = await connection.execute<RowDataPacket[]>(`SELECT s.id,s.creator_bot_id AS creatorBotId,s.name,s.description,s.instructions,s.visibility,
        COALESCE(a.enabled,FALSE) AS enabled,p.skill_id IS NOT NULL AS published,TRUE AS isOwner,NULL AS sharedBy,
        p.skill_id IS NOT NULL AND s.updated_at>p.source_updated_at AS outOfSync,
        DATE_FORMAT(s.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,DATE_FORMAT(s.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt
        FROM bot_skills s LEFT JOIN bot_skill_access a ON a.skill_id=s.id AND a.bot_id=?
        LEFT JOIN bot_skill_publications p ON p.skill_id=s.id AND p.tenant_id=? WHERE s.id=?`, [scope.botId,scope.owner.tenantId,skillId]);
      return updated.length ? mapSkill(updated[0]) : null;
    });
  }

  async updateForUser(session: Session, skillId: string, inputValue: unknown): Promise<BotSkill | null> {
    if (!uuid.test(skillId)) return null;
    const input = validateSkillInput(inputValue);
    return this.transaction(async connection => {
      const [rows] = await connection.execute<RowDataPacket[]>('SELECT id FROM bot_skills WHERE id=? AND owner_id=? FOR UPDATE', [skillId, session.userId]);
      if (!rows.length) return null;
      await connection.execute('UPDATE bot_skills SET name=?,description=?,instructions=?,visibility=? WHERE id=? AND owner_id=?',
        [input.name, input.description, input.instructions, input.visibility, skillId, session.userId]);
      if(input.visibility==='bot') await this.removeAllPublications(connection,session.userId,skillId);
      const [updated] = await connection.execute<RowDataPacket[]>(`SELECT s.id,s.creator_bot_id AS creatorBotId,s.name,s.description,s.instructions,s.visibility,TRUE AS enabled,
        p.skill_id IS NOT NULL AS published,TRUE AS isOwner,NULL AS sharedBy,p.skill_id IS NOT NULL AND s.updated_at>p.source_updated_at AS outOfSync,
        DATE_FORMAT(s.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,DATE_FORMAT(s.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt
        FROM bot_skills s LEFT JOIN bot_skill_publications p ON p.skill_id=s.id AND p.tenant_id=? WHERE s.id=?`, [session.tenantId,skillId]);
      return updated.length ? mapSkill(updated[0]) : null;
    });
  }

  async removeForRun(scope: BotSkillScope, skillId: string, allowed: boolean): Promise<boolean | null> {
    if (!validScope(scope) || !uuid.test(skillId)) return null;
    if (!allowed) throw new Error('The user must directly ask to delete a Skill.');
    return this.transaction(async connection => {
      if (!await this.liveOwnedRun(connection, scope, true)) return null;
      const [result] = await connection.execute<import('mysql2').ResultSetHeader>('DELETE FROM bot_skills WHERE id=? AND owner_id=?',
        [skillId, scope.owner.userId]);
      return result.affectedRows === 1;
    });
  }

  async removeForUser(session: Session, skillId: string): Promise<boolean> {
    if (!uuid.test(skillId)) return false;
    const [result] = await this.pool.execute<import('mysql2').ResultSetHeader>('DELETE FROM bot_skills WHERE id=? AND owner_id=?', [skillId, session.userId]);
    return result.affectedRows === 1;
  }

  async publishForUser(session: Session, skillId: string, targetTenantId: string): Promise<'published'|'already-published'|'team-required'|'not-publishable'|'not-found'> {
    if (!uuid.test(skillId) || !uuid.test(targetTenantId)) return 'not-found';
    return this.transaction(async connection => {
      const [skills] = await connection.execute<RowDataPacket[]>(`SELECT id,name,description,instructions,visibility,updated_at AS sourceUpdatedAt
        FROM bot_skills WHERE id=? AND owner_id=? FOR UPDATE`, [skillId,session.userId]);
      if (!skills.length) return 'not-found';
      if (skills[0].visibility !== 'private') return 'not-publishable';
      const [workspaces] = await connection.execute<RowDataPacket[]>(`SELECT t.tenant_type AS tenantType FROM tenants t JOIN memberships m ON m.tenant_id=t.id
        WHERE t.id=? AND m.user_id=? FOR UPDATE`,[targetTenantId,session.userId]);
      if(!workspaces.length)return 'not-found';
      if (String(workspaces[0]?.tenantType || '') !== 'team') return 'team-required';
      const [existing] = await connection.execute<RowDataPacket[]>('SELECT skill_id FROM bot_skill_publications WHERE skill_id=? AND tenant_id=? FOR UPDATE', [skillId,targetTenantId]);
      if (existing.length) return 'already-published';
      const skill=skills[0];
      await connection.execute(`INSERT INTO bot_skill_publications (skill_id,tenant_id,owner_id,name,description,instructions,source_updated_at)
        VALUES (?,?,?,?,?,?,?)`, [skillId,targetTenantId,session.userId,skill.name,skill.description,skill.instructions,skill.sourceUpdatedAt]);
      return 'published';
    });
  }

  async syncForUser(session: Session, skillId: string, targetTenantId: string): Promise<boolean> {
    if (!uuid.test(skillId) || !uuid.test(targetTenantId)) return false;
    return this.transaction(async connection => {
      const [result] = await connection.execute<import('mysql2').ResultSetHeader>(`UPDATE bot_skill_publications p
        JOIN bot_skills s ON s.id=p.skill_id AND s.owner_id=p.owner_id
        JOIN tenants t ON t.id=p.tenant_id AND t.tenant_type='team'
        JOIN memberships m ON m.tenant_id=t.id AND m.user_id=?
        SET p.name=s.name,p.description=s.description,p.instructions=s.instructions,p.source_updated_at=s.updated_at,p.updated_at=UTC_TIMESTAMP(3)
        WHERE p.skill_id=? AND p.tenant_id=? AND p.owner_id=? AND s.visibility='private'`, [session.userId,skillId,targetTenantId,session.userId]);
      if(result.affectedRows===1)return true;
      const [existing]=await connection.execute<RowDataPacket[]>(`SELECT p.skill_id FROM bot_skill_publications p JOIN bot_skills s ON s.id=p.skill_id AND s.owner_id=p.owner_id
        JOIN tenants t ON t.id=p.tenant_id AND t.tenant_type='team' JOIN memberships m ON m.tenant_id=t.id AND m.user_id=?
        WHERE p.skill_id=? AND p.tenant_id=? AND p.owner_id=? AND s.visibility='private'`, [session.userId,skillId,targetTenantId,session.userId]);
      return existing.length===1;
    });
  }

  async unpublishForUser(session: Session, skillId: string, targetTenantId: string): Promise<boolean> {
    if (!uuid.test(skillId) || !uuid.test(targetTenantId)) return false;
    return this.transaction(async connection => {
      const [memberships]=await connection.execute<RowDataPacket[]>(`SELECT t.id FROM tenants t JOIN memberships m ON m.tenant_id=t.id
        WHERE t.id=? AND t.tenant_type='team' AND m.user_id=? FOR UPDATE`,[targetTenantId,session.userId]);
      if(!memberships.length)return false;
      return this.removePublication(connection,targetTenantId,session.userId,skillId);
    });
  }

  private async liveOwnedRun(connection: Pool | PoolConnection, scope: BotSkillScope, lock: boolean): Promise<boolean> {
    const [rows] = await connection.execute<RowDataPacket[]>(`SELECT r.id FROM agent_runs r JOIN bots b ON b.id=r.bot_id
      WHERE r.id=? AND r.bot_id=? AND r.lease_id=? AND r.status='running' AND r.lease_until>UTC_TIMESTAMP(3) AND b.tenant_id=? AND b.owner_id=?${lock ? ' FOR UPDATE' : ''}`,
      [scope.runId, scope.botId, scope.leaseId, scope.owner.tenantId, scope.owner.userId]);
    return rows.length === 1;
  }

  private async removeAllPublications(connection: PoolConnection, ownerId: string, skillId: string): Promise<void> {
    await connection.execute(`DELETE a FROM bot_skill_access a JOIN bots b ON b.id=a.bot_id
      JOIN bot_skill_publications p ON p.skill_id=a.skill_id AND p.tenant_id=b.tenant_id
      WHERE a.skill_id=? AND p.owner_id=? AND b.owner_id<>?`, [skillId,ownerId,ownerId]);
    await connection.execute('DELETE FROM bot_skill_publications WHERE skill_id=? AND owner_id=?',[skillId,ownerId]);
  }

  private async removePublication(connection: PoolConnection, tenantId: string, ownerId: string, skillId: string): Promise<boolean> {
    await connection.execute(`DELETE a FROM bot_skill_access a JOIN bots b ON b.id=a.bot_id
      WHERE a.skill_id=? AND b.tenant_id=? AND b.owner_id<>?`, [skillId,tenantId,ownerId]);
    const [result]=await connection.execute<import('mysql2').ResultSetHeader>('DELETE FROM bot_skill_publications WHERE skill_id=? AND tenant_id=? AND owner_id=?',[skillId,tenantId,ownerId]);
    return result.affectedRows===1;
  }

  private async transaction<T>(fn: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try { await connection.beginTransaction(); const value = await fn(connection); await connection.commit(); return value; }
    catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
}

export function validateSkillInput(value: unknown): BotSkillInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Skill');
  const body = value as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
  const visibility = body.visibility === 'bot' ? 'bot' : body.visibility === undefined || body.visibility === 'private' ? 'private' : null;
  if (Object.keys(body).some(key => !['name','description','instructions','visibility'].includes(key)) || !name || name.length > 120 || !description || description.length > 1000 || !instructions || instructions.length > 12000 || !visibility) throw new Error('Invalid Skill');
  if (containsSensitiveData(`${name}\n${description}\n${instructions}`)) throw new Error('This Skill cannot contain credentials or personal contact details. Store sensitive details in a secure vault.');
  return { name, description, instructions, visibility };
}

function validScope(scope: BotSkillScope): boolean {
  return Boolean(scope && uuid.test(scope.botId) && uuid.test(scope.runId) && uuid.test(scope.leaseId) && uuid.test(scope.owner?.tenantId) && uuid.test(scope.owner?.userId));
}

function deterministicRequestId(runId: string, input: BotSkillInput): string {
  const digest = createHash('sha256').update(`${runId}\n${input.name}\n${input.description}\n${input.instructions}\n${input.visibility}`).digest('hex').slice(0,32).split('');
  digest[12] = '5'; digest[16] = ((parseInt(digest[16], 16) & 3) | 8).toString(16);
  const hex = digest.join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function mapSkill(row: RowDataPacket): BotSkill {
  const enabled=row.enabled===true||row.enabled===1||row.enabled==='1';
  const truthy=(value:unknown)=>value===true||value===1||value==='1';
  return { id:String(row.id), creatorBotId:row.creatorBotId == null ? null : String(row.creatorBotId), name:String(row.name), description:String(row.description), instructions:String(row.instructions), visibility:row.visibility === 'bot' ? 'bot' : 'private', enabled, published:truthy(row.published), publishedTenantIds:Array.isArray(row.publishedTenantIds)?row.publishedTenantIds.map(String):[], outOfSyncTenantIds:Array.isArray(row.outOfSyncTenantIds)?row.outOfSyncTenantIds.map(String):[], isOwner:row.isOwner===undefined?true:truthy(row.isOwner), sharedBy:row.sharedBy == null ? null : String(row.sharedBy), outOfSync:truthy(row.outOfSync), createdAt:String(row.createdAt), updatedAt:String(row.updatedAt) };
}
