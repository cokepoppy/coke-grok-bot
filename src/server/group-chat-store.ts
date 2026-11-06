import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolConnection,RowDataPacket} from 'mysql2/promise';
import type {Session} from './tenant-store.ts';
import type {BotShape} from './bot-store.ts';
import {WorkspaceFileStore,type RunFile,type StoredWorkspaceFile} from './file-store.ts';
import {isRunDiagnosticCode,type RunDiagnosticCode} from './run-diagnostics.ts';
import {validateAgentExecutionAudit,type AgentExecutionAudit} from './execution-audit.ts';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class GroupRequestConflict extends Error {}

export interface GroupMember {id:string;name:string;label:string;color:string;shape:BotShape;position:number}
export interface StoredGroup {id:string;name:string;members:GroupMember[];preview:string;lastActivityAt:string|null}
export interface StoredGroupReplacementRun {
 id:string;status:'queued'|'running'|'completed'|'failed'|'unknown';result:string|null;computerUsed:boolean;updatedAt:string|null;diagnosticCode:RunDiagnosticCode|null;executionAudit:AgentExecutionAudit|null;files:RunFile[];
}
export interface StoredGroupMessage {
 id:string;turnId:string;role:'user'|'bot';botId:string|null;botName:string|null;text:string|null;targetBotIds:string[];
 runId:string|null;status:'queued'|'running'|'completed'|'failed'|'unknown'|null;
 recoveryState:'none'|'pending'|'retried'|'acknowledged'|null;replacementRunId:string|null;computerUsed:boolean;updatedAt:string|null;diagnosticCode:RunDiagnosticCode|null;executionAudit:AgentExecutionAudit|null;
 files:RunFile[];replacementRun:StoredGroupReplacementRun|null;
}
export interface GroupChatView {group:StoredGroup;messages:StoredGroupMessage[]}

/** Durable group membership and message-to-run links. Each participating Bot gets its own normal Pi/DSH run and screen. */
export class GroupChatStore {
 constructor(private readonly pool:Pool){}
 async migrate():Promise<void>{
  await this.pool.execute(`CREATE TABLE IF NOT EXISTS bot_group_chats (
   id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
   tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   name VARCHAR(60) NOT NULL,
   created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
   updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
   UNIQUE KEY group_create_request (tenant_id,owner_id,request_id),
   KEY owner_groups (tenant_id,owner_id,updated_at,id),
   FOREIGN KEY (tenant_id,owner_id) REFERENCES memberships(tenant_id,user_id)
  ) ENGINE=InnoDB`);
  await this.pool.execute(`CREATE TABLE IF NOT EXISTS bot_group_members (
   group_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   bot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   position TINYINT UNSIGNED NOT NULL,
   PRIMARY KEY (group_id,bot_id),
   UNIQUE KEY group_member_position (group_id,position),
   FOREIGN KEY (group_id) REFERENCES bot_group_chats(id) ON DELETE CASCADE,
   FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await this.pool.execute(`CREATE TABLE IF NOT EXISTS bot_group_turns (
   id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
   group_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   prompt TEXT NOT NULL,
   created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
   UNIQUE KEY group_turn_request (group_id,request_id),
   KEY group_turns (group_id,created_at,id),
   FOREIGN KEY (group_id) REFERENCES bot_group_chats(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await this.pool.execute(`CREATE TABLE IF NOT EXISTS bot_group_messages (
   id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
   group_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   turn_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
   sender_type ENUM('user','bot') NOT NULL,
   sender_bot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
   run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
   message_text TEXT NULL,
   created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
   UNIQUE KEY group_run_message (run_id),
   KEY group_history (group_id,sequence),
   FOREIGN KEY (group_id) REFERENCES bot_group_chats(id) ON DELETE CASCADE,
   FOREIGN KEY (turn_id) REFERENCES bot_group_turns(id) ON DELETE CASCADE,
   FOREIGN KEY (sender_bot_id) REFERENCES bots(id) ON DELETE CASCADE,
   FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await this.pool.execute(`CREATE TABLE IF NOT EXISTS bot_group_files (
   group_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
   PRIMARY KEY (group_id,file_id),
   KEY group_files_file (file_id,group_id),
   FOREIGN KEY (group_id) REFERENCES bot_group_chats(id) ON DELETE CASCADE,
   FOREIGN KEY (file_id) REFERENCES bot_files(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await this.pool.execute(`CREATE TABLE IF NOT EXISTS bot_group_message_files (
   message_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   group_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   position SMALLINT UNSIGNED NOT NULL,
   PRIMARY KEY (message_id,file_id),
   UNIQUE KEY group_message_file_position (message_id,position),
   KEY group_message_files (group_id,file_id,message_id),
   FOREIGN KEY (message_id) REFERENCES bot_group_messages(id) ON DELETE CASCADE,
   FOREIGN KEY (group_id) REFERENCES bot_group_chats(id) ON DELETE CASCADE,
   FOREIGN KEY (file_id) REFERENCES bot_files(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
 }

 async fileUploadBot(session:Session,groupId:string):Promise<string|null>{
  if(!uuid.test(groupId))return null;
  const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT b.id FROM bot_group_chats g JOIN bot_group_members m ON m.group_id=g.id
   JOIN bots b ON b.id=m.bot_id WHERE g.id=? AND g.tenant_id=? AND g.owner_id=? ORDER BY m.position`,[groupId,session.tenantId,session.userId]);
  if(rows.length<2||rows.length>6)return null;
  return String(rows[0].id);
 }

 async registerUpload(session:Session,groupId:string,file:StoredWorkspaceFile):Promise<boolean>{
  if(!uuid.test(groupId)||!uuid.test(file.id)||!uuid.test(file.botId))return false;
  const connection=await this.pool.getConnection();
  try{
   await connection.beginTransaction();
   const [members]=await connection.execute<RowDataPacket[]>(`SELECT b.id FROM bot_group_chats g JOIN bot_group_members m ON m.group_id=g.id
    JOIN bots b ON b.id=m.bot_id WHERE g.id=? AND g.tenant_id=? AND g.owner_id=? ORDER BY m.position FOR UPDATE`,[groupId,session.tenantId,session.userId]);
   if(members.length<2||members.length>6||String(members[0].id)!==file.botId){await connection.rollback();return false;}
   const [owned]=await connection.execute<RowDataPacket[]>(`SELECT f.id FROM bot_files f JOIN bots b ON b.id=f.bot_id
    WHERE f.id=? AND f.bot_id=? AND b.tenant_id=? AND b.owner_id=? FOR UPDATE`,[file.id,file.botId,session.tenantId,session.userId]);
   if(!owned.length){await connection.rollback();return false;}
   await connection.execute('INSERT INTO bot_group_files (group_id,file_id) VALUES (?,?)',[groupId,file.id]);
   await connection.commit();return true;
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
 }

 async fileForDownload(session:Session,fileId:string):Promise<StoredWorkspaceFile|null>{
  if(!uuid.test(fileId))return null;
  const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT f.id,f.bot_id AS botId,f.display_name AS name,f.mime_type AS mimeType,
   f.size,f.sha256,f.storage_key AS storageKey FROM bot_files f JOIN bots b ON b.id=f.bot_id
   JOIN bot_group_files gf ON gf.file_id=f.id JOIN bot_group_chats g ON g.id=gf.group_id
   WHERE f.id=? AND g.tenant_id=? AND g.owner_id=? AND b.tenant_id=? AND b.owner_id=? LIMIT 1`,[fileId,session.tenantId,session.userId,session.tenantId,session.userId]);
  if(!rows.length)return null;
  const row=rows[0];return{id:String(row.id),botId:String(row.botId),name:String(row.name),mimeType:String(row.mimeType),size:Number(row.size),sha256:String(row.sha256),storageKey:String(row.storageKey),kind:'input'};
 }

 async create(session:Session,input:{requestId:string;name:string;botIds:unknown}):Promise<StoredGroup|null>{
  const name=input.name.trim();
  if(!uuid.test(input.requestId)||!name||name.length>60||!Array.isArray(input.botIds)||input.botIds.length<2||input.botIds.length>6||input.botIds.some(id=>typeof id!=='string'||!uuid.test(id))||new Set(input.botIds).size!==input.botIds.length)throw new Error('Invalid group');
  const botIds=input.botIds as string[];
  const connection=await this.pool.getConnection();
  let groupId='';
  try{
   await connection.beginTransaction();
   const [existing]=await connection.execute<RowDataPacket[]>('SELECT id,name FROM bot_group_chats WHERE tenant_id=? AND owner_id=? AND request_id=? FOR UPDATE',[session.tenantId,session.userId,input.requestId]);
   if(existing.length){
    groupId=String(existing[0].id);
    const members=await this.memberIds(connection,groupId);
    if(String(existing[0].name)!==name||members.length!==botIds.length||members.some((id,index)=>id!==botIds[index]))throw new GroupRequestConflict('Group create request ID already used with different content');
    await connection.commit();
   }else{
    const placeholders=botIds.map(()=>'?').join(',');
    const [owned]=await connection.execute<RowDataPacket[]>(`SELECT id FROM bots WHERE tenant_id=? AND owner_id=? AND id IN (${placeholders}) ORDER BY FIELD(id,${placeholders}) FOR UPDATE`,[session.tenantId,session.userId,...botIds,...botIds]);
    if(owned.length!==botIds.length){await connection.rollback();return null;}
    groupId=randomUUID();
    await connection.execute('INSERT INTO bot_group_chats (id,tenant_id,owner_id,request_id,name) VALUES (?,?,?,?,?)',[groupId,session.tenantId,session.userId,input.requestId,name]);
    for(let position=0;position<botIds.length;position++)await connection.execute('INSERT INTO bot_group_members (group_id,bot_id,position) VALUES (?,?,?)',[groupId,botIds[position],position]);
    await connection.commit();
   }
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
  const groups=await this.list(session);return groups.find(group=>group.id===groupId)||null;
 }

 async list(session:Session):Promise<StoredGroup[]>{
  const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT g.id,g.name,
    COALESCE(NULLIF(LEFT(TRIM(COALESCE(rr.result,r.result,m.message_text,'')),180),''),CASE COALESCE(rr.status,r.status) WHEN 'running' THEN 'Working…' WHEN 'queued' THEN 'Queued' WHEN 'unknown' THEN 'Outcome unknown' WHEN 'failed' THEN 'Failed' ELSE 'Start a conversation' END) AS preview,
    DATE_FORMAT(GREATEST(g.updated_at,COALESCE(rr.updated_at,r.updated_at,g.updated_at)),'%Y-%m-%dT%H:%i:%s.%fZ') AS lastActivityAt
   FROM bot_group_chats g
   LEFT JOIN bot_group_messages m ON m.sequence=(SELECT MAX(last.sequence) FROM bot_group_messages last WHERE last.group_id=g.id)
   LEFT JOIN agent_runs r ON r.id=m.run_id
   LEFT JOIN agent_runs rr ON rr.id=r.replacement_run_id AND rr.bot_id=r.bot_id
   WHERE g.tenant_id=? AND g.owner_id=? ORDER BY GREATEST(g.updated_at,COALESCE(rr.updated_at,r.updated_at,g.updated_at)) DESC,g.created_at DESC`,[session.tenantId,session.userId]);
  if(!rows.length)return[];
  const ids=rows.map(row=>String(row.id)),placeholders=ids.map(()=>'?').join(',');
  const [members]=await this.pool.execute<RowDataPacket[]>(`SELECT m.group_id AS groupId,b.id,b.name,b.label,b.color,b.shape,m.position FROM bot_group_members m JOIN bot_group_chats g ON g.id=m.group_id JOIN bots b ON b.id=m.bot_id WHERE g.tenant_id=? AND g.owner_id=? AND m.group_id IN (${placeholders}) ORDER BY m.group_id,m.position`,[session.tenantId,session.userId,...ids]);
  const byGroup=new Map<string,GroupMember[]>();
  for(const row of members){const id=String(row.groupId),value=byGroup.get(id)||[];value.push({id:String(row.id),name:String(row.name),label:String(row.label||''),color:String(row.color),shape:String(row.shape) as BotShape,position:Number(row.position)});byGroup.set(id,value)}
  return rows.map(row=>({id:String(row.id),name:String(row.name),members:byGroup.get(String(row.id))||[],preview:String(row.preview||'Start a conversation'),lastActivityAt:row.lastActivityAt==null?null:String(row.lastActivityAt)}));
 }

 async get(session:Session,groupId:string):Promise<GroupChatView|null>{
  if(!uuid.test(groupId))return null;
  const group=(await this.list(session)).find(item=>item.id===groupId);if(!group)return null;
  const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT m.id,m.turn_id AS turnId,m.sender_type AS senderType,m.sender_bot_id AS botId,b.name AS botName,
    m.message_text AS messageText,m.run_id AS runId,r.status,r.result,r.recovery_state AS recoveryState,r.replacement_run_id AS replacementRunId,
    r.computer_used AS computerUsed,r.execution_audit AS executionAudit,DATE_FORMAT(r.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt,
    (SELECT SUBSTRING(e.detail,12) FROM agent_run_events e WHERE e.run_id=r.id AND e.status='unknown' AND e.detail LIKE 'diagnostic:%' ORDER BY e.sequence DESC LIMIT 1) AS diagnosticCode,
    rr.status AS replacementStatus,rr.result AS replacementResult,rr.computer_used AS replacementComputerUsed,rr.execution_audit AS replacementExecutionAudit,
    DATE_FORMAT(rr.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS replacementUpdatedAt,
    (SELECT SUBSTRING(e.detail,12) FROM agent_run_events e WHERE e.run_id=rr.id AND e.status='unknown' AND e.detail LIKE 'diagnostic:%' ORDER BY e.sequence DESC LIMIT 1) AS replacementDiagnosticCode
   FROM bot_group_messages m JOIN bot_group_chats g ON g.id=m.group_id LEFT JOIN bots b ON b.id=m.sender_bot_id
   LEFT JOIN agent_runs r ON r.id=m.run_id LEFT JOIN agent_runs rr ON rr.id=r.replacement_run_id AND rr.bot_id=r.bot_id
   WHERE m.group_id=? AND g.tenant_id=? AND g.owner_id=? ORDER BY m.sequence`,[groupId,session.tenantId,session.userId]);
  const runIds=rows.flatMap(row=>row.runId==null?[]:[String(row.runId)]);
  const replacementRunIds=rows.flatMap(row=>row.replacementRunId==null?[]:[String(row.replacementRunId)]);
  const allRunIds=[...new Set([...runIds,...replacementRunIds])];
  const recipientsByTurn=new Map<string,string[]>();
  for(const row of rows)if(String(row.senderType)==='bot'&&row.botId!=null){const turnId=String(row.turnId),recipients=recipientsByTurn.get(turnId)||[];recipients.push(String(row.botId));recipientsByTurn.set(turnId,recipients)}
  const filesByRun=new Map<string,RunFile[]>();
  if(allRunIds.length){
   const [files]=await this.pool.execute<RowDataPacket[]>(`SELECT rf.run_id AS runId,f.id,f.display_name AS name,f.mime_type AS mimeType,f.size,f.sha256,rf.kind
    FROM agent_run_files rf JOIN bot_files f ON f.id=rf.file_id JOIN agent_runs r ON r.id=rf.run_id
    JOIN bots b ON b.id=r.bot_id JOIN bot_group_members gm ON gm.bot_id=r.bot_id
    JOIN bot_group_chats g ON g.id=gm.group_id AND g.tenant_id=b.tenant_id AND g.owner_id=b.owner_id
    JOIN bot_group_messages m ON m.group_id=g.id AND (m.run_id=r.id OR EXISTS(
      SELECT 1 FROM agent_runs parent WHERE parent.id=m.run_id AND parent.replacement_run_id=r.id AND parent.bot_id=r.bot_id
    ))
    WHERE rf.run_id IN (${allRunIds.map(()=>'?').join(',')}) AND g.id=? AND g.tenant_id=? AND g.owner_id=? AND b.tenant_id=? AND b.owner_id=?
    ORDER BY rf.created_at,f.id`,[...allRunIds,groupId,session.tenantId,session.userId,session.tenantId,session.userId]);
   for(const row of files){const key=String(row.runId),items=filesByRun.get(key)||[];items.push({id:String(row.id),name:String(row.name),mimeType:String(row.mimeType),size:Number(row.size),sha256:String(row.sha256),kind:String(row.kind) as RunFile['kind']});filesByRun.set(key,items)}
  }
  const filesByMessage=new Map<string,RunFile[]>();
  if(rows.length){
   const messageIds=rows.map(row=>String(row.id));
   const [files]=await this.pool.execute<RowDataPacket[]>(`SELECT mf.message_id AS messageId,f.id,f.display_name AS name,f.mime_type AS mimeType,f.size,f.sha256
    FROM bot_group_message_files mf JOIN bot_group_chats g ON g.id=mf.group_id JOIN bot_files f ON f.id=mf.file_id JOIN bots b ON b.id=f.bot_id
    WHERE mf.group_id=? AND g.tenant_id=? AND g.owner_id=? AND b.tenant_id=? AND b.owner_id=?
      AND mf.message_id IN (${messageIds.map(()=>'?').join(',')}) ORDER BY mf.message_id,mf.position`,[groupId,session.tenantId,session.userId,session.tenantId,session.userId,...messageIds]);
   for(const row of files){const key=String(row.messageId),items=filesByMessage.get(key)||[];items.push({id:String(row.id),name:String(row.name),mimeType:String(row.mimeType),size:Number(row.size),sha256:String(row.sha256),kind:'input'});filesByMessage.set(key,items)}
  }
  const messages=rows.map(row=>({
   id:String(row.id),turnId:String(row.turnId),role:String(row.senderType) as 'user'|'bot',botId:row.botId==null?null:String(row.botId),botName:row.botName==null?null:String(row.botName),
   text:row.runId==null?(row.messageText==null?null:String(row.messageText)):row.result==null?null:String(row.result),targetBotIds:recipientsByTurn.get(String(row.turnId))||[],runId:row.runId==null?null:String(row.runId),
   status:row.status==null?null:String(row.status) as StoredGroupMessage['status'],recoveryState:row.recoveryState==null?null:String(row.recoveryState) as StoredGroupMessage['recoveryState'],
   replacementRunId:row.replacementRunId==null?null:String(row.replacementRunId),computerUsed:Boolean(row.computerUsed),updatedAt:row.updatedAt==null?null:String(row.updatedAt),diagnosticCode:isRunDiagnosticCode(row.diagnosticCode)?row.diagnosticCode:null,executionAudit:validateAgentExecutionAudit(row.executionAudit),
   files:row.runId==null?filesByMessage.get(String(row.id))||[]:filesByRun.get(String(row.runId))||[],
   replacementRun:row.replacementRunId==null||row.replacementStatus==null?null:{
    id:String(row.replacementRunId),status:String(row.replacementStatus) as StoredGroupReplacementRun['status'],result:row.replacementResult==null?null:String(row.replacementResult),
    computerUsed:Boolean(row.replacementComputerUsed),updatedAt:row.replacementUpdatedAt==null?null:String(row.replacementUpdatedAt),executionAudit:validateAgentExecutionAudit(row.replacementExecutionAudit),
    diagnosticCode:isRunDiagnosticCode(row.replacementDiagnosticCode)?row.replacementDiagnosticCode:null,files:filesByRun.get(String(row.replacementRunId))||[]
   }
  }));
  return{group,messages};
 }

 async visibleRunPrompts(session:Session,botId:string,runIds:string[]):Promise<Map<string,string>>{
  const prompts=new Map<string,string>();
  if(!uuid.test(botId)||!runIds.length||runIds.some(id=>!uuid.test(id)))return prompts;
  for(let offset=0;offset<runIds.length;offset+=100){
   const batch=runIds.slice(offset,offset+100);
   const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT target.id AS runId,t.prompt
    FROM agent_runs target JOIN bots b ON b.id=target.bot_id
    JOIN bot_group_messages m ON m.sender_bot_id=target.bot_id
    JOIN bot_group_turns t ON t.id=m.turn_id JOIN bot_group_chats g ON g.id=m.group_id
    WHERE target.id IN (${batch.map(()=>'?').join(',')}) AND target.bot_id=?
     AND g.tenant_id=? AND g.owner_id=? AND b.tenant_id=? AND b.owner_id=?
     AND (m.run_id=target.id OR EXISTS(SELECT 1 FROM agent_runs parent WHERE parent.id=m.run_id AND parent.replacement_run_id=target.id AND parent.bot_id=target.bot_id))`,[...batch,botId,session.tenantId,session.userId,session.tenantId,session.userId]);
   for(const row of rows)prompts.set(String(row.runId),String(row.prompt));
  }
  return prompts;
 }

 async sendMessage(session:Session,groupId:string,requestId:string,prompt:string,targetBotIds?:string[],fileIdsValue?:unknown):Promise<GroupChatView|null>{
  const clean=prompt.trim(),fileIds=WorkspaceFileStore.validateFileIds(fileIdsValue);
  if(!uuid.test(groupId)||!uuid.test(requestId)||(!clean&&!fileIds.length)||clean.length>8000||targetBotIds!==undefined&&(!Array.isArray(targetBotIds)||targetBotIds.length<1||targetBotIds.length>6||targetBotIds.some(id=>typeof id!=='string'||!uuid.test(id))||new Set(targetBotIds).size!==targetBotIds.length))throw new Error('Invalid group message');
  const storedPrompt=clean||'Please review the attached file(s).';
  const connection=await this.pool.getConnection();
  try{
   await connection.beginTransaction();
   const [groups]=await connection.execute<RowDataPacket[]>('SELECT id,name FROM bot_group_chats WHERE id=? AND tenant_id=? AND owner_id=? FOR UPDATE',[groupId,session.tenantId,session.userId]);
   if(!groups.length){await connection.rollback();return null;}
   const [members]=await connection.execute<RowDataPacket[]>(`SELECT b.id,b.name,b.label FROM bot_group_members m JOIN bots b ON b.id=m.bot_id JOIN bot_group_chats g ON g.id=m.group_id
    WHERE m.group_id=? AND g.tenant_id=? AND g.owner_id=? AND b.tenant_id=? AND b.owner_id=? ORDER BY m.position FOR UPDATE`,[groupId,session.tenantId,session.userId,session.tenantId,session.userId]);
   if(members.length<2||members.length>6){await connection.rollback();return null;}
   const sourceBotId=String(members[0].id);
   let sourceFiles:Array<RunFile&{storageKey:string}>=[];
   if(fileIds.length){
    const [rows]=await connection.execute<RowDataPacket[]>(`SELECT f.id,f.bot_id AS botId,f.display_name AS name,f.mime_type AS mimeType,f.size,f.sha256,f.storage_key AS storageKey
     FROM bot_group_files gf JOIN bot_files f ON f.id=gf.file_id JOIN bots b ON b.id=f.bot_id
     WHERE gf.group_id=? AND f.bot_id=? AND b.tenant_id=? AND b.owner_id=? AND f.id IN (${fileIds.map(()=>'?').join(',')})
     ORDER BY FIELD(f.id,${fileIds.map(()=>'?').join(',')}) FOR UPDATE`,[groupId,sourceBotId,session.tenantId,session.userId,...fileIds,...fileIds]);
    sourceFiles=WorkspaceFileStore.validateInputRows(rows,fileIds).map(file=>({...file,storageKey:file.storageKey!}));
   }
   const requested=targetBotIds===undefined?null:new Set(targetBotIds),recipients=members.map(row=>String(row.id)).filter(id=>requested===null||requested.has(id));
   if(!recipients.length||requested!==null&&recipients.length!==requested.size){await connection.rollback();return null;}
   const [existing]=await connection.execute<RowDataPacket[]>('SELECT id,prompt FROM bot_group_turns WHERE group_id=? AND request_id=? FOR UPDATE',[groupId,requestId]);
   if(existing.length){
    if(String(existing[0].prompt)!==storedPrompt)throw new GroupRequestConflict('Group message request ID already used with different content');
    const [existingRecipients]=await connection.execute<RowDataPacket[]>('SELECT sender_bot_id AS botId FROM bot_group_messages WHERE turn_id=? AND sender_type=\'bot\' ORDER BY sequence',[String(existing[0].id)]);
    if(existingRecipients.map(row=>String(row.botId)).join(',')!==recipients.join(','))throw new GroupRequestConflict('Group message request ID already used with different recipients');
    const [existingFiles]=await connection.execute<RowDataPacket[]>('SELECT file_id AS fileId FROM bot_group_message_files WHERE message_id=(SELECT id FROM bot_group_messages WHERE turn_id=? AND sender_type=\'user\' LIMIT 1) ORDER BY position',[String(existing[0].id)]);
    if(existingFiles.map(row=>String(row.fileId)).join(',')!==fileIds.join(','))throw new GroupRequestConflict('Group message request ID already used with different files');
    await connection.commit();return this.get(session,groupId);
   }
   const turnId=randomUUID(),userMessageId=randomUUID();
   await connection.execute('INSERT INTO bot_group_turns (id,group_id,request_id,prompt) VALUES (?,?,?,?)',[turnId,groupId,requestId,storedPrompt]);
   await connection.execute("INSERT INTO bot_group_messages (id,group_id,turn_id,sender_type,message_text) VALUES (?,?,?,'user',?)",[userMessageId,groupId,turnId,clean||null]);
   for(const [position,file] of sourceFiles.entries())await connection.execute('INSERT INTO bot_group_message_files (message_id,group_id,file_id,position) VALUES (?,?,?,?)',[userMessageId,groupId,file.id,position]);
   for(const member of members.filter(row=>recipients.includes(String(row.id)))){
    const botId=String(member.id),runId=randomUUID(),runRequestId=randomUUID();
    const context={kind:'group-chat',groupName:String(groups[0].name),currentBot:{name:String(member.name),label:String(member.label||'')},members:members.map(row=>({name:String(row.name),label:String(row.label||'')})),targeted:requested!==null};
    const runFileIds:string[]=[];
    for(const source of sourceFiles){
     const [existingFiles]=await connection.execute<RowDataPacket[]>('SELECT id,display_name AS name,mime_type AS mimeType,size,sha256,storage_key AS storageKey FROM bot_files WHERE bot_id=? AND storage_key=? FOR UPDATE',[botId,source.storageKey]);
     let recipientFileId:string;
     if(existingFiles.length){
      const existingFile=existingFiles[0];
      if(String(existingFile.name)!==source.name||String(existingFile.mimeType)!==source.mimeType||Number(existingFile.size)!==source.size||String(existingFile.sha256)!==source.sha256)throw new Error('Attachment metadata conflict');
      recipientFileId=String(existingFile.id);
     }else{
      recipientFileId=randomUUID();
      await connection.execute('INSERT INTO bot_files (id,bot_id,display_name,mime_type,size,sha256,storage_key) VALUES (?,?,?,?,?,?,?)',[recipientFileId,botId,source.name,source.mimeType,source.size,source.sha256,source.storageKey]);
     }
     runFileIds.push(recipientFileId);
    }
    const attachmentHash=createHash('sha256').update(JSON.stringify([...runFileIds].sort())).digest('hex');
    await connection.execute("INSERT INTO agent_runs (id,bot_id,request_id,prompt,status,recovery_state,attachment_hash,runtime_context) VALUES (?,?,?,?,'queued','none',?,?)",[runId,botId,runRequestId,storedPrompt,attachmentHash,JSON.stringify(context)]);
    for(const fileId of runFileIds)await connection.execute("INSERT INTO agent_run_files (run_id,file_id,kind) VALUES (?,?,'input')",[runId,fileId]);
    await connection.execute("INSERT INTO agent_run_events (run_id,status) VALUES (?,'queued')",[runId]);
    await connection.execute("INSERT INTO bot_group_messages (id,group_id,turn_id,sender_type,sender_bot_id,run_id) VALUES (?,?,?,'bot',?,?)",[randomUUID(),groupId,turnId,botId,runId]);
   }
   await connection.execute('UPDATE bot_group_chats SET updated_at=CURRENT_TIMESTAMP(3) WHERE id=?',[groupId]);
   await connection.commit();
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
  return this.get(session,groupId);
 }

 private async memberIds(connection:PoolConnection,groupId:string):Promise<string[]>{
  const [rows]=await connection.execute<RowDataPacket[]>('SELECT bot_id AS botId FROM bot_group_members WHERE group_id=? ORDER BY position',[groupId]);
  return rows.map(row=>String(row.botId));
 }
}
