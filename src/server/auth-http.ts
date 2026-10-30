import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GoogleAuthService } from './google-auth.ts';
import type { BotStore, BotShape } from './bot-store.ts';
import { RunRequestConflict, type RunStore } from './run-store.ts';
import type { ApprovalStore } from './approval-store.ts';
import {parseUserAction,type UserComputer} from './user-computer.ts';
import { parsePublicUrl } from './public-url.ts';

// Mount only behind a trusted proxy that preserves the configured Host.
export function createAuthServer(auth: GoogleAuthService, publicOrigin: string, staticDirectory?: string, bots?: BotStore, runs?: RunStore, approvals?: ApprovalStore, computer?: UserComputer) {
  const origin = parsePublicUrl(publicOrigin);
  return createServer(async (req, res) => {
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
        return res.end(JSON.stringify({ pi: Boolean(runs) }));
      }
      if (req.method === 'POST' && url.pathname === `${origin.prefix}/api/auth/logout`) return await auth.logout(req, res);
      const computerPath=`${origin.prefix}/api/computer`;
      if(computer && [computerPath,`${computerPath}/screenshot`,`${computerPath}/control`,`${computerPath}/action`].includes(url.pathname)) {
        const reply=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
        const session=await auth.session(req);if(!session)return reply(401,{error:'Unauthenticated'});
        const signal=AbortSignal.timeout(20_000);
        if(req.method==='GET' && url.pathname===computerPath)return reply(200,await computer.control(session,signal));
        if(req.method==='GET' && url.pathname===`${computerPath}/screenshot`){
          const image=await computer.screenshot(session,signal);res.writeHead(200,{'Content-Type':'image/png','Content-Length':image.length,'Cache-Control':'no-store'});return res.end(image);
        }
        if(req.method!=='POST'||![`${computerPath}/control`,`${computerPath}/action`].includes(url.pathname))return reply(405,{error:'Method not allowed'});
        if(req.headers.origin!==origin.origin)return reply(403,{error:'Invalid origin'});
        if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return reply(415,{error:'Expected JSON'});
        let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>8192)return reply(413,{error:'Request too large'});chunks.push(chunk)}
        let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return reply(400,{error:'Invalid JSON'})}
        if(url.pathname===`${computerPath}/control`){
          if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||((body as {owner?:unknown}).owner!=='agent'&&(body as {owner?:unknown}).owner!=='user'))return reply(400,{error:'Invalid control'});
          return reply(200,await computer.setControl(session,(body as {owner:'agent'|'user'}).owner,signal));
        }
        let action;try{action=parseUserAction(body)}catch{return reply(400,{error:'Invalid computer action'})}
        await computer.action(session,action,signal);return reply(200,{ok:true});
      }
      const botPath = `${origin.prefix}/api/bots`;
      const botMatch = url.pathname.match(new RegExp(`^${botPath}/([0-9a-f-]{36})$`));
      const messageMatch = url.pathname.match(new RegExp(`^${botPath}/([0-9a-f-]{36})/messages$`));
      const runMatch = url.pathname.match(new RegExp(`^${botPath}/([0-9a-f-]{36})/runs$`));
      const runEventsMatch = url.pathname.match(new RegExp(`^${origin.prefix}/api/runs/([0-9a-f-]{36})/events$`));
      const approvalListMatch = url.pathname.match(new RegExp(`^${origin.prefix}/api/runs/([0-9a-f-]{36})/approvals$`));
      const approvalMatch = url.pathname.match(new RegExp(`^${origin.prefix}/api/approvals/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$`, 'i'));
      const approvalScreenshotMatch = url.pathname.match(new RegExp(`^${origin.prefix}/api/approvals/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/screenshot$`, 'i'));
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
      if (runs && (runMatch || runEventsMatch)) {
        const reply = (status:number, value:unknown) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
        const session = await auth.session(req);
        if (!session) return reply(401,{error:'Unauthenticated'});
        if (req.method === 'GET' && runEventsMatch) {
          const events=await runs.events(session,runEventsMatch[1]);
          return events ? reply(200,{events}) : reply(404,{error:'Not found'});
        }
        if (req.method === 'GET' && runMatch) {
          const list=await runs.list(session,runMatch[1]);
          return list ? reply(200,{runs:list}) : reply(404,{error:'Not found'});
        }
        if (req.method !== 'POST' || !runMatch) return reply(405,{error:'Method not allowed'});
        if (req.headers.origin !== origin.origin) return reply(403,{error:'Invalid origin'});
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reply(415,{error:'Expected JSON'});
        let size=0; const chunks:Buffer[]=[];
        for await(const chunk of req) { size+=chunk.length; if(size>45000)return reply(413,{error:'Request too large'}); chunks.push(chunk); }
        let body:unknown; try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400,{error:'Invalid JSON'}); }
        if(!body || typeof body!=='object' || Array.isArray(body)) return reply(400,{error:'Invalid run'});
        const {requestId,prompt}=body as {requestId?:unknown;prompt?:unknown};
        if(typeof requestId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) || typeof prompt!=='string' || !prompt.trim() || prompt.trim().length>10000) return reply(400,{error:'Invalid run'});
        try {
          const run=await runs.create(session,runMatch[1],requestId,prompt);
          return run ? reply(200,{run}) : reply(404,{error:'Not found'});
        } catch(error) { if(error instanceof RunRequestConflict) return reply(409,{error:'Request ID already used'}); throw error; }
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
        if (req.method === 'GET' && !botMatch) return reply(200, { bots: await bots.list(session) });
        if ((req.method === 'POST' && !botMatch) || (req.method === 'PATCH' && botMatch)) {
          if (req.headers.origin !== origin.origin) return reply(403, { error: 'Invalid origin' });
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reply(415, { error: 'Expected JSON' });
          let size = 0; const chunks: Buffer[] = [];
          for await (const chunk of req) { size += chunk.length; if (size > 8192) return reply(413, { error: 'Request too large' }); chunks.push(chunk); }
          let body: Record<string, unknown>;
          try { const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); body = parsed as Record<string, unknown>; }
          catch { return reply(400, { error: 'Invalid JSON' }); }
          if (req.method === 'POST') {
            if (typeof body.name !== 'string' || typeof body.color !== 'string' || typeof body.shape !== 'string' || !body.name.trim() || body.name.trim().length > 60 || !/^#[0-9a-fA-F]{6}$/.test(body.color) || !['cloud','drop','hex','round','triangle'].includes(body.shape)) return reply(400, { error: 'Invalid bot' });
            return reply(201, { bot: await bots.create(session, { name: body.name, color: body.color, shape: body.shape as BotShape }) });
          }
          if (Object.keys(body).length === 1 && typeof body.label === 'string') {
            if (body.label.trim().length > 60) return reply(400, { error: 'Invalid bot' });
            return await bots.setLabel(session, botMatch![1], body.label) ? reply(200, { ok: true }) : reply(404, { error: 'Not found' });
          }
          if (Object.keys(body).length !== 1 || typeof body.name !== 'string') return reply(400, { error: 'Invalid bot' });
          if (!body.name.trim() || body.name.trim().length > 60) return reply(400, { error: 'Invalid bot' });
          return await bots.rename(session, botMatch![1], body.name) ? reply(200, { ok: true }) : reply(404, { error: 'Not found' });
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
}
