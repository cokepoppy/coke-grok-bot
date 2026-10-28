import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GoogleAuthService } from './google-auth.ts';
import { parsePublicUrl } from './public-url.ts';

// Mount only behind a trusted proxy that preserves the configured Host.
export function createAuthServer(auth: GoogleAuthService, publicOrigin: string, staticDirectory?: string) {
  const origin = parsePublicUrl(publicOrigin);
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.host !== origin.host) { res.writeHead(400); return res.end(); }
    const url = new URL(req.url || '/', origin.origin);
    try {
      if (req.method === 'GET' && url.pathname === `${origin.prefix}/api/auth/ready`) { await auth.ready(); res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end(); }
      if (req.method === 'GET' && url.pathname === `${origin.prefix}/api/auth/google/start`) return await auth.begin(res);
      if (req.method === 'GET' && url.pathname === `${origin.prefix}/auth/google/callback`) return await auth.finish(req, res, url);
      if (req.method === 'GET' && url.pathname === `${origin.prefix}/api/auth/me`) return await auth.me(req, res);
      if (req.method === 'POST' && url.pathname === `${origin.prefix}/api/auth/logout`) return await auth.logout(req, res);
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
