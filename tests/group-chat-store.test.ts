import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {Readable} from 'node:stream';
import type {IncomingMessage} from 'node:http';
import mysql from 'mysql2/promise';
import {TenantStore} from '../src/server/tenant-store.ts';
import {BotStore} from '../src/server/bot-store.ts';
import {RunStore,type GroupRunContext} from '../src/server/run-store.ts';
import {RunScheduler} from '../src/server/run-scheduler.ts';
import {GroupChatStore} from '../src/server/group-chat-store.ts';
import {WorkspaceFileStore} from '../src/server/file-store.ts';
import type {WorkspaceFileTransportApi} from '../src/server/workspace-file-client.ts';
import {GoogleAuthService,type IdentityProvider} from '../src/server/google-auth.ts';
import {createAuthServer} from '../src/server/auth-http.ts';

const port=Number(process.env.COKE_GROK_TEST_MYSQL_PORT);
if(!port)throw new Error('Set COKE_GROK_TEST_MYSQL_PORT to a disposable local MySQL instance.');

test('group chats persist six Bot memberships, authorized input files, isolated runs, and Bot result-file metadata',async()=>{
 const database=`grok_groups_${randomUUID().replaceAll('-','')}`;
 const admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});
 await admin.query(`CREATE DATABASE \`${database}\``);
 const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database,timezone:'Z',connectionLimit:12});
 const identities=new TenantStore(pool),bots=new BotStore(pool),runs=new RunStore(pool),groups=new GroupChatStore(pool),files=new WorkspaceFileStore(pool);
 await identities.migrate();await bots.migrate();await runs.migrate();await groups.migrate();await groups.migrate();
 const uploadedBytes=new Map<string,Buffer>();
 const workspaceFiles:WorkspaceFileTransportApi={
  upload:async(_owner,input)=>{const chunks:Buffer[]=[];for await(const chunk of input.body)chunks.push(Buffer.from(chunk));const bytes=Buffer.concat(chunks);if(bytes.length!==input.size)throw new Error('upload size mismatch');const storageKey=`shared/uploads/${input.id}${input.extension?`.${input.extension}`:''}`;uploadedBytes.set(storageKey,bytes);return{size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}},
  download:async(_owner,storageKey)=>{const bytes=uploadedBytes.get(storageKey);if(!bytes)throw new Error('missing upload');return{body:Readable.from([bytes]) as IncomingMessage,size:bytes.length}},
  removeUpload:async(_owner,id,extension)=>{uploadedBytes.delete(`shared/uploads/${id}${extension?`.${extension}`:''}`)}
 };
 const net=await import('node:net'),reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
 const httpPort=(reservation.address() as import('node:net').AddressInfo).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 const origin=`http://127.0.0.1:${httpPort}`,base=origin+'/grok-bot';
 const provider:IdentityProvider={authorizationUrl:()=>'',exchange:async()=>({})};
 const backend=createAuthServer(new GoogleAuthService(identities,provider,base),base,undefined,bots,runs,undefined,undefined,'pi',files,workspaceFiles,groups);
 backend.listen(httpPort,'127.0.0.1');await once(backend,'listening');
 const login=async(subject:string)=>{
  const identity=await identities.signInGoogle({subject,email:`${subject}@example.test`,name:subject});
  const token=randomBytes(32).toString('base64url');
  await identities.createSession(createHash('sha256').update(token).digest('hex'),identity.userId,identity.tenantId,new Date(Date.now()+60000));
  return{identity,cookie:`coke_grok_session=${token}`};
 };
 const observedInputFiles=new Map<string,number>();
 const observedContexts=new Map<string,GroupRunContext|null|undefined>();
 const scheduler=new RunScheduler(runs,{execute:async(_screen,run)=>{
  observedInputFiles.set(run.botId,run.files.filter(file=>file.kind==='input').length);
  observedContexts.set(run.botId,run.runtimeContext);
  const result=`${run.prompt.split('\n')[0]} replied from its own queued run.`;
  const executionAudit={engine:'pi',model:'deepseek-v4.1-flash',modelCompleted:true,calls:[],truncated:false};
  if(run.runtimeContext?.currentBot.name==='Chief'){
   const bytes=Buffer.from('A safe offsite idea.');
   return{status:'completed',result,executionAudit,artifacts:[{name:'offsite-idea.txt',mimeType:'text/plain',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),storageKey:`tasks/${run.id}/artifacts/offsite-idea.txt`}]};
  }
  return{status:'completed',result,executionAudit};
 }},{concurrency:2,leaseSeconds:10});
 try{
  const alice=await login('group-owner'),bob=await login('other-owner');
  const aliceSession={...alice.identity,email:'group-owner@example.test',name:'Group owner',role:'owner' as const};
  const bobSession={...bob.identity,email:'other-owner@example.test',name:'Other owner',role:'owner' as const};
  const members=[];
  for(let index=0;index<6;index++){
   const member=await bots.create(aliceSession,{name:['Chief','Sales Outbound','Inbox Manager','Account Manager','Talent Scout','Expense Manager'][index],shape:'round',color:'#abcdef'});
   await bots.setLabel(aliceSession,member.id,`Role ${index+1}`);
   members.push(member);
  }
  const foreign=await bots.create(bobSession,{name:'Private Bot',shape:'round',color:'#abcdef'});
  const request=(path:string,cookie='',init:RequestInit={})=>fetch(`${base}${path}`,{...init,headers:{cookie,...init.headers}});
  assert.equal((await request('/api/groups')).status,401);
  const groupRequestId=randomUUID(),payload=JSON.stringify({requestId:groupRequestId,name:'Offsite crew',botIds:members.map(bot=>bot.id)});
  assert.equal((await request('/api/groups',alice.cookie,{method:'POST',headers:{origin:'https://attacker.example','content-type':'application/json'},body:payload})).status,403);
  assert.equal((await request('/api/groups',alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),name:'Private mix',botIds:[members[0].id,foreign.id]})})).status,404);
  assert.equal((await request('/api/groups',alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),name:'Too small',botIds:[members[0].id]})})).status,400);
  const create=await request('/api/groups',alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:payload});
  assert.equal(create.status,201);
  const group=(await create.json() as {group:{id:string;name:string;members:{id:string}[]}}).group;
  assert.equal(group.name,'Offsite crew');assert.equal(group.members.length,6);
  const replay=await request('/api/groups',alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:payload});
  assert.equal((await replay.json() as {group:{id:string}}).group.id,group.id);
  assert.equal((await request('/api/groups',alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:groupRequestId,name:'Changed',botIds:members.map(bot=>bot.id)})})).status,409);
  assert.equal((await request(`/api/groups/${group.id}`,bob.cookie)).status,404);
  assert.equal((await request('/api/groups',bob.cookie)).status,200);
  assert.deepEqual((await (await request('/api/groups',bob.cookie)).json() as {groups:unknown[]}).groups,[]);
  const attachmentBytes=Buffer.from('Safe source notes for the offsite.');
  const blockedUpload=await request(`/api/groups/${group.id}/files`,alice.cookie,{method:'POST',headers:{origin:'https://attacker.example','content-type':'text/plain','content-length':String(attachmentBytes.length),'x-file-name':encodeURIComponent('blocked.txt')},body:attachmentBytes});
  assert.equal(blockedUpload.status,403);
  const uploadResponse=await request(`/api/groups/${group.id}/files`,alice.cookie,{method:'POST',headers:{origin,'content-type':'text/plain','content-length':String(attachmentBytes.length),'x-file-name':encodeURIComponent('offsite-notes.txt')},body:attachmentBytes});
  assert.equal(uploadResponse.status,201);
  const uploaded=(await uploadResponse.json() as {file:{id:string;name:string;size:number;sha256:string}}).file;
  assert.equal(uploaded.name,'offsite-notes.txt');assert.equal(uploaded.size,attachmentBytes.length);assert.equal(uploaded.sha256,createHash('sha256').update(attachmentBytes).digest('hex'));
  const [uploadOwners]=await pool.execute<mysql.RowDataPacket[]>('SELECT bot_id AS botId FROM bot_files WHERE id=?',[uploaded.id]);
  assert.equal(String(uploadOwners[0].botId),members[0].id);
  const foreignUpload=await request(`/api/groups/${group.id}/files`,bob.cookie,{method:'POST',headers:{origin,'content-type':'text/plain','content-length':String(attachmentBytes.length),'x-file-name':encodeURIComponent('private.txt')},body:attachmentBytes});
  assert.equal(foreignUpload.status,404);
  const download=await request(`/api/files/${uploaded.id}`,alice.cookie);
  assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),attachmentBytes);
  const foreignDownload=await request(`/api/files/${uploaded.id}`,bob.cookie);
  assert.equal(foreignDownload.status,404);
  const otherBotFileBytes=Buffer.from('A file staged outside this group.');
  const otherBotFileResponse=await request(`/api/bots/${members[3].id}/files`,alice.cookie,{method:'POST',headers:{origin,'content-type':'text/plain','content-length':String(otherBotFileBytes.length),'x-file-name':encodeURIComponent('other-bot.txt')},body:otherBotFileBytes});
  assert.equal(otherBotFileResponse.status,201);
  const otherBotFile=(await otherBotFileResponse.json() as {file:{id:string}}).file;
  const rejectedFileSend=await request(`/api/groups/${group.id}/messages`,alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),text:'Review this file',files:[otherBotFile.id]})});
  assert.equal(rejectedFileSend.status,400);
  const turnRequestId=randomUUID(),text='Each Bot: give one concise, role-specific idea for a safe offsite. Do not use a computer or contact anyone.';
  const sendPayload={requestId:turnRequestId,text,files:[uploaded.id]};
  const send=await request(`/api/groups/${group.id}/messages`,alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(sendPayload)});
  assert.equal(send.status,202);
  const view=(await send.json() as {group:{id:string};messages:{role:string;botId:string|null;runId:string|null;status:string|null;files?:{id:string;kind:string}[]}[]});
  assert.equal(view.messages.length,7);assert.equal(view.messages[0].role,'user');
  assert.deepEqual(view.messages[0].files?.map(file=>({id:file.id,kind:file.kind})),[{id:uploaded.id,kind:'input'}]);
  const botMessages=view.messages.filter(message=>message.role==='bot');assert.equal(botMessages.length,6);
  assert.equal(new Set(botMessages.map(message=>message.botId)).size,6);
  assert.ok(botMessages.every(message=>message.runId&&message.status==='queued'));
  const duplicate=await request(`/api/groups/${group.id}/messages`,alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(sendPayload)});
  assert.equal((await duplicate.json() as typeof view).messages.filter(message=>message.role==='bot').length,6);
  assert.equal((await request(`/api/groups/${group.id}/messages`,alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:turnRequestId,text})})).status,409);
  assert.equal((await request(`/api/groups/${group.id}/messages`,bob.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),text})})).status,404);
  assert.equal((await request(`/api/groups/${group.id}/messages`,alice.cookie,{method:'POST',headers:{origin:'https://attacker.example','content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),text})})).status,403);
  assert.equal((await request(`/api/groups/${group.id}/messages`,alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:turnRequestId,text:'Different content'})})).status,409);
  const runIds=botMessages.map(message=>message.runId!);
  for(let attempt=0;attempt<100;attempt++){
   await scheduler.tick();
   const persisted=await groups.get(aliceSession,group.id);
   if(persisted?.messages.filter(message=>message.role==='bot'&&message.status==='completed').length===6)break;
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  await scheduler.stop();
  const completed=await groups.get(aliceSession,group.id);
  assert.equal(completed?.messages.filter(message=>message.role==='bot'&&message.status==='completed').length,6);
  assert.equal(new Set(completed?.messages.filter(message=>message.role==='bot').map(message=>message.runId)).size,6);
  const chiefMessage=completed?.messages.find(message=>message.botId===members[0].id);
  assert.deepEqual(chiefMessage?.executionAudit,{engine:'pi',model:'deepseek-v4.1-flash',modelCompleted:true,calls:[],truncated:false});
  assert.deepEqual(chiefMessage?.files.map(file=>({name:file.name,mimeType:file.mimeType,size:file.size,kind:file.kind})),[
   {name:'offsite-notes.txt',mimeType:'text/plain',size:attachmentBytes.length,kind:'input'},
   {name:'offsite-idea.txt',mimeType:'text/plain',size:Buffer.byteLength('A safe offsite idea.'),kind:'output'}
  ]);
  assert.ok(completed?.messages.filter(message=>message.botId!==members[0].id).every(message=>message.files.length===1&&message.files[0].kind==='input'));
  const historyResponse=await request(`/api/groups/${group.id}`,alice.cookie);
  assert.equal(historyResponse.status,200);
  const history=await historyResponse.json() as {messages:{role:string;botId:string|null;files:{id:string;name:string;kind:string}[];executionAudit?:{engine:string;model:string;modelCompleted:boolean;calls:unknown[];truncated:boolean}|null}[]};
  assert.deepEqual(history.messages.find(message=>message.role==='user')?.files.map(file=>({id:file.id,name:file.name,kind:file.kind})),[{id:uploaded.id,name:'offsite-notes.txt',kind:'input'}]);
  assert.deepEqual(history.messages.find(message=>message.botId===members[0].id)?.files.map(file=>({name:file.name,kind:file.kind})),[{name:'offsite-notes.txt',kind:'input'},{name:'offsite-idea.txt',kind:'output'}]);
  assert.deepEqual(history.messages.find(message=>message.botId===members[0].id)?.executionAudit,{engine:'pi',model:'deepseek-v4.1-flash',modelCompleted:true,calls:[],truncated:false});
  assert.ok(members.every(member=>observedInputFiles.get(member.id)===1));
  const [recipientFiles]=await pool.execute<mysql.RowDataPacket[]>(`SELECT r.bot_id AS botId,f.id,f.storage_key AS storageKey,rf.kind
   FROM agent_run_files rf JOIN agent_runs r ON r.id=rf.run_id JOIN bot_files f ON f.id=rf.file_id
   WHERE r.id IN (${runIds.map(()=>'?').join(',')}) AND rf.kind='input'`,runIds);
  assert.equal(recipientFiles.length,6);assert.equal(new Set(recipientFiles.map(row=>String(row.botId))).size,6);
  assert.ok(recipientFiles.every(row=>String(row.storageKey)===`shared/uploads/${uploaded.id}.txt`));
  const targetedRequestId=randomUUID(),targetedBotId=members[1].id,targetedText='@Sales Outbound, give one concise sales idea.';
  const targetedPayload={requestId:targetedRequestId,text:targetedText,targetBotIds:[targetedBotId],files:[uploaded.id]};
  const targetedResponse=await request(`/api/groups/${group.id}/messages`,alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(targetedPayload)});
  assert.equal(targetedResponse.status,202);
  const targetedView=await targetedResponse.json() as {messages:{id:string;turnId:string;role:string;botId:string|null;runId:string|null;status:string|null;targetBotIds?:string[];files?:{id:string;kind:string}[]}[]};
  const targetedUser=targetedView.messages.find(message=>message.role==='user'&&message.id!==view.messages[0].id);
  assert.ok(targetedUser);
  assert.deepEqual(targetedUser.targetBotIds,[targetedBotId]);
  const targetedBotMessages=targetedView.messages.filter(message=>message.turnId===targetedUser.turnId&&message.role==='bot');
  assert.equal(targetedBotMessages.length,1);
  assert.equal(targetedBotMessages[0].botId,targetedBotId);
  assert.equal(targetedBotMessages[0].status,'queued');
  const targetedInput=(targetedView.messages.find(message=>message.id===targetedUser.id)?.files||[]).map(file=>({id:file.id,kind:file.kind}));
  assert.deepEqual(targetedInput,[{id:uploaded.id,kind:'input'}]);
  const targetedReplay=await request(`/api/groups/${group.id}/messages`,alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(targetedPayload)});
  assert.equal(targetedReplay.status,202);
  const replayedTargetedView=await targetedReplay.json() as typeof targetedView;
  assert.equal(replayedTargetedView.messages.filter(message=>message.turnId===targetedUser.turnId&&message.role==='bot').length,1);
  assert.equal((await request(`/api/groups/${group.id}/messages`,alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({...targetedPayload,targetBotIds:[members[0].id]})})).status,409);
  assert.equal((await request(`/api/groups/${group.id}/messages`,alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({...targetedPayload,requestId:randomUUID(),targetBotIds:[foreign.id]})})).status,404);
  const targetedRunId=targetedBotMessages[0].runId;
  assert.ok(targetedRunId);
  const [targetedRunRows]=await pool.execute<mysql.RowDataPacket[]>('SELECT prompt,runtime_context AS runtimeContext,status FROM agent_runs WHERE id=?',[targetedRunId]);
  assert.equal(targetedRunRows[0].status,'queued');
  assert.equal(String(targetedRunRows[0].prompt),targetedText);
  assert.deepEqual(JSON.parse(String(targetedRunRows[0].runtimeContext)),{kind:'group-chat',groupName:'Offsite crew',currentBot:{name:'Sales Outbound',label:'Role 2'},members:members.map((member,index)=>({name:['Chief','Sales Outbound','Inbox Manager','Account Manager','Talent Scout','Expense Manager'][index],label:`Role ${index+1}`})),targeted:true});
  const [targetedFiles]=await pool.execute<mysql.RowDataPacket[]>('SELECT b.id AS botId,f.storage_key AS storageKey,rf.kind FROM agent_run_files rf JOIN agent_runs r ON r.id=rf.run_id JOIN bots b ON b.id=r.bot_id JOIN bot_files f ON f.id=rf.file_id WHERE r.id=?',[targetedRunId]);
  assert.equal(targetedFiles.length,1);assert.equal(String(targetedFiles[0].botId),targetedBotId);assert.equal(String(targetedFiles[0].storageKey),`shared/uploads/${uploaded.id}.txt`);assert.equal(String(targetedFiles[0].kind),'input');
  const attachmentOnlyRequest=randomUUID(),attachmentOnly=await request(`/api/groups/${group.id}/messages`,alice.cookie,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:attachmentOnlyRequest,text:'',targetBotIds:[members[2].id],files:[uploaded.id]})});
  assert.equal(attachmentOnly.status,202);
  const attachmentOnlyView=await attachmentOnly.json() as {messages:{turnId:string;role:string;botId:string|null;text:string|null;runId:string|null;status:string|null}[]};
  const attachmentOnlyUser=attachmentOnlyView.messages.find(message=>message.role==='user'&&message.turnId!==targetedUser.turnId&&message.turnId!==view.messages[0]!.turnId);
  assert.ok(attachmentOnlyUser);assert.equal(attachmentOnlyUser.text,null);
  const attachmentOnlyBot=attachmentOnlyView.messages.find(message=>message.turnId===attachmentOnlyUser.turnId&&message.role==='bot');
  assert.equal(attachmentOnlyBot?.botId,members[2].id);assert.equal(attachmentOnlyBot?.status,'queued');assert.ok(attachmentOnlyBot?.runId);
  for(const runId of runIds){
   const [rows]=await pool.execute<mysql.RowDataPacket[]>('SELECT status,result,prompt,runtime_context AS runtimeContext FROM agent_runs WHERE id=?',[runId]);
   assert.equal(rows[0].status,'completed');assert.equal(String(rows[0].prompt),text);assert.ok(String(rows[0].result).endsWith('replied from its own queued run.'));
   assert.equal(JSON.parse(String(rows[0].runtimeContext)).kind,'group-chat');
  }
  assert.equal(observedContexts.get(members[0].id)?.currentBot.name,'Chief');
  assert.equal((await runs.list(aliceSession,members[0].id))?.some(run=>'runtimeContext' in run),false,'private group runtime metadata is not exposed by Bot history');
  const [turnRows]=await pool.execute<mysql.RowDataPacket[]>('SELECT COUNT(*) AS count FROM bot_group_turns WHERE group_id=?',[group.id]);
  assert.equal(Number(turnRows[0].count),3);
  await pool.execute("UPDATE agent_runs SET status='unknown',recovery_state='pending' WHERE id=?",[runIds[0]]);
  await pool.execute("INSERT INTO agent_run_events (run_id,status,detail) VALUES (?,'unknown','diagnostic:agent_paused_for_control')",[runIds[0]]);
  assert.equal((await groups.get(aliceSession,group.id))?.messages.find(message=>message.runId===runIds[0])?.diagnosticCode,'agent_paused_for_control');
  const retried=await runs.resolveUnknown(aliceSession,runIds[0],'retry');assert.ok(retried?.run);
  await pool.execute("UPDATE agent_runs SET status='failed',result='Separate retry failed after computer approval expired.',computer_used=TRUE WHERE id=?",[retried.run.id]);
  const retryFileId=randomUUID(),retryBytes=Buffer.from('retry artifact'),retryHash=createHash('sha256').update(retryBytes).digest('hex'),retryKey=`tasks/${retried.run.id}/artifacts/retry.txt`;
  await pool.execute('INSERT INTO bot_files (id,bot_id,display_name,mime_type,size,sha256,storage_key) VALUES (?,?,?,?,?,?,?)',[retryFileId,members[0].id,'retry.txt','text/plain',retryBytes.length,retryHash,retryKey]);
  await pool.execute("INSERT INTO agent_run_files (run_id,file_id,kind) VALUES (?,?,'output')",[retried.run.id,retryFileId]);
  const afterRetry=await groups.get(aliceSession,group.id),originalAfterRetry=afterRetry?.messages.find(message=>message.runId===runIds[0]);
  assert.equal(originalAfterRetry?.status,'unknown');assert.equal(originalAfterRetry?.recoveryState,'retried');
  assert.equal(originalAfterRetry?.replacementRun?.id,retried.run.id);assert.equal(originalAfterRetry?.replacementRun?.status,'failed');
  assert.equal(originalAfterRetry?.replacementRun?.result,'Separate retry failed after computer approval expired.');
  assert.equal(originalAfterRetry?.replacementRun?.computerUsed,true);
  assert.deepEqual(originalAfterRetry?.replacementRun?.files.map(file=>({name:file.name,kind:file.kind})),[{name:'offsite-notes.txt',kind:'input'},{name:'retry.txt',kind:'output'}]);
  const [retryContextRows]=await pool.execute<mysql.RowDataPacket[]>('SELECT runtime_context AS runtimeContext FROM agent_runs WHERE id=?',[retried.run.id]);
  const [originalContextRows]=await pool.execute<mysql.RowDataPacket[]>('SELECT runtime_context AS runtimeContext FROM agent_runs WHERE id=?',[runIds[0]]);
  assert.equal(String(retryContextRows[0].runtimeContext),String(originalContextRows[0].runtimeContext));
  await pool.execute('UPDATE agent_runs SET prompt=? WHERE id=?',[`You are Chief, a Bot in the group chat “Offsite crew”. Group members: ${members.map(member=>member.name).join(', ')}. The user posted this task to the group:\n\n${text}\n\nReply as this Bot.`,runIds[0]]);
  const legacyHistoryResponse=await request(`/api/bots/${members[0].id}/runs`,alice.cookie);
  assert.equal(legacyHistoryResponse.status,200);
  const legacyHistory=await legacyHistoryResponse.json() as {runs:{id:string;prompt:string}[]};
  const legacyRun=legacyHistory.runs.find(run=>run.id===runIds[0]);
  assert.equal(legacyRun?.prompt,text,'legacy group orchestration is hidden from single-Bot chat history');
 }finally{
  await scheduler.stop();await new Promise<void>(resolve=>backend.close(()=>resolve()));await pool.end();await admin.query(`DROP DATABASE \`${database}\``);await admin.end();
 }
});
