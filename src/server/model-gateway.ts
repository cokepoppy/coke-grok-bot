import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ApprovalStore } from './approval-store.ts';

/**
 * A run receives a short-lived capability; the upstream credential stays in
 * the control process. Never attach this server to the public ingress.
 */
type Grant = { expires: number; remaining: number; abort: AbortController; timer: NodeJS.Timeout; scope?:{runId:string;leaseId:string}; approvalsRemaining:number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class ModelGateway {
  private readonly grants = new Map<string, Grant>();
  private readonly upstream: URL;
  constructor(private readonly apiKey: string, upstream: string, private readonly model: string, private readonly request: typeof fetch = fetch, private readonly approvals?:ApprovalStore) {
    this.upstream = new URL(upstream);
    if (this.upstream.protocol !== 'https:' || this.upstream.username || this.upstream.password || this.upstream.search || this.upstream.hash || !this.upstream.pathname.endsWith('/compatible-mode/v1')) throw new Error('Invalid model endpoint');
    if (!apiKey || apiKey.length > 4096 || /[\r\n]/.test(apiKey) || !model) throw new Error('Invalid model configuration');
  }
  issue(options: { ttlMs: number; calls: number; scope?:{runId:string;leaseId:string} }): string {
    if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs < 1 || options.ttlMs > 15 * 60_000 || !Number.isSafeInteger(options.calls) || options.calls < 1 || options.calls > 100) throw new Error('Invalid capability limits');
    if(options.scope && (!uuid.test(options.scope.runId) || !uuid.test(options.scope.leaseId))) throw new Error('Invalid capability scope');
    const token = randomBytes(32).toString('base64url');
    const timer = setTimeout(() => this.revoke(token), options.ttlMs); timer.unref();
    this.grants.set(token, { expires: Date.now() + options.ttlMs, remaining: options.calls, abort: new AbortController(), timer, scope:options.scope, approvalsRemaining:100 });
    return token;
  }
  revoke(token: string): void {
    const grant = this.grants.get(token);
    if (grant) { clearTimeout(grant.timer); grant.abort.abort(); this.grants.delete(token); }
  }
  close(): void { for (const token of this.grants.keys()) this.revoke(token); }
  createServer(tls?: { key: Buffer; cert: Buffer }): Server {
    const handler: import('node:http').RequestListener = async (req, res) => {
      const fail = (status: number) => { if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"error":"Model gateway request failed"}'); };
      const approvalMatch = req.url?.match(/^\/v1\/action-approvals\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\/consume)?$/i);
      const approvalRoute = req.url === '/v1/action-approvals' || Boolean(approvalMatch);
      if (!approvalRoute && (req.method !== 'POST' || req.url !== '/v1/chat/completions')) return fail(404);
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
      const grant = token && this.grants.get(token);
      if (!grant || grant.expires <= Date.now() || (!approvalRoute && grant.remaining <= 0)) { if (token && grant) this.revoke(token); return fail(401); }
      if (approvalRoute) {
        const reply = (status:number,value:unknown) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
        if (!this.approvals || !grant.scope) return fail(404);
        try {
          if (req.method==='GET' && approvalMatch && !approvalMatch[2]) {
            const status=await this.approvals.status(grant.scope.runId,grant.scope.leaseId,approvalMatch[1]);
            return status ? reply(200,{status}) : fail(404);
          }
          if (req.method!=='POST' || (approvalMatch && !approvalMatch[2])) return fail(405);
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return fail(415);
          const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16000)return fail(413);chunks.push(chunk)}
          let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return fail(400)}
          const action=body && typeof body==='object' && !Array.isArray(body)?(body as {action?:unknown}).action:undefined;
          if(typeof action!=='string'||!action.trim()||action.trim().length>4000)return fail(400);
          if (!token || this.grants.get(token)!==grant || grant.expires<=Date.now()) return fail(401);
          if (!approvalMatch) {
            if (grant.approvalsRemaining<=0) return fail(429);
            grant.approvalsRemaining--;
            const approval=await this.approvals.propose(grant.scope.runId,grant.scope.leaseId,action,Math.max(1,Math.min(300,Math.floor((grant.expires-Date.now())/1000))));
            return approval ? reply(201,{id:approval.id}) : fail(409);
          }
          const consumed=await this.approvals.consume(grant.scope.runId,grant.scope.leaseId,approvalMatch[1],action);
          return consumed ? reply(200,{ok:true}) : fail(409);
        } catch { return fail(503); }
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return fail(415);
      const chunks: Buffer[] = []; let size = 0;
      try {
        for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) return fail(413); chunks.push(chunk); }
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return fail(400); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400);
        const payload = body as Record<string, unknown>;
        if (payload.model !== this.model || !Array.isArray(payload.messages) || payload.messages.length === 0 || payload.messages.length > 500) return fail(400);
        if (payload.max_tokens !== undefined && (!Number.isInteger(payload.max_tokens) || (payload.max_tokens as number) < 1 || (payload.max_tokens as number) > 8192)) return fail(400);
        if (payload.stream !== undefined && typeof payload.stream !== 'boolean') return fail(400);
        if (!token || this.grants.get(token) !== grant || grant.expires <= Date.now() || grant.remaining <= 0) return fail(401);
        payload.max_tokens ??= 8192;
        grant.remaining--;
        const disconnected = new AbortController();
        res.once('close', () => disconnected.abort());
        const upstream = await this.request(`${this.upstream.href}/chat/completions`, {
          method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(payload), signal: AbortSignal.any([grant.abort.signal, disconnected.signal, AbortSignal.timeout(120_000)]),
        });
        if (!upstream.ok || !upstream.body) return fail(502);
        res.writeHead(200, { 'Content-Type': payload.stream === true ? 'text/event-stream; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        const redactor = new SecretRedactor(Buffer.from(this.apiKey));
        await pipeline(Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream<Uint8Array>), redactor, res);
      } catch {
        if (!res.headersSent) fail(502);
        else res.destroy();
      }
    };
    return tls ? createTlsServer(tls, handler) : createServer(handler);
  }
}

/** Remove a raw secret even when it straddles network chunks. */
class SecretRedactor extends Transform {
  private pending = Buffer.alloc(0);
  constructor(private readonly secret: Buffer) { super(); }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.pending = Buffer.concat([this.pending, chunk]);
    this.flushSafe(false); callback();
  }
  override _flush(callback: (error?: Error | null) => void) { this.flushSafe(true); callback(); }
  private flushSafe(final: boolean) {
    const keep = this.secret.length - 1;
    while (this.pending.length) {
      const pos = this.pending.indexOf(this.secret);
      if (pos >= 0) {
        if (pos) this.push(this.pending.subarray(0, pos));
        this.push('[redacted]'); this.pending = this.pending.subarray(pos + this.secret.length);
      } else {
        const count = final ? this.pending.length : Math.max(0, this.pending.length - keep);
        if (count) { this.push(this.pending.subarray(0, count)); this.pending = this.pending.subarray(count); }
        break;
      }
    }
  }
}
