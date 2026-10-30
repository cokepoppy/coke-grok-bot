import { randomUUID,createHash } from 'node:crypto';
import type { Pool,PoolConnection,RowDataPacket } from 'mysql2/promise';
import type { ResultSetHeader } from 'mysql2';
import type { Session } from './tenant-store.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface Approval { id:string;runId:string;action:string;status:'pending'|'approved'|'denied'|'consumed'|'expired';expiresAt:Date;hasScreenshot?:boolean }
/**
 * A decision authorizes one exact server-normalized action once. The caller
 * must verify the run capability before proposing or consuming an approval.
 */
export class ApprovalStore {
 constructor(private readonly pool:Pool){}
 async migrate():Promise<void>{
  await this.pool.execute(`CREATE TABLE IF NOT EXISTS run_approvals (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    action_text TEXT NOT NULL,
    action_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status ENUM('pending','approved','denied','consumed','expired') NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    decided_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    decided_at DATETIME(3) NULL, consumed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY run_approvals_order (run_id,created_at,id),
    FOREIGN KEY (run_id) REFERENCES agent_runs(id), FOREIGN KEY (decided_by) REFERENCES users(id)
  ) ENGINE=InnoDB`);
  await this.pool.execute(`CREATE TABLE IF NOT EXISTS approval_screenshots (
    approval_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    image MEDIUMBLOB NOT NULL,
    FOREIGN KEY (approval_id) REFERENCES run_approvals(id)
  ) ENGINE=InnoDB`);
 }
 async propose(runId:string,leaseId:string,action:string,ttlSeconds:number,image?:Buffer):Promise<Approval|null>{
  const clean=action.trim();if(!uuid.test(runId)||!uuid.test(leaseId)||!clean||clean.length>4000||!Number.isSafeInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>900)throw new Error('Invalid approval');
  if(image){let hash:unknown;try{hash=(JSON.parse(clean) as {screenshotSha256?:unknown}).screenshotSha256}catch{throw new Error('Invalid screenshot action')};if(!Buffer.isBuffer(image)||image.length<8||image.length>1024*1024||!image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||createHash('sha256').update(image).digest('hex')!==hash)throw new Error('Invalid approval screenshot')}
  return this.transaction(async c=>{
   await c.execute(`DELETE s FROM approval_screenshots s JOIN run_approvals a ON a.id=s.approval_id WHERE a.expires_at<=UTC_TIMESTAMP(3)`);
   const [runs]=await c.execute<RowDataPacket[]>(`SELECT id FROM agent_runs WHERE id=? AND lease_id=? AND status='running' AND lease_until>UTC_TIMESTAMP(3) FOR UPDATE`,[runId,leaseId]);
   if(!runs.length)return null;
   const id=randomUUID(),hash=createHash('sha256').update(clean).digest('hex');
   await c.execute(`INSERT INTO run_approvals (id,run_id,action_text,action_hash,status,expires_at) VALUES (?,?,?,?,'pending',DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))`,[id,runId,clean,hash,ttlSeconds]);
   if(image)await c.execute('INSERT INTO approval_screenshots (approval_id,image) VALUES (?,?)',[id,image]);
   const [rows]=await c.execute<RowDataPacket[]>('SELECT expires_at AS expiresAt FROM run_approvals WHERE id=?',[id]);
   return {id,runId,action:clean,status:'pending',expiresAt:new Date(rows[0].expiresAt),hasScreenshot:Boolean(image)};
  });
 }
 async list(session:Session,runId:string):Promise<Approval[]|null>{
  const [owned]=await this.pool.execute<RowDataPacket[]>(`SELECT r.id FROM agent_runs r JOIN bots b ON b.id=r.bot_id WHERE r.id=? AND b.tenant_id=? AND b.owner_id=?`,[runId,session.tenantId,session.userId]);if(!owned.length)return null;
  const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT a.id,a.run_id AS runId,a.action_text AS action,CASE WHEN a.status IN ('pending','approved') AND a.expires_at<=UTC_TIMESTAMP(3) THEN 'expired' ELSE a.status END AS status,a.expires_at AS expiresAt,(s.approval_id IS NOT NULL AND a.status='pending' AND a.expires_at>UTC_TIMESTAMP(3)) AS hasScreenshot FROM run_approvals a LEFT JOIN approval_screenshots s ON s.approval_id=a.id WHERE a.run_id=? ORDER BY a.created_at,a.id`,[runId]);
  return rows.map(row=>({...row,hasScreenshot:Boolean(row.hasScreenshot)})) as Approval[];
 }
 async screenshot(session:Session,id:string):Promise<Buffer|null>{
  if(!uuid.test(id))return null;
  const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT s.image FROM approval_screenshots s JOIN run_approvals a ON a.id=s.approval_id JOIN agent_runs r ON r.id=a.run_id JOIN bots b ON b.id=r.bot_id WHERE a.id=? AND b.tenant_id=? AND b.owner_id=? AND a.status='pending' AND a.expires_at>UTC_TIMESTAMP(3)`,[id,session.tenantId,session.userId]);
  return rows.length && Buffer.isBuffer(rows[0].image)?rows[0].image:null;
 }
 async purgeExpiredScreenshots():Promise<void>{
  await this.pool.execute(`DELETE s FROM approval_screenshots s JOIN run_approvals a ON a.id=s.approval_id WHERE a.expires_at<=UTC_TIMESTAMP(3)`);
 }
 async decide(session:Session,id:string,decision:'approved'|'denied'):Promise<'decided'|'not_found'|'conflict'>{
  if(!uuid.test(id)||!['approved','denied'].includes(decision))throw new Error('Invalid decision');
  return this.transaction(async c=>{
   const [rows]=await c.execute<RowDataPacket[]>(`SELECT a.status,a.expires_at>UTC_TIMESTAMP(3) AS valid,r.status AS runStatus,r.lease_until>UTC_TIMESTAMP(3) AS leased FROM run_approvals a JOIN agent_runs r ON r.id=a.run_id JOIN bots b ON b.id=r.bot_id WHERE a.id=? AND b.tenant_id=? AND b.owner_id=? FOR UPDATE`,[id,session.tenantId,session.userId]);
   if(!rows.length)return 'not_found';
   if(rows[0].status!=='pending'||!rows[0].valid||rows[0].runStatus!=='running'||!rows[0].leased)return 'conflict';
   await c.execute('UPDATE run_approvals SET status=?,decided_by=?,decided_at=UTC_TIMESTAMP(3) WHERE id=?',[decision,session.userId,id]);await c.execute('DELETE FROM approval_screenshots WHERE approval_id=?',[id]);return 'decided';
  });
 }
 async consume(runId:string,leaseId:string,id:string,action:string):Promise<boolean>{
  const clean=action.trim();if(!uuid.test(runId)||!uuid.test(leaseId)||!uuid.test(id)||!clean||clean.length>4000)throw new Error('Invalid approval consumption');
  const hash=createHash('sha256').update(clean).digest('hex');
  const [result]=await this.pool.execute<ResultSetHeader>(`UPDATE run_approvals a JOIN agent_runs r ON r.id=a.run_id SET a.status='consumed',a.consumed_at=UTC_TIMESTAMP(3) WHERE a.id=? AND a.run_id=? AND a.action_hash=? AND a.status='approved' AND a.expires_at>UTC_TIMESTAMP(3) AND r.status='running' AND r.lease_id=? AND r.lease_until>UTC_TIMESTAMP(3)`,[id,runId,hash,leaseId]);
  return result.affectedRows===1;
 }
 async status(runId:string,leaseId:string,id:string):Promise<Approval['status']|null>{
  if(!uuid.test(runId)||!uuid.test(leaseId)||!uuid.test(id))throw new Error('Invalid approval identity');
  const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT CASE WHEN a.status IN ('pending','approved') AND a.expires_at<=UTC_TIMESTAMP(3) THEN 'expired' ELSE a.status END AS status
   FROM run_approvals a JOIN agent_runs r ON r.id=a.run_id WHERE a.id=? AND a.run_id=? AND r.lease_id=? AND r.status='running' AND r.lease_until>UTC_TIMESTAMP(3)`,[id,runId,leaseId]);
  return rows.length ? rows[0].status as Approval['status'] : null;
 }
 private async transaction<T>(fn:(c:PoolConnection)=>Promise<T>):Promise<T>{const c=await this.pool.getConnection();try{await c.beginTransaction();const result=await fn(c);await c.commit();return result}catch(error){await c.rollback();throw error}finally{c.release()}}
}
