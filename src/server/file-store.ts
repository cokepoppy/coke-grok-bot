import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { ResultSetHeader } from 'mysql2';
import type { Session } from './tenant-store.ts';

export type RunFileKind = 'input' | 'output';
export interface RunFile { id: string; name: string; mimeType: string; size: number; sha256: string; kind: RunFileKind; storageKey?: string }
export interface StoredWorkspaceFile extends RunFile { botId: string; storageKey: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeName = /^[^\\/\u0000-\u001f\u007f]{1,180}$/;
const extension = /^[a-z0-9]{1,12}$/i;
const maxAttachments = 20;
const maxImageBytes = 25 * 1024 * 1024;
const maxImagesTotalBytes = 200 * 1024 * 1024;
const maxDocumentBytes = 250 * 1024 * 1024;
const maxVideoBytes = 1024 * 1024 * 1024;

function cleanArtifactPath(value: string): string {
  const parts=value.split('/');
  if(!value||value.length>500||Buffer.byteLength(value,'utf8')>255||value.includes('\\')||parts.some(part=>!safeName.test(part)||part==='.'||part==='..'||part.startsWith('.')))throw new Error('Invalid result file name');
  return value;
}

export function cleanUploadName(value: string): string {
  const name = value.normalize('NFC').split(/[\\/]/).at(-1)?.trim() || '';
  if (!safeName.test(name) || name === '.' || name === '..' || Buffer.byteLength(name, 'utf8') > 255) throw new Error('Invalid attachment name');
  return name;
}

export function uploadExtension(name: string): string {
  const suffix = name.includes('.') ? name.split('.').at(-1) || '' : '';
  return suffix && extension.test(suffix) ? suffix.toLowerCase() : '';
}

export function validateUploadSize(mimeType: string, size: number): void {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Invalid attachment size');
  const limit = mimeType.startsWith('image/') ? maxImageBytes : mimeType.startsWith('video/') ? maxVideoBytes : maxDocumentBytes;
  if (size > limit) throw new Error('Attachment is too large');
}

/** MySQL metadata only; file bytes live in the user's persistent K3D workspace PVC. */
export class WorkspaceFileStore {
  constructor(private readonly pool: Pool) {}

  async ownsBot(session: Session, botId: string): Promise<boolean> {
    if (!uuid.test(botId)) return false;
    const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT id FROM bots WHERE id=? AND tenant_id=? AND owner_id=?', [botId,session.tenantId,session.userId]);
    return rows.length === 1;
  }

  async migrate(): Promise<void> {
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS bot_files (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      bot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      display_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(127) CHARACTER SET ascii NOT NULL,
      size BIGINT UNSIGNED NOT NULL,
      sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      storage_key VARCHAR(700) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY bot_file_storage_key (bot_id, storage_key),
      KEY bot_files_recent (bot_id, created_at, id),
      FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS agent_run_files (
      run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      kind ENUM('input','output') NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (run_id, file_id),
      KEY run_files_file (file_id, run_id),
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (file_id) REFERENCES bot_files(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  }

  newUpload(botId: string, name: string, mimeType: string, size: number, sha256: string): StoredWorkspaceFile {
    const cleanName = cleanUploadName(name);
    if (!uuid.test(botId) || typeof mimeType !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(mimeType) || mimeType.length > 127 || !/^[a-f0-9]{64}$/i.test(sha256)) throw new Error('Invalid attachment metadata');
    validateUploadSize(mimeType, size);
    const id = randomUUID();
    const suffix = uploadExtension(cleanName);
    const storageKey = `shared/uploads/${id}${suffix ? `.${suffix}` : ''}`;
    return { id, botId, name: cleanName, mimeType, size, sha256: sha256.toLowerCase(), kind: 'input', storageKey };
  }

  async saveUpload(session: Session, file: StoredWorkspaceFile): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(`INSERT INTO bot_files (id,bot_id,display_name,mime_type,size,sha256,storage_key)
      SELECT ?,b.id,?,?,?,?,? FROM bots b WHERE b.id=? AND b.tenant_id=? AND b.owner_id=?`,
    [file.id,file.name,file.mimeType,file.size,file.sha256,file.storageKey,file.botId,session.tenantId,session.userId]);
    return result.affectedRows === 1;
  }

  async fileForDownload(session: Session, fileId: string): Promise<StoredWorkspaceFile | null> {
    if (!uuid.test(fileId)) return null;
    const [rows] = await this.pool.execute<RowDataPacket[]>(`SELECT f.id,f.bot_id AS botId,f.display_name AS name,f.mime_type AS mimeType,
      f.size,f.sha256,f.storage_key AS storageKey,rf.kind FROM bot_files f JOIN bots b ON b.id=f.bot_id
      JOIN agent_run_files rf ON rf.file_id=f.id JOIN agent_runs r ON r.id=rf.run_id AND r.bot_id=f.bot_id
      WHERE f.id=? AND b.tenant_id=? AND b.owner_id=? LIMIT 1`,[fileId,session.tenantId,session.userId]);
    if (!rows.length) return null;
    const row = rows[0];
    return { ...row, id:String(row.id), botId:String(row.botId), name:String(row.name), mimeType:String(row.mimeType), size:Number(row.size), sha256:String(row.sha256), storageKey:String(row.storageKey), kind:row.kind as RunFileKind } as StoredWorkspaceFile;
  }

  /** Remove metadata only while the uploaded bytes have no run or group references. */
  async removeUnattachedUpload(session: Session, fileId: string): Promise<StoredWorkspaceFile | null> {
    if (!uuid.test(fileId)) return null;
    const [rows] = await this.pool.execute<RowDataPacket[]>(`SELECT f.id,f.bot_id AS botId,f.display_name AS name,f.mime_type AS mimeType,
      f.size,f.sha256,f.storage_key AS storageKey FROM bot_files f JOIN bots b ON b.id=f.bot_id
      WHERE f.id=? AND b.tenant_id=? AND b.owner_id=?
        AND NOT EXISTS(SELECT 1 FROM agent_run_files rf WHERE rf.file_id=f.id)
        AND NOT EXISTS(SELECT 1 FROM bot_group_files gf WHERE gf.file_id=f.id) LIMIT 1`,[fileId,session.tenantId,session.userId]);
    if (!rows.length) return null;
    const row=rows[0];
    const [result]=await this.pool.execute<ResultSetHeader>(`DELETE f FROM bot_files f JOIN bots b ON b.id=f.bot_id
      WHERE f.id=? AND b.tenant_id=? AND b.owner_id=?
        AND NOT EXISTS(SELECT 1 FROM agent_run_files rf WHERE rf.file_id=f.id)
        AND NOT EXISTS(SELECT 1 FROM bot_group_files gf WHERE gf.file_id=f.id)`,[fileId,session.tenantId,session.userId]);
    if(result.affectedRows!==1)return null;
    return {id:String(row.id),botId:String(row.botId),name:String(row.name),mimeType:String(row.mimeType),size:Number(row.size),sha256:String(row.sha256),storageKey:String(row.storageKey),kind:'input'};
  }

  static validateFileIds(fileIds: unknown): string[] {
    if (fileIds === undefined) return [];
    if (!Array.isArray(fileIds) || fileIds.length > maxAttachments || fileIds.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(fileIds).size !== fileIds.length) throw new Error('Invalid attachment list');
    return [...fileIds] as string[];
  }

  static validateInputRows(rows: RowDataPacket[], ids: string[]): RunFile[] {
    if (rows.length !== ids.length) throw new Error('Attachment is unavailable for this Bot');
    const images = rows.filter(row => String(row.mimeType).startsWith('image/'));
    if (images.some(row => Number(row.size) > maxImageBytes) || images.reduce((sum,row) => sum + Number(row.size),0) > maxImagesTotalBytes) throw new Error('Image attachments exceed the per-message limit');
    for (const row of rows) validateUploadSize(String(row.mimeType),Number(row.size));
    return rows.map(row => ({ id:String(row.id),name:String(row.name),mimeType:String(row.mimeType),size:Number(row.size),sha256:String(row.sha256),kind:'input',storageKey:String(row.storageKey) }));
  }

  static validateArtifacts(value: unknown, runId: string): Array<Omit<StoredWorkspaceFile,'id'|'botId'|'kind'>> {
    if (!Array.isArray(value) || value.length > maxAttachments) throw new Error('Invalid result files');
    const seen = new Set<string>();
    return value.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid result file');
      const file = item as Record<string,unknown>;
      const name = cleanArtifactPath(String(file.name || ''));
      const mimeType = String(file.mimeType || 'application/octet-stream');
      const size = Number(file.size);
      const sha256 = String(file.sha256 || '');
      const storageKey = String(file.storageKey || '');
      if (seen.has(name) || !/^[\w.+-]+\/[\w.+-]+$/.test(mimeType) || mimeType.length > 127 || !/^[a-f0-9]{64}$/i.test(sha256) || !Number.isSafeInteger(size) || size < 1 || size > maxDocumentBytes || storageKey !== `tasks/${runId}/artifacts/${name}`) throw new Error('Invalid result file metadata');
      seen.add(name);
      return { name,mimeType,size,sha256:sha256.toLowerCase(),storageKey };
    });
  }
}
