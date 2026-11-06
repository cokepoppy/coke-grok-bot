import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GoogleAuthService } from './google-auth.ts';
import type { BotStore, BotShape } from './bot-store.ts';
import { RunRecoveryConflict, RunRequestConflict, type RunStore } from './run-store.ts';
import type { ApprovalStore } from './approval-store.ts';
import {parseUserAction,type UserComputer} from './user-computer.ts';
import { parsePublicUrl } from './public-url.ts';
import { cleanUploadName, uploadExtension, WorkspaceFileStore, validateUploadSize } from './file-store.ts';
import { WorkspaceFileTransportError, type WorkspaceFileTransportApi } from './workspace-file-client.ts';
import {safeDiagnosticMetadata} from './safe-diagnostics.ts';
import {GroupRequestConflict,type GroupChatStore} from './group-chat-store.ts';
import {RoutineRequestConflict,type RoutineStore,type RoutineSchedule} from './routine-store.ts';

function validatedNovncAsset(value:string):string|null{
 let path:string;try{path=decodeURIComponent(value)}catch{return null}
 if(!path||path.length>512||path.startsWith('/')||path.includes('\\')||!/[.](?:html|js|mjs|css|svg|png|ico|json|wasm|woff2?|ttf)$/i.test(path))return null;
 if(!/^[A-Za-z0-9_./-]+$/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..'))return null;
 return path;
}

function proxyNovncAsset(endpoint:URL,asset:string,req:IncomingMessage,res:ServerResponse):Promise<void>{
 return new Promise(resolve=>{
  const target=new URL(asset,endpoint);
  const upstream=httpRequest(target,{method:req.method==='HEAD'?'HEAD':'GET',headers:{accept:typeof req.headers.accept==='string'?req.headers.accept:'*/*'},timeout:15_000},response=>{
   const headers:Record<string,string>={'x-content-type-options':'nosniff','cache-control':'private, max-age=300'};
   for(const name of ['content-type','content-length','content-encoding','etag','last-modified'] as const){const value=response.headers[name];if(typeof value==='string')headers[name]=value}
   res.writeHead(response.statusCode||502,headers);response.pipe(res);response.once('end',resolve);response.once('error',resolve);
  });
  upstream.once('timeout',()=>upstream.destroy(new Error('noVNC asset request timed out')));
  upstream.once('error',()=>{if(!res.headersSent)res.writeHead(502,{'Cache-Control':'no-store'});res.end();resolve()});
  req.once('aborted',()=>upstream.destroy());upstream.end();
 });
}

function rejectUpgrade(socket:Duplex,status:number):void{
 if(socket.destroyed)return;
 const reason=status===401?'Unauthorized':status===403?'Forbidden':status===404?'Not Found':status===409?'Conflict':'Bad Gateway';
 socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

async function proxyNovncSocket(endpoint:URL,req:IncomingMessage,client:Duplex,head:Buffer):Promise<void>{
 const target=new URL('/websockify',endpoint);
 const headers:Record<string,string>={host:target.host,connection:'Upgrade',upgrade:'websocket'};
 for(const name of ['sec-websocket-key','sec-websocket-version','sec-websocket-protocol','sec-websocket-extensions']){
  const value=req.headers[name];if(typeof value==='string')headers[name]=value;
 }
 const upstream=httpRequest(target,{method:'GET',headers});
 let upstreamSocket:Duplex|undefined;
 const close=()=>{if(upstreamSocket&&!upstreamSocket.destroyed)upstreamSocket.destroy();if(!upstream.destroyed)upstream.destroy()};
 client.once('close',close);client.once('error',close);
 upstream.once('upgrade',(response,socket,upstreamHead)=>{
  upstreamSocket=socket;
  const lines=['HTTP/1.1 101 Switching Protocols','Upgrade: websocket','Connection: Upgrade'];
  for(const name of ['sec-websocket-accept','sec-websocket-protocol','sec-websocket-extensions']){
   const value=response.headers[name];if(typeof value==='string'&&!/[\r\n]/.test(value))lines.push(`${name}: ${value}`)
  }
  client.write(`${lines.join('\r\n')}\r\n\r\n`);
  if(upstreamHead.length)client.write(upstreamHead);
  if(head.length)socket.write(head);
  client.pipe(socket);socket.pipe(client);
 });
 upstream.once('response',response=>{response.resume();rejectUpgrade(client,response.statusCode===401?401:502);close()});
 upstream.once('error',()=>{rejectUpgrade(client,502);close()});
 upstream.end();
}

// Mount only behind a trusted proxy that preserves the configured Host.
export function createAuthServer(auth: GoogleAuthService, publicOrigin: string, staticDirectory?: string, bots?: BotStore, runs?: RunStore, approvals?: ApprovalStore, computer?: UserComputer, agentEngine:'pi'|'dsh'='pi', files?:WorkspaceFileStore, workspaceFiles?:WorkspaceFileTransportApi, groupChats?:GroupChatStore, routines?:RoutineStore) {
  const origin = parsePublicUrl(publicOrigin);
  const server=createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.host !== origin.host) { res.writeHead(400); return res.end(); }
    let url: URL;
    try { url = new URL(req.url || '/', origin.origin); }
    catch { res.writeHead(400, { 'Cache-Control': 'no-store' }); return res.end(); }
    try {
      if (req.method === 'GET' && url.pathname === `${origin.prefix}/api/auth/ready`) { await auth.ready(); res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end(); }
      if (req.method === 'GET' && url.pathname === `${origin.prefix}/api/auth/google/start`) return await auth.begin(res);
      if (req.method === 'GET' && url.pathname === `${origin.prefix}/auth/google/callback`) return await auth.finish(req, res, url);
      if (req.method === 'GET' && url.pathname === `${origin.prefix}/api/auth/me`) return await auth.me(req, res);
      if (req.method === 'GET' && url.pathname === `${origin.prefix}/api/auth/features`) {
        const session = await auth.session(req);
        if (!session) { res.writeHead(401, { 'Cache-Control': 'no-store' }); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ agent: Boolean(runs), engine: runs ? agentEngine : null }));
      }
      if (req.method === 'POST' && url.pathname === `${origin.prefix}/api/auth/logout`) return await auth.logout(req, res);
      const computerVncAssetMatch=url.pathname.match(new RegExp(`^${origin.prefix}/api/bots/([0-9a-f-]{36})/computer/vnc/(.+)$`,'i'));
      if(computer&&computerVncAssetMatch){
        if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'Cache-Control':'no-store'});return res.end()}
        const session=await auth.session(req);if(!session){res.writeHead(401,{'Cache-Control':'no-store'});return res.end()}
        const botId=computerVncAssetMatch[1];if(!runs||!await runs.ownsBot(session,botId)){res.writeHead(404,{'Cache-Control':'no-store'});return res.end()}
        const asset=validatedNovncAsset(computerVncAssetMatch[2]);if(!asset){res.writeHead(404,{'Cache-Control':'no-store'});return res.end()}
        try{const endpoint=await computer.vncEndpoint(session,botId,AbortSignal.timeout(240_000));if(!endpoint){res.writeHead(409,{'Cache-Control':'no-store'});return res.end()}return await proxyNovncAsset(endpoint,asset,req,res)}
        catch(error){const diagnostic=safeDiagnosticMetadata(error);console.error('Computer request failed',{operation:'novnc-asset',...diagnostic});res.writeHead(503,{'Cache-Control':'no-store'});return res.end()}
      }
      const computerMatch=url.pathname.match(new RegExp(`^${origin.prefix}/api/bots/([0-9a-f-]{36})/computer(?:/(screenshot|control|action))?$`,'i'));
      if(computer && computerMatch) {
        const reply=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
        const session=await auth.session(req);if(!session)return reply(401,{error:'Unauthenticated',diagnostic:{code:'COMPUTER_AUTH_REQUIRED',status:401}});
        const botId=computerMatch[1],actionPath=computerMatch[2]||'';
        if(!runs||!await runs.ownsBot(session,botId))return reply(404,{error:'Not found',diagnostic:{code:'COMPUTER_BOT_UNAVAILABLE',status:404}});
        // First access may create the user's persistent K3D desktop and PVC.
        const signal=AbortSignal.timeout(240_000);
        if(req.method==='GET' && !actionPath){try{return reply(200,await computer.control(session,botId,signal))}catch(error){const diagnostic=safeDiagnosticMetadata(error);console.error('Computer request failed',{operation:'control',...diagnostic});return reply(503,{error:'Service unavailable',diagnostic})}}
        if(req.method==='GET' && actionPath==='screenshot'){
          try{const image=await computer.screenshot(session,botId,signal);res.writeHead(200,{'Content-Type':'image/png','Content-Length':image.length,'Cache-Control':'no-store'});return res.end(image)}catch(error){const diagnostic=safeDiagnosticMetadata(error);console.error('Computer request failed',{operation:'screenshot',...diagnostic});return reply(503,{error:'Service unavailable',diagnostic})}
        }
        if(req.method!=='POST'||!['control','action'].includes(actionPath))return reply(405,{error:'Method not allowed'});
        if(req.headers.origin!==origin.origin)return reply(403,{error:'Invalid origin'});
        if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return reply(415,{error:'Expected JSON'});
        let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>8192)return reply(413,{error:'Request too large'});chunks.push(chunk)}
        let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return reply(400,{error:'Invalid JSON'})}
        if(actionPath==='control'){
          if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||((body as {owner?:unknown}).owner!=='agent'&&(body as {owner?:unknown}).owner!=='user'))return reply(400,{error:'Invalid control'});
          try{return reply(200,await computer.setControl(session,botId,(body as {owner:'agent'|'user'}).owner,signal))}catch(error){const diagnostic=safeDiagnosticMetadata(error);console.error('Computer request failed',{operation:'set-control',...diagnostic});return reply(503,{error:'Service unavailable',diagnostic})}
        }
        let action;try{action=parseUserAction(body)}catch{return reply(400,{error:'Invalid computer action'})}
        try{await computer.action(session,botId,action,signal);return reply(200,{ok:true})}catch(error){const diagnostic=safeDiagnosticMetadata(error);console.error('Computer request failed',{operation:'action',...diagnostic});return reply(503,{error:'Service unavailable',diagnostic})}
      }
      const botPath = `${origin.prefix}/api/bots`;
      const routineCollectionMatch=url.pathname.match(new RegExp(`^${botPath}/([0-9a-f-]{36})/routines$`,'i'));
      const routineTestMatch=url.pathname.match(new RegExp(`^${botPath}/([0-9a-f-]{36})/routines/([0-9a-f-]{36})/test$`,'i'));
      const routineItemMatch=url.pathname.match(new RegExp(`^${botPath}/([0-9a-f-]{36})/routines/([0-9a-f-]{36})$`,'i'));
      if(routines&&(routineCollectionMatch||routineTestMatch||routineItemMatch)){
        const reply=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
        const session=await auth.session(req);if(!session)return reply(401,{error:'Unauthenticated'});
        if(routineCollectionMatch&&req.method==='GET'){
          const items=await routines.list(session,routineCollectionMatch[1]);
          return items?reply(200,{routines:items}):reply(404,{error:'Not found'});
        }
        if(req.method==='POST'||req.method==='PATCH'||req.method==='DELETE'){
          if(req.headers.origin!==origin.origin)return reply(403,{error:'Invalid origin'});
          if(req.method==='DELETE'){
            if(!routineItemMatch)return reply(405,{error:'Method not allowed'});
            return await routines.remove(session,routineItemMatch[2])?reply(200,{ok:true}):reply(404,{error:'Not found'});
          }
          if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return reply(415,{error:'Expected JSON'});
          let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>12000)return reply(413,{error:'Request too large'});chunks.push(chunk)}
          let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return reply(400,{error:'Invalid JSON'})}
          if(routineCollectionMatch&&req.method==='POST'){
            try{
              const item=await routines.create(session,routineCollectionMatch[1],body as {requestId:string;name:string;instruction:string;schedule:RoutineSchedule;timezone:string});
              return item?reply(201,{routine:item}):reply(404,{error:'Not found'});
            }catch(error){
              if(error instanceof RoutineRequestConflict)return reply(409,{error:'Request ID already used'});
              if(error instanceof Error&&/^Invalid routine|^Routine limit reached/.test(error.message))return reply(400,{error:error.message});
              throw error;
            }
          }
          if(routineItemMatch&&req.method==='PATCH'){
            if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||typeof (body as {paused?:unknown}).paused!=='boolean')return reply(400,{error:'Invalid routine'});
            const item=await routines.setPaused(session,routineItemMatch[2],(body as {paused:boolean}).paused);
            return item?reply(200,{routine:item}):reply(404,{error:'Not found'});
          }
          if(routineTestMatch&&req.method==='POST'){
            if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==0)return reply(400,{error:'Invalid routine test'});
            const run=await routines.test(session,routineTestMatch[2]);
            return run?reply(202,{run}):reply(404,{error:'Not found'});
          }
        }
        return reply(405,{error:'Method not allowed'});
      }
      const groupPath = `${origin.prefix}/api/groups`;
      const groupMatch = url.pathname.match(new RegExp(`^${groupPath}/([0-9a-f-]{36})$`,'i'));
      const groupMessagesMatch = url.pathname.match(new RegExp(`^${groupPath}/([0-9a-f-]{36})/messages$`,'i'));
      const groupFilesMatch = url.pathname.match(new RegExp(`^${groupPath}/([0-9a-f-]{36})/files$`,'i'));
      const botMatch = url.pathname.match(new RegExp(`^${botPath}/([0-9a-f-]{36})$`));
      const botFilesMatch = url.pathname.match(new RegExp(`^${botPath}/([0-9a-f-]{36})/files$`));
      const fileDownloadMatch = url.pathname.match(new RegExp(`^${origin.prefix}/api/files/([0-9a-f-]{36})$`));
      const messageMatch = url.pathname.match(new RegExp(`^${botPath}/([0-9a-f-]{36})/messages$`));
      const runMatch = url.pathname.match(new RegExp(`^${botPath}/([0-9a-f-]{36})/runs$`));
      const runEventsMatch = url.pathname.match(new RegExp(`^${origin.prefix}/api/runs/([0-9a-f-]{36})/events$`));
      const runRecoveryMatch = url.pathname.match(new RegExp(`^${origin.prefix}/api/runs/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/recovery$`, 'i'));
      const approvalListMatch = url.pathname.match(new RegExp(`^${origin.prefix}/api/runs/([0-9a-f-]{36})/approvals$`));
      const approvalMatch = url.pathname.match(new RegExp(`^${origin.prefix}/api/approvals/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$`, 'i'));
      const approvalScreenshotMatch = url.pathname.match(new RegExp(`^${origin.prefix}/api/approvals/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/screenshot$`, 'i'));
      if(groupChats&&(url.pathname===groupPath||groupMatch||groupMessagesMatch||groupFilesMatch)){
        const reply=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
        const session=await auth.session(req);if(!session)return reply(401,{error:'Unauthenticated'});
        if(req.method==='GET'&&url.pathname===groupPath)return reply(200,{groups:await groupChats.list(session)});
        if(req.method==='GET'&&groupMatch){const chat=await groupChats.get(session,groupMatch[1]);return chat?reply(200,chat):reply(404,{error:'Not found'})}
        if(groupFilesMatch){
          if(req.method!=='POST')return reply(405,{error:'Method not allowed'});
          if(req.headers.origin!==origin.origin){req.resume();return reply(403,{error:'Invalid origin'})}
          if(!files||!workspaceFiles){req.resume();return reply(503,{error:'File service unavailable'})}
          const botId=await groupChats.fileUploadBot(session,groupFilesMatch[1]);
          if(!botId){req.resume();return reply(404,{error:'Not found'})}
          const rawName=req.headers['x-file-name'];
          if(typeof rawName!=='string'||rawName.length>1024){req.resume();return reply(400,{error:'Invalid file name'})}
          const mimeType=String(req.headers['content-type']||'application/octet-stream').split(';',1)[0].trim().toLowerCase();
          const size=Number(req.headers['content-length']);
          let name:string;
          try{name=cleanUploadName(decodeURIComponent(rawName));validateUploadSize(mimeType,size)}catch{req.resume();return reply(400,{error:'Invalid file metadata'})}
          const signal=AbortSignal.timeout(5*60_000);
          let file:ReturnType<WorkspaceFileStore['newUpload']>|null=null;
          let registered=false;
          try{
            file=files.newUpload(botId,name,mimeType,size,'0'.repeat(64));
            const receipt=await workspaceFiles.upload(session,{id:file.id,extension:uploadExtension(name),mimeType,size,body:req},signal);
            if(receipt.size!==size)throw new Error('Uploaded file size did not match');
            const stored={...file,sha256:receipt.sha256};
            if(!await files.saveUpload(session,stored))throw new Error('File owner unavailable');
            if(!await groupChats.registerUpload(session,groupFilesMatch[1],stored)){
              const detached=await files.removeUnattachedUpload(session,stored.id);
              if(detached)await workspaceFiles.removeUpload(session,stored.id,uploadExtension(name),AbortSignal.timeout(30_000)).catch(()=>undefined);
              return reply(404,{error:'Not found'});
            }
            registered=true;
            return reply(201,{file:{id:stored.id,name:stored.name,mimeType:stored.mimeType,size:stored.size,sha256:stored.sha256,kind:stored.kind}});
          }catch(error){
            if(file&&!registered){
              await files.removeUnattachedUpload(session,file.id).catch(()=>null);
              await workspaceFiles.removeUpload(session,file.id,uploadExtension(name),AbortSignal.timeout(30_000)).catch(()=>undefined);
            }
            const invalid=error instanceof Error&&/Invalid|too large|size limit/i.test(error.message);
            console.error('Group file upload failed',{diagnostic:error instanceof WorkspaceFileTransportError?error.diagnosticCode:'UPLOAD_INTERNAL'});
            return reply(invalid?400:503,{error:invalid?'Invalid file metadata':'File upload failed'});
          }
        }
        if(req.method!=='POST'||(url.pathname!==groupPath&&!groupMessagesMatch))return reply(405,{error:'Method not allowed'});
        if(req.headers.origin!==origin.origin)return reply(403,{error:'Invalid origin'});
        if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return reply(415,{error:'Expected JSON'});
        let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>12000)return reply(413,{error:'Request too large'});chunks.push(chunk)}
        let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return reply(400,{error:'Invalid JSON'})}
        if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,{error:'Invalid request'});
        try{
          if(url.pathname===groupPath){
            const value=body as {requestId?:unknown;name?:unknown;botIds?:unknown};
            if(typeof value.requestId!=='string'||typeof value.name!=='string')return reply(400,{error:'Invalid group'});
            const group=await groupChats.create(session,{requestId:value.requestId,name:value.name,botIds:value.botIds});
            return group?reply(201,{group}):reply(404,{error:'Not found'});
          }
          const value=body as {requestId?:unknown;text?:unknown;targetBotIds?:unknown;files?:unknown};
          if(typeof value.requestId!=='string'||typeof value.text!=='string')return reply(400,{error:'Invalid group message'});
          if(value.targetBotIds!==undefined&&(!Array.isArray(value.targetBotIds)||value.targetBotIds.some(id=>typeof id!=='string')))return reply(400,{error:'Invalid group message'});
          const chat=await groupChats.sendMessage(session,groupMessagesMatch![1],value.requestId,value.text,value.targetBotIds as string[]|undefined,value.files);
          return chat?reply(202,chat):reply(404,{error:'Not found'});
        }catch(error){
          if(error instanceof GroupRequestConflict)return reply(409,{error:'Request ID already used'});
          if(error instanceof Error&&(/^Invalid group(?: message)?$/.test(error.message)||/^Invalid attachment list$/.test(error.message)||/^Attachment /.test(error.message)))return reply(400,{error:'Invalid request'});
          throw error;
        }
      }
      if (files && workspaceFiles && (botFilesMatch || fileDownloadMatch)) {
        const reply=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
        const session=await auth.session(req);if(!session)return reply(401,{error:'Unauthenticated'});
        if (botFilesMatch) {
          if(req.method!=='POST')return reply(405,{error:'Method not allowed'});
          if(req.headers.origin!==origin.origin)return reply(403,{error:'Invalid origin'});
          if(!await files.ownsBot(session,botFilesMatch[1])){req.resume();return reply(404,{error:'Not found'})}
          const rawName=req.headers['x-file-name'];
          if(typeof rawName!=='string'||rawName.length>1024){req.resume();return reply(400,{error:'Invalid file name'})}
          let name:string,mimeType=String(req.headers['content-type']||'application/octet-stream').split(';',1)[0].trim().toLowerCase(),size=Number(req.headers['content-length']);
          try{name=cleanUploadName(decodeURIComponent(rawName));validateUploadSize(mimeType,size)}catch{req.resume();return reply(400,{error:'Invalid file metadata'})}
          const signal=AbortSignal.timeout(5*60_000);
          try{
            const file=files.newUpload(botFilesMatch[1],name,mimeType,size,'0'.repeat(64));
            const receipt=await workspaceFiles.upload(session,{id:file.id,extension:uploadExtension(name),mimeType,size,body:req},signal);
            if(receipt.size!==size)throw new Error('Uploaded file size did not match');
            const stored={...file,sha256:receipt.sha256};
            if(!await files.saveUpload(session,stored)){await workspaceFiles.removeUpload(session,file.id,uploadExtension(name),AbortSignal.timeout(30_000)).catch(()=>undefined);return reply(404,{error:'Not found'})}
            return reply(201,{file:{id:stored.id,name:stored.name,mimeType:stored.mimeType,size:stored.size,sha256:stored.sha256,kind:stored.kind}});
          }catch(error){
            const invalid=error instanceof Error&&/Invalid|too large|size limit/i.test(error.message);
            console.error('Workspace file upload failed',{diagnostic:error instanceof WorkspaceFileTransportError?error.diagnosticCode:'UPLOAD_INTERNAL'});
            return reply(invalid?400:503,{error:invalid?'Invalid file metadata':'File upload failed'});
          }
        }
        if(req.method!=='GET')return reply(405,{error:'Method not allowed'});
        const file=await files.fileForDownload(session,fileDownloadMatch![1])||await groupChats?.fileForDownload(session,fileDownloadMatch![1])||null;if(!file)return reply(404,{error:'Not found'});
        const downloadAbort=new AbortController(),downloadTimer=setTimeout(()=>downloadAbort.abort(),5*60_000);downloadTimer.unref();
        res.once('close',()=>{if(!res.writableEnded)downloadAbort.abort()});
        try{
          const workspaceFile=await workspaceFiles.download(session,file.storageKey,downloadAbort.signal);
          const safeInline=new Set(['application/pdf','image/png','image/jpeg','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime','audio/mpeg','audio/wav','audio/mp4','audio/ogg','audio/webm','audio/aac','text/plain','text/csv','text/markdown','application/json']);
          const inline=safeInline.has(file.mimeType.toLowerCase());
          const mimeType=inline?file.mimeType.toLowerCase():'application/octet-stream';
          const disposition=inline?'inline':'attachment';
          const encoded=encodeURIComponent(file.name).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
          res.writeHead(200,{'Content-Type':mimeType,'Content-Length':workspaceFile.size,'Content-Disposition':`${disposition}; filename*=UTF-8''${encoded}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
          workspaceFile.body.on('error',()=>res.destroy());workspaceFile.body.once('close',()=>clearTimeout(downloadTimer));workspaceFile.body.pipe(res);return;
        }catch{clearTimeout(downloadTimer);return reply(404,{error:'Not found'})}
      }
      if (approvals && (approvalListMatch || approvalMatch || approvalScreenshotMatch)) {
        const reply = (status:number, value:unknown) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
        const session=await auth.session(req); if(!session)return reply(401,{error:'Unauthenticated'});
        if(req.method==='GET' && approvalScreenshotMatch) {
          const image=await approvals.screenshot(session,approvalScreenshotMatch[1]);if(!image)return reply(404,{error:'Not found'});
          res.writeHead(200,{'Content-Type':'image/png','Content-Length':image.length,'Cache-Control':'no-store'});return res.end(image);
        }
        if(req.method==='GET' && approvalListMatch) {
          const list=await approvals.list(session,approvalListMatch[1]);return list?reply(200,{approvals:list}):reply(404,{error:'Not found'});
        }
        if(req.method!=='POST'||!approvalMatch)return reply(405,{error:'Method not allowed'});
        if(req.headers.origin!==origin.origin)return reply(403,{error:'Invalid origin'});
        if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return reply(415,{error:'Expected JSON'});
        let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>1024)return reply(413,{error:'Request too large'});chunks.push(chunk)}
        let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return reply(400,{error:'Invalid JSON'})}
        const decision=body && typeof body==='object' && !Array.isArray(body) ? (body as {decision?:unknown}).decision : undefined;
        if(decision!=='approved'&&decision!=='denied')return reply(400,{error:'Invalid decision'});
        const result=await approvals.decide(session,approvalMatch[1],decision);
        return result==='decided'?reply(200,{ok:true}):result==='not_found'?reply(404,{error:'Not found'}):reply(409,{error:'Approval is no longer pending'});
      }
      if (runs && (runMatch || runEventsMatch || runRecoveryMatch)) {
        const reply = (status:number, value:unknown) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
        const session = await auth.session(req);
        if (!session) return reply(401,{error:'Unauthenticated'});
        if (runRecoveryMatch) {
          if (req.method !== 'POST') return reply(405,{error:'Method not allowed'});
          if (req.headers.origin !== origin.origin) return reply(403,{error:'Invalid origin'});
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reply(415,{error:'Expected JSON'});
          let size=0; const chunks:Buffer[]=[];
          for await(const chunk of req) { size+=chunk.length; if(size>1024)return reply(413,{error:'Request too large'}); chunks.push(chunk); }
          let body:unknown; try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400,{error:'Invalid JSON'}); }
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1) return reply(400,{error:'Invalid recovery decision'});
          const decision=(body as {decision?:unknown}).decision;
          if (decision !== 'retry' && decision !== 'acknowledge') return reply(400,{error:'Invalid recovery decision'});
          try {
            const result=await runs.resolveUnknown(session,runRecoveryMatch[1],decision);
            return result ? reply(200,result) : reply(404,{error:'Not found'});
          } catch(error) { if(error instanceof RunRecoveryConflict)return reply(409,{error:'Run recovery is no longer pending'}); throw error; }
        }
        if (req.method === 'GET' && runEventsMatch) {
          const events=await runs.events(session,runEventsMatch[1]);
          return events ? reply(200,{events}) : reply(404,{error:'Not found'});
        }
        if (req.method === 'GET' && runMatch) {
          let list=await runs.list(session,runMatch[1]);
          if(list&&groupChats){
            const prompts=await groupChats.visibleRunPrompts(session,runMatch[1],list.map(run=>run.id));
            if(prompts.size)list=list.map(run=>prompts.has(run.id)?{...run,prompt:prompts.get(run.id)!}:run);
          }
          return list ? reply(200,{runs:list}) : reply(404,{error:'Not found'});
        }
        if (req.method !== 'POST' || !runMatch) return reply(405,{error:'Method not allowed'});
        if (req.headers.origin !== origin.origin) return reply(403,{error:'Invalid origin'});
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reply(415,{error:'Expected JSON'});
        let size=0; const chunks:Buffer[]=[];
        for await(const chunk of req) { size+=chunk.length; if(size>45000)return reply(413,{error:'Request too large'}); chunks.push(chunk); }
        let body:unknown; try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400,{error:'Invalid JSON'}); }
        if(!body || typeof body!=='object' || Array.isArray(body)) return reply(400,{error:'Invalid run'});
        const {requestId,prompt,files:fileIds,mentionBotIds}=body as {requestId?:unknown;prompt?:unknown;files?:unknown;mentionBotIds?:unknown};
        if(typeof requestId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) || typeof prompt!=='string' || !prompt.trim() || prompt.trim().length>10000) return reply(400,{error:'Invalid run'});
        if(mentionBotIds!==undefined&&(!Array.isArray(mentionBotIds)||mentionBotIds.length<1||mentionBotIds.length>6||mentionBotIds.some(id=>typeof id!=='string')))return reply(400,{error:'Invalid Bot mention targets'});
        try {
          WorkspaceFileStore.validateFileIds(fileIds);
          const run=await runs.create(session,runMatch[1],requestId,prompt,fileIds,mentionBotIds);
          return run ? reply(200,{run}) : reply(404,{error:'Not found'});
        } catch(error) { if(error instanceof RunRequestConflict) return reply(409,{error:'Request ID already used'}); if(error instanceof Error&&/Invalid Bot mention targets/.test(error.message))return reply(400,{error:'Invalid Bot mention targets'}); if(error instanceof Error&&/Invalid attachment|Attachment is unavailable|attachments exceed|per-message limit|too large|Invalid file/.test(error.message))return reply(400,{error:'Invalid attachments'});throw error; }
      }
      if (bots && messageMatch) {
        const reply = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
        const session = await auth.session(req);
        if (!session) return reply(401, { error: 'Unauthenticated' });
        if (req.method === 'GET') {
          const messages = await bots.messages(session, messageMatch[1]);
          return messages ? reply(200, { messages }) : reply(404, { error: 'Not found' });
        }
        if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
        if (req.headers.origin !== origin.origin) return reply(403, { error: 'Invalid origin' });
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reply(415, { error: 'Expected JSON' });
        let size = 0; const chunks: Buffer[] = [];
        for await (const chunk of req) { size += chunk.length; if (size > 45000) return reply(413, { error: 'Request too large' }); chunks.push(chunk); }
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400, { error: 'Invalid JSON' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as { text?: unknown }).text !== 'string') return reply(400, { error: 'Invalid message' });
        const text = (body as { text: string }).text.trim();
        if (!text || text.length > 10000) return reply(400, { error: 'Invalid message' });
        const message = await bots.addMessage(session, messageMatch[1], text);
        return message ? reply(201, { message }) : reply(404, { error: 'Not found' });
      }
      if (bots && (url.pathname === botPath || botMatch)) {
        const reply = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
        const session = await auth.session(req);
        if (!session) return reply(401, { error: 'Unauthenticated' });
        if (req.method === 'GET' && !botMatch) return reply(200, { bots: await bots.list(session, Boolean(runs)) });
        if ((req.method === 'POST' && !botMatch) || (req.method === 'PATCH' && botMatch)) {
          if (req.headers.origin !== origin.origin) return reply(403, { error: 'Invalid origin' });
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reply(415, { error: 'Expected JSON' });
          let size = 0; const chunks: Buffer[] = [];
          for await (const chunk of req) { size += chunk.length; if (size > 8192) return reply(413, { error: 'Request too large' }); chunks.push(chunk); }
          let body: Record<string, unknown>;
          try { const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); body = parsed as Record<string, unknown>; }
          catch { return reply(400, { error: 'Invalid JSON' }); }
          if (req.method === 'POST') {
            if (typeof body.name !== 'string' || typeof body.color !== 'string' || typeof body.shape !== 'string' || !body.name.trim() || body.name.trim().length > 60 || !/^#[0-9a-fA-F]{6}$/.test(body.color) || !['cloud','drop','hex','round','triangle','oval','square','pill','spark','heart','flower','pentagon','star'].includes(body.shape)) return reply(400, { error: 'Invalid bot' });
            return reply(201, { bot: await bots.create(session, { name: body.name, color: body.color, shape: body.shape as BotShape }) });
          }
          if (Object.keys(body).length === 1 && typeof body.label === 'string') {
            if (body.label.trim().length > 60) return reply(400, { error: 'Invalid bot' });
            return await bots.setLabel(session, botMatch![1], body.label) ? reply(200, { ok: true }) : reply(404, { error: 'Not found' });
          }
          if (Object.keys(body).length === 1 && (typeof body.pinned === 'boolean' || typeof body.hidden === 'boolean')) {
            const field = typeof body.pinned === 'boolean' ? 'pinned' : 'hidden';
            return await bots.setSidebarState(session, botMatch![1], field, body[field] as boolean) ? reply(200, { ok: true }) : reply(404, { error: 'Not found' });
          }
          if (Object.keys(body).sort().join(',') === 'color,shape' && typeof body.color === 'string' && typeof body.shape === 'string') {
            if (!/^#[0-9a-fA-F]{6}$/.test(body.color) || !['cloud','drop','hex','round','triangle','oval','square','pill','spark','heart','flower','pentagon','star'].includes(body.shape)) return reply(400, { error: 'Invalid bot' });
            return await bots.setAvatar(session, botMatch![1], body.shape as BotShape, body.color) ? reply(200, { ok: true }) : reply(404, { error: 'Not found' });
          }
          if (Object.keys(body).length !== 1 || typeof body.name !== 'string') return reply(400, { error: 'Invalid bot' });
          if (!body.name.trim() || body.name.trim().length > 60) return reply(400, { error: 'Invalid bot' });
          const renamed = await bots.rename(session, botMatch![1], body.name);
          return renamed.ok ? reply(200, { ok: true, event: renamed.event }) : reply(404, { error: 'Not found' });
        }
        return reply(405, { error: 'Method not allowed' });
      }
      if (staticDirectory && (req.method === 'GET' || req.method === 'HEAD')) {
        const index = url.pathname === `${origin.prefix}/`;
        const assetPrefix = `${origin.prefix}/assets/`;
        const name = url.pathname.startsWith(assetPrefix) ? url.pathname.slice(assetPrefix.length) : '';
        if (index || /^[A-Za-z0-9_.-]+\.(?:js|css|svg|png|woff2?)$/.test(name)) {
          const file = index ? join(staticDirectory, 'index.html') : join(staticDirectory, 'assets', name);
          try {
            const content = await readFile(file);
            const extension = name.split('.').at(-1);
            const types: Record<string, string> = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', woff: 'font/woff', woff2: 'font/woff2' };
            res.writeHead(200, { 'Content-Type': index ? 'text/html; charset=utf-8' : types[extension || ''], 'Content-Length': content.length, 'Cache-Control': index ? 'no-store' : 'public, max-age=31536000, immutable' });
            return res.end(req.method === 'HEAD' ? undefined : content);
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
      }
      res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end();
    } catch {
      if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end('{"error":"Service unavailable"}');
    }
  });
  server.on('upgrade',(req,socket,head)=>{
    void (async()=>{
      if(!computer||req.headers.host!==origin.host||req.headers.origin!==origin.origin||req.method!=='GET'||String(req.headers.upgrade||'').toLowerCase()!=='websocket'||req.headers['sec-websocket-version']!=='13'||typeof req.headers['sec-websocket-key']!=='string')return rejectUpgrade(socket,403);
      let requestUrl:URL;try{requestUrl=new URL(req.url||'/',origin.origin)}catch{return rejectUpgrade(socket,404)}
      const match=requestUrl.pathname.match(new RegExp(`^${origin.prefix}/api/bots/([0-9a-f-]{36})/computer/vnc/websockify$`,'i'));
      if(!match||requestUrl.search)return rejectUpgrade(socket,404);
      const session=await auth.session(req);if(!session)return rejectUpgrade(socket,401);
      const botId=match[1];if(!runs||!await runs.ownsBot(session,botId))return rejectUpgrade(socket,404);
      const endpoint=await computer.vncEndpoint(session,botId,AbortSignal.timeout(240_000));if(!endpoint)return rejectUpgrade(socket,409);
      await proxyNovncSocket(endpoint,req,socket,head);
    })().catch(()=>rejectUpgrade(socket,502));
  });
  return server;
}
