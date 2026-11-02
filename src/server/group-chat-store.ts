import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolConnection,RowDataPacket} from 'mysql2/promise';
import type {Session} from './tenant-store.ts';
import type {BotShape} from './bot-store.ts';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class GroupRequestConflict extends Error {}

export interface GroupMember {id:string;name:string;label:string;color:string;shape:BotShape;position:number}
export interface StoredGroup {id:string;name:string;members:GroupMember[];preview:string;lastActivityAt:string|null}
export interface StoredGroupMessage {
 id:string;turnId:string;role:'user'|'bot';botId:string|null;botName:string|null;text:string|null;
 runId:string|null;status:'queued'|'running'|'completed'|'failed'|'unknown'|null;
 recoveryState:'none'|'pending'|'retried'|'acknowledged'|null;replacementRunId:string|null;computerUsed:boolean;updatedAt:string|null;
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
    COALESCE(NULLIF(LEFT(TRIM(COALESCE(r.result,m.message_text,'')),180),''),CASE r.status WHEN 'running' THEN 'Working…' WHEN 'queued' THEN 'Queued' WHEN 'unknown' THEN 'Outcome unknown' WHEN 'failed' THEN 'Failed' ELSE 'Start a conversation' END) AS preview,
    DATE_FORMAT(GREATEST(g.updated_at,COALESCE(r.updated_at,g.updated_at)),'%Y-%m-%dT%H:%i:%s.%fZ') AS lastActivityAt
   FROM bot_group_chats g
   LEFT JOIN bot_group_messages m ON m.sequence=(SELECT MAX(last.sequence) FROM bot_group_messages last WHERE last.group_id=g.id)
   LEFT JOIN agent_runs r ON r.id=m.run_id
   WHERE g.tenant_id=? AND g.owner_id=? ORDER BY GREATEST(g.updated_at,COALESCE(r.updated_at,g.updated_at)) DESC,g.created_at DESC`,[session.tenantId,session.userId]);
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
    r.computer_used AS computerUsed,DATE_FORMAT(r.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt
   FROM bot_group_messages m LEFT JOIN bots b ON b.id=m.sender_bot_id LEFT JOIN agent_runs r ON r.id=m.run_id
   WHERE m.group_id=? ORDER BY m.sequence`,[groupId]);
  const messages=rows.map(row=>({
   id:String(row.id),turnId:String(row.turnId),role:String(row.senderType) as 'user'|'bot',botId:row.botId==null?null:String(row.botId),botName:row.botName==null?null:String(row.botName),
   text:row.runId==null?(row.messageText==null?null:String(row.messageText)):row.result==null?null:String(row.result),runId:row.runId==null?null:String(row.runId),
   status:row.status==null?null:String(row.status) as StoredGroupMessage['status'],recoveryState:row.recoveryState==null?null:String(row.recoveryState) as StoredGroupMessage['recoveryState'],
   replacementRunId:row.replacementRunId==null?null:String(row.replacementRunId),computerUsed:Boolean(row.computerUsed),updatedAt:row.updatedAt==null?null:String(row.updatedAt)
  }));
  return{group,messages};
 }

 async sendMessage(session:Session,groupId:string,requestId:string,prompt:string):Promise<GroupChatView|null>{
  const clean=prompt.trim();if(!uuid.test(groupId)||!uuid.test(requestId)||!clean||clean.length>8000)throw new Error('Invalid group message');
  const connection=await this.pool.getConnection();
  try{
   await connection.beginTransaction();
   const [groups]=await connection.execute<RowDataPacket[]>('SELECT id,name FROM bot_group_chats WHERE id=? AND tenant_id=? AND owner_id=? FOR UPDATE',[groupId,session.tenantId,session.userId]);
   if(!groups.length){await connection.rollback();return null;}
   const [existing]=await connection.execute<RowDataPacket[]>('SELECT id,prompt FROM bot_group_turns WHERE group_id=? AND request_id=? FOR UPDATE',[groupId,requestId]);
   if(existing.length){if(String(existing[0].prompt)!==clean)throw new GroupRequestConflict('Group message request ID already used with different content');await connection.commit();return this.get(session,groupId)}
   const [members]=await connection.execute<RowDataPacket[]>(`SELECT b.id,b.name,b.label FROM bot_group_members m JOIN bots b ON b.id=m.bot_id JOIN bot_group_chats g ON g.id=m.group_id
    WHERE m.group_id=? AND g.tenant_id=? AND g.owner_id=? AND b.tenant_id=? AND b.owner_id=? ORDER BY m.position FOR UPDATE`,[groupId,session.tenantId,session.userId,session.tenantId,session.userId]);
   if(members.length<2||members.length>6){await connection.rollback();return null;}
   const turnId=randomUUID(),userMessageId=randomUUID();
   await connection.execute('INSERT INTO bot_group_turns (id,group_id,request_id,prompt) VALUES (?,?,?,?)',[turnId,groupId,requestId,clean]);
   await connection.execute("INSERT INTO bot_group_messages (id,group_id,turn_id,sender_type,message_text) VALUES (?,?,?,'user',?)",[userMessageId,groupId,turnId,clean]);
   const memberNames=members.map(row=>`${String(row.name)}${row.label?` (${String(row.label)})`:''}`).join(', ');
   const emptyFilesHash=createHash('sha256').update('[]').digest('hex');
   for(const member of members){
    const botId=String(member.id),runId=randomUUID(),runRequestId=randomUUID();
    const label=String(member.label||'');
    const runPrompt=`You are ${String(member.name)}${label?`, focused on ${label}`:''}, a Bot in the group chat “${String(groups[0].name)}”. Group members: ${memberNames}. The user posted this task to the group:\n\n${clean}\n\nReply as this Bot in a concise, useful way. Work only on your own response; do not claim another Bot performed work. If the task needs another member, name that Bot and describe the handoff needed.`;
    await connection.execute("INSERT INTO agent_runs (id,bot_id,request_id,prompt,status,recovery_state,attachment_hash) VALUES (?,?,?,?,'queued','none',?)",[runId,botId,runRequestId,runPrompt,emptyFilesHash]);
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
