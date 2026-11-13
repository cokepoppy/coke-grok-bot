import type { Pool,PoolConnection,RowDataPacket } from 'mysql2/promise';
import type { ResultSetHeader } from 'mysql2';
import type { Session } from './tenant-store.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface Approval { id:string;runId:string;action:string;status:'pending'|'approved'|'denied'|'consumed'|'expired';expiresAt:Date;hasScreenshot?:boolean }
/**
 * Kept as a read-only compatibility store for legacy per-action approvals.
 * Current task-scoped computer actions execute directly; sign-in and human
 * verification use Computer takeover instead of this approval queue.
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
 /** Retire action cards left by older runtimes after task-scoped execution is enabled. */
 async expirePending():Promise<number>{
  return this.transaction(async c=>{
   await c.execute(`DELETE s FROM approval_screenshots s JOIN run_approvals a ON a.id=s.approval_id WHERE a.status='pending'`);
   const [result]=await c.execute<ResultSetHeader>(`UPDATE run_approvals SET status='expired' WHERE status='pending'`);
   return result.affectedRows;
  });
 }
 async propose(_runId:string,_leaseId:string,_action:string,_ttlSeconds:number,_image?:Buffer):Promise<null>{
  return null;
 }
 async list(session:Session,runId:string):Promise<Approval[]|null>{
  const [owned]=await this.pool.execute<RowDataPacket[]>(`SELECT r.id FROM agent_runs r JOIN bots b ON b.id=r.bot_id WHERE r.id=? AND b.tenant_id=? AND b.owner_id=?`,[runId,session.tenantId,session.userId]);if(!owned.length)return null;
  const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT a.id,a.run_id AS runId,a.action_text AS action,CASE WHEN a.status='pending' OR (a.status='approved' AND a.expires_at<=UTC_TIMESTAMP(3)) THEN 'expired' ELSE a.status END AS status,a.expires_at AS expiresAt,FALSE AS hasScreenshot FROM run_approvals a WHERE a.run_id=? ORDER BY a.created_at,a.id`,[runId]);
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
  void session;
  return 'conflict';
 }
 async consume(runId:string,leaseId:string,id:string,action:string):Promise<boolean>{
  if(!uuid.test(runId)||!uuid.test(leaseId)||!uuid.test(id)||!action.trim()||action.length>4000)throw new Error('Invalid approval consumption');
  return false;
 }
 async status(runId:string,leaseId:string,id:string):Promise<Approval['status']|null>{
  if(!uuid.test(runId)||!uuid.test(leaseId)||!uuid.test(id))throw new Error('Invalid approval identity');
  const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT CASE WHEN a.status='pending' OR (a.status='approved' AND a.expires_at<=UTC_TIMESTAMP(3)) THEN 'expired' ELSE a.status END AS status
   FROM run_approvals a JOIN agent_runs r ON r.id=a.run_id WHERE a.id=? AND a.run_id=? AND r.lease_id=? AND r.status='running' AND r.lease_until>UTC_TIMESTAMP(3)`,[id,runId,leaseId]);
  return rows.length ? rows[0].status as Approval['status'] : null;
 }
 private async transaction<T>(fn:(c:PoolConnection)=>Promise<T>):Promise<T>{const c=await this.pool.getConnection();try{await c.beginTransaction();const result=await fn(c);await c.commit();return result}catch(error){await c.rollback();throw error}finally{c.release()}}
}
