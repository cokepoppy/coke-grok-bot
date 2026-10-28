import { createServer } from 'node:http';
import type { GoogleAuthService } from './google-auth.ts';

// Mount only behind a trusted proxy that preserves the configured Host.
export function createAuthServer(auth: GoogleAuthService, publicOrigin: string) {
  const origin = new URL(publicOrigin);
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.host !== origin.host) { res.writeHead(400); return res.end(); }
    const url = new URL(req.url || '/', origin);
    try {
      if (req.method === 'GET' && url.pathname === '/api/auth/google/start') return await auth.begin(res);
      if (req.method === 'GET' && url.pathname === '/auth/google/callback') return await auth.finish(req, res, url);
      if (req.method === 'GET' && url.pathname === '/api/auth/me') return await auth.me(req, res);
      if (req.method === 'POST' && url.pathname === '/api/auth/logout') return await auth.logout(req, res);
      res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end();
    } catch {
      if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end('{"error":"Service unavailable"}');
    }
  });
}
