import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GoogleAuthService } from './google-auth.ts';
import type { BotStore, BotShape } from './bot-store.ts';
import { parsePublicUrl } from './public-url.ts';

// Mount only behind a trusted proxy that preserves the configured Host.
export function createAuthServer(auth: GoogleAuthService, publicOrigin: string, staticDirectory?: string, bots?: BotStore) {
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
      if (req.method === 'POST' && url.pathname === `${origin.prefix}/api/auth/logout`) return await auth.logout(req, res);
      const botPath = `${origin.prefix}/api/bots`;
      const botMatch = url.pathname.match(new RegExp(`^${botPath}/([0-9a-f-]{36})$`));
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
          if (typeof body.name !== 'string') return reply(400, { error: 'Invalid bot' });
          if (req.method === 'POST') {
            if (typeof body.color !== 'string' || typeof body.shape !== 'string' || !body.name.trim() || body.name.trim().length > 60 || !/^#[0-9a-fA-F]{6}$/.test(body.color) || !['cloud','drop','hex','round','triangle'].includes(body.shape)) return reply(400, { error: 'Invalid bot' });
            return reply(201, { bot: await bots.create(session, { name: body.name, color: body.color, shape: body.shape as BotShape }) });
          }
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
