import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ApprovalStore } from './approval-store.ts';
import type { ComputerBridge,RunScope } from './computer-bridge.ts';
import type { RunOwner } from './run-store.ts';
import type { BotMemoryBridge, BotMemoryRunScope } from './bot-memory-bridge.ts';
import type { BotHandoffStore, BotHandoffScope } from './bot-handoff-store.ts';
import type { BotRoutineBridge, BotRoutineScope } from './bot-routine-bridge.ts';
import type { RoutineEditInput } from './routine-store.ts';
import { safeDiagnosticMetadata } from './safe-diagnostics.ts';

/**
 * A run receives a short-lived capability; the upstream credential stays in
 * the control process. Never attach this server to the public ingress.
 */
type Grant = { expires: number; remaining: number; memoryRemaining:number; handoffRemaining:number; routineRemaining:number; abort: AbortController; timer: NodeJS.Timeout; scope?:{runId:string;leaseId:string;botId?:string;owner?:RunOwner}; approvalsRemaining:number; modelRateLimit?:{retryAfterSeconds?:number} };
type UpstreamModelResponse = {response?:Response;retryAfterSeconds?:number};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function retryAfterSeconds(value:string|null,now=Date.now()):number|undefined {
  const input=value?.trim();if(!input)return undefined;
  if(/^\d+$/.test(input)){
    const seconds=Number(input);return Number.isSafeInteger(seconds)&&seconds<=86400?seconds:undefined;
  }
  const date=Date.parse(input);if(!Number.isFinite(date))return undefined;
  const seconds=Math.max(0,Math.ceil((date-now)/1000));
  return seconds<=86400?seconds:undefined;
}
function replyRateLimited(response:import('node:http').ServerResponse,retryAfter?:number):void {
  response.writeHead(429,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    ...(retryAfter===undefined?{}:{'Retry-After':String(retryAfter)}),
  });
  response.end(JSON.stringify({error:{message:'The model provider rate-limited this run.',type:'rate_limit_error',code:'model_upstream_429'}}));
}
function validRoutineEditInput(value:unknown):value is RoutineEditInput {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const body=value as Record<string,unknown>;
  if(Object.keys(body).sort().join(',')!=='instruction,name,schedule,timezone'||typeof body.name!=='string'||typeof body.instruction!=='string'||typeof body.timezone!=='string'||!body.schedule||typeof body.schedule!=='object'||Array.isArray(body.schedule))return false;
  const schedule=body.schedule as Record<string,unknown>;
  if(schedule.kind==='weekly')return Object.keys(schedule).sort().join(',')==='hour,kind,minute,weekday'&&Number.isInteger(schedule.weekday)&&Number.isInteger(schedule.hour)&&Number.isInteger(schedule.minute);
  return schedule.kind==='interval'&&Object.keys(schedule).sort().join(',')==='kind,minutes'&&Number.isInteger(schedule.minutes);
}
export class ModelGateway {
  private readonly grants = new Map<string, Grant>();
  private readonly upstream: URL;
  private upstreamRateLimit?:{until:number;retryAfterSeconds:number};
  private providerAvailable=false;
  private rateLimitGeneration=0;
  private upstreamRequestTail:Promise<void>=Promise.resolve();
  constructor(private readonly apiKey: string, upstream: string, private readonly model: string, private readonly request: typeof fetch = fetch, private readonly approvals?:ApprovalStore, private readonly computer?:ComputerBridge, private readonly memories?:BotMemoryBridge, private readonly handoffs?:BotHandoffStore, private readonly routines?:BotRoutineBridge) {
    this.upstream = new URL(upstream);
    const deepSeekOfficial=this.upstream.origin==='https://api.deepseek.com'&&this.upstream.pathname==='/';
    if (this.upstream.protocol !== 'https:' || this.upstream.username || this.upstream.password || this.upstream.search || this.upstream.hash || (!deepSeekOfficial&&!this.upstream.pathname.endsWith('/compatible-mode/v1'))) throw new Error('Invalid model endpoint');
    if (!apiKey || apiKey.length > 4096 || /[\r\n]/.test(apiKey) || !model) throw new Error('Invalid model configuration');
  }
  issue(options: { ttlMs: number; calls: number; scope?:{runId:string;leaseId:string;botId?:string;owner?:RunOwner} }): string {
    if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs < 1 || options.ttlMs > 15 * 60_000 || !Number.isSafeInteger(options.calls) || options.calls < 1 || options.calls > 100) throw new Error('Invalid capability limits');
    if(options.scope && (!uuid.test(options.scope.runId) || !uuid.test(options.scope.leaseId) || (options.scope.botId && !uuid.test(options.scope.botId)) || (options.scope.owner && (!uuid.test(options.scope.owner.tenantId)||!uuid.test(options.scope.owner.userId))))) throw new Error('Invalid capability scope');
    const token = randomBytes(32).toString('base64url');
    const timer = setTimeout(() => this.revoke(token), options.ttlMs); timer.unref();
    const scope=options.scope ? { ...options.scope, ...(options.scope.owner ? {owner:{...options.scope.owner}} : {}) } : undefined;
    this.grants.set(token, { expires: Date.now() + options.ttlMs, remaining: options.calls, memoryRemaining:100, handoffRemaining:8, routineRemaining:20, abort: new AbortController(), timer, scope, approvalsRemaining:100 });
    return token;
  }
  revoke(token: string): void {
    const grant = this.grants.get(token);
    if (grant) { clearTimeout(grant.timer); grant.abort.abort(); this.grants.delete(token); }
  }
  diagnosticCode(token:string):'model_upstream_429'|null {
    return this.grants.get(token)?.modelRateLimit?'model_upstream_429':null;
  }
  private activeUpstreamCooldown():number|undefined {
    const active=this.upstreamRateLimit;
    if(!active)return undefined;
    if(active.until<=Date.now()){this.upstreamRateLimit=undefined;return undefined;}
    return Math.max(1,Math.ceil((active.until-Date.now())/1000));
  }
  private async performUpstreamModelRequest(input:string,init:RequestInit):Promise<UpstreamModelResponse> {
    const generation=this.rateLimitGeneration;
    const response=await this.request(input,init);
    if(response.status===429){
      const supplied=retryAfterSeconds(response.headers.get('retry-after'));
      const cooldown=Math.max(1,supplied??60);
      const until=Math.max(Date.now()+cooldown*1000,this.upstreamRateLimit?.until??0);
      const effectiveCooldown=Math.max(cooldown,Math.ceil((until-Date.now())/1000));
      this.upstreamRateLimit={until,retryAfterSeconds:effectiveCooldown};
      this.providerAvailable=false;
      this.rateLimitGeneration++;
      return{response,retryAfterSeconds:effectiveCooldown};
    }
    if(generation===this.rateLimitGeneration&&!this.activeUpstreamCooldown())this.providerAvailable=true;
    return{response};
  }
  private async requestUpstreamModel(input:string,init:RequestInit):Promise<UpstreamModelResponse> {
    const cooldown=this.activeUpstreamCooldown();
    if(cooldown!==undefined)return{retryAfterSeconds:cooldown};
    if(this.providerAvailable)return this.performUpstreamModelRequest(input,init);
    let release=()=>{};
    const previous=this.upstreamRequestTail;
    this.upstreamRequestTail=new Promise<void>(resolve=>{release=resolve});
    await previous;
    try {
      const active=this.activeUpstreamCooldown();
      if(active!==undefined)return{retryAfterSeconds:active};
      if(!this.providerAvailable)return await this.performUpstreamModelRequest(input,init);
    } finally {release()}
    return this.performUpstreamModelRequest(input,init);
  }
  close(): void { for (const token of this.grants.keys()) this.revoke(token); }
  createServer(tls?: { key: Buffer; cert: Buffer }): Server {
    const handler: import('node:http').RequestListener = async (req, res) => {
      const fail = (status: number) => { if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"error":"Model gateway request failed"}'); };
      const approvalMatch = req.url?.match(/^\/v1\/action-approvals\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\/consume)?$/i);
      const approvalRoute = req.url === '/v1/action-approvals' || Boolean(approvalMatch);
      const memoryMatch=req.url?.match(/^\/v1\/bot-memory(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}))?$/i);
      const memoryRoute=Boolean(memoryMatch);
      const handoffRoute=req.url==='/v1/bot-handoffs';
      const routineMatch=req.url?.match(/^\/v1\/bot-routines(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}))?$/i);
      const routineRoute=Boolean(routineMatch);
      const computerMatch=req.url?.match(/^\/v1\/computer\/actions\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\/execute)?$/i);
      const computerRoute=req.url==='/v1/computer/control'||req.url==='/v1/computer/inspect'||req.url==='/v1/computer/screenshot'||req.url==='/v1/computer/actions'||Boolean(computerMatch);
      const modelRoute=req.method === 'POST' && req.url === '/v1/chat/completions';
      if (!approvalRoute && !computerRoute && !memoryRoute && !handoffRoute && !routineRoute && !modelRoute) return fail(404);
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
      const grant = token && this.grants.get(token);
      if (!grant || grant.expires <= Date.now() || (memoryRoute && grant.memoryRemaining <= 0) || (handoffRoute && req.method==='POST' && grant.handoffRemaining <= 0) || (routineRoute && grant.routineRemaining <= 0)) { if (token && grant) this.revoke(token); return fail(401); }
      if(modelRoute&&grant.modelRateLimit)return replyRateLimited(res,grant.modelRateLimit.retryAfterSeconds);
      if (routineRoute) {
        const reply=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
        if(!this.routines||!grant.scope?.owner||!grant.scope.botId)return fail(404);
        grant.routineRemaining--;
        const scope:BotRoutineScope={runId:grant.scope.runId,leaseId:grant.scope.leaseId,botId:grant.scope.botId,owner:grant.scope.owner};
        const disconnected=new AbortController();res.once('close',()=>disconnected.abort());
        const signal=AbortSignal.any([grant.abort.signal,disconnected.signal,AbortSignal.timeout(10_000)]);
        try {
          if(req.method==='GET'&&!routineMatch?.[1]) {
            const routines=await this.routines.list(scope,signal);
            return routines?reply(200,{routines}):fail(409);
          }
          if((req.method==='POST'&&!routineMatch?.[1])||(req.method==='PATCH'&&routineMatch?.[1])) {
            if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return fail(415);
            const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12000)return fail(413);chunks.push(chunk)}
            let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return fail(400)}
            if(!validRoutineEditInput(body))return reply(400,{error:'Invalid routine'});
            const item=req.method==='POST'
              ? await this.routines.create(scope,body,signal)
              : await this.routines.update(scope,routineMatch![1],body,signal);
            return item?reply(req.method==='POST'?201:200,{routine:item}):fail(409);
          }
          return fail(405);
        } catch(error) {
          if(error instanceof Error&&/^Invalid routine|^Routine limit reached/.test(error.message))return reply(400,{error:error.message});
          return fail(409);
        }
      }
      if (handoffRoute) {
        const reply=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
        if(!this.handoffs||!grant.scope?.owner||!grant.scope.botId)return fail(404);
        const scope:BotHandoffScope={runId:grant.scope.runId,leaseId:grant.scope.leaseId,botId:grant.scope.botId,tenantId:grant.scope.owner.tenantId,userId:grant.scope.owner.userId};
        const disconnected=new AbortController();res.once('close',()=>disconnected.abort());
        const signal=AbortSignal.any([grant.abort.signal,disconnected.signal,AbortSignal.timeout(10_000)]);
        try {
          if(req.method==='GET') {
            const bots=await this.handoffs.listTargets(scope,signal);
            return bots?reply(200,{bots}):fail(409);
          }
          if(req.method!=='POST')return fail(405);
          if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return fail(415);
          const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)return fail(413);chunks.push(chunk)}
          let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return fail(400)}
          if(!body||typeof body!=='object'||Array.isArray(body))return fail(400);
          const value=body as {targetBotId?:unknown;message?:unknown};
          if(typeof value.targetBotId!=='string'||typeof value.message!=='string')return fail(400);
          if(!token||this.grants.get(token)!==grant||grant.expires<=Date.now())return fail(401);
          grant.handoffRemaining--;
          const handoff=await this.handoffs.send(scope,{targetBotId:value.targetBotId,message:value.message},signal);
          return handoff?reply(202,{handoff}):fail(409);
        } catch { return fail(409); }
      }
      if (memoryRoute) {
        const reply=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
        if(!this.memories||!grant.scope?.owner||!grant.scope.botId)return fail(404);
        grant.memoryRemaining--;
        const scope:BotMemoryRunScope={...grant.scope,owner:grant.scope.owner,botId:grant.scope.botId};
        const disconnected=new AbortController();res.once('close',()=>disconnected.abort());
        const signal=AbortSignal.any([grant.abort.signal,disconnected.signal,AbortSignal.timeout(10_000)]);
        try {
          if(req.method==='GET'&&!memoryMatch?.[1]) {
            const memories=await this.memories.list(scope,signal);
            return memories ? reply(200,{memories}) : fail(409);
          }
          if(req.method==='DELETE'&&memoryMatch?.[1]) {
            const forgotten=await this.memories.forget(scope,memoryMatch[1],signal);
            return forgotten===null?fail(409):forgotten?reply(200,{forgotten:true}):fail(404);
          }
          if(req.method!=='POST'||memoryMatch?.[1])return fail(405);
          if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return fail(415);
          const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)return fail(413);chunks.push(chunk)}
          let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return fail(400)}
          if(!body||typeof body!=='object'||Array.isArray(body))return fail(400);
          const payload=body as {action?:unknown;id?:unknown;title?:unknown;content?:unknown};
          if(payload.action==='remember') {
            const memory=await this.memories.remember(scope,payload.title,payload.content,payload.id,signal);
            return memory?reply(201,{memory}):fail(409);
          }
          if(payload.action==='forget'&&typeof payload.id==='string') {
            const forgotten=await this.memories.forget(scope,payload.id,signal);
            return forgotten===null?fail(409):forgotten?reply(200,{forgotten:true}):fail(404);
          }
          return fail(400);
        } catch { return fail(409); }
      }
      if (computerRoute) {
        const reply=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
        if(!this.computer||!grant.scope?.owner||!grant.scope.botId){console.error('Model gateway computer request failed',{code:'COMPUTER_GATEWAY_SCOPE_UNAVAILABLE',status:404});return fail(404)}
        const scope:RunScope={...grant.scope,owner:grant.scope.owner,botId:grant.scope.botId};
        const disconnected=new AbortController();res.once('close',()=>disconnected.abort());
        const signal=AbortSignal.any([grant.abort.signal,disconnected.signal,AbortSignal.timeout(30_000)]);
        try {
          if(req.method==='GET'&&req.url==='/v1/computer/control')return reply(200,await this.computer.control(scope,signal));
          if(req.method==='GET'&&req.url==='/v1/computer/inspect')return reply(200,await this.computer.inspect(scope,signal));
          if(req.method==='GET'&&req.url==='/v1/computer/screenshot'){
            const image=await this.computer.screenshot(scope,signal);res.writeHead(200,{'Content-Type':'image/png','Content-Length':image.length,'Cache-Control':'no-store'});return res.end(image);
          }
          if(req.method==='GET'&&computerMatch&&!computerMatch[2]){const status=await this.computer.status(scope,computerMatch[1],signal);return status?reply(200,{status}):fail(404)}
          if(req.method!=='POST'||(computerMatch&&!computerMatch[2]))return fail(405);
          if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return fail(415);
          const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16000)return fail(413);chunks.push(chunk)}
          let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return fail(400)}
          const action=body&&typeof body==='object'&&!Array.isArray(body)?(body as {action?:unknown}).action:undefined;
          if(!action||typeof action!=='object'||Array.isArray(action))return fail(400);
          if(!token||this.grants.get(token)!==grant||grant.expires<=Date.now())return fail(401);
          if(!computerMatch){if(grant.approvalsRemaining<=0)return fail(429);grant.approvalsRemaining--;return reply(201,await this.computer.propose(scope,action,signal))}
          return reply(200,await this.computer.execute(scope,computerMatch[1],action,signal));
        } catch (error) {
          const diagnostic=safeDiagnosticMetadata(error);
          console.error('Model gateway computer request failed',diagnostic);
          return reply(409,{error:'computer_request_failed',diagnostic});
        }
      }
      if (approvalRoute) {
        const reply = (status:number,value:unknown) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
        if (!this.approvals || !grant.scope || this.computer) return fail(404);
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
        const upstreamBase=this.upstream.href.replace(/\/+$/,'');
        const result = await this.requestUpstreamModel(`${upstreamBase}/chat/completions`, {
          method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(payload), signal: AbortSignal.any([grant.abort.signal, disconnected.signal, AbortSignal.timeout(120_000)]),
        });
        if(result.retryAfterSeconds!==undefined){
          grant.modelRateLimit={retryAfterSeconds:result.retryAfterSeconds};
          console.info('Model provider response',{code:result.response?'MODEL_UPSTREAM_RATE_LIMITED':'MODEL_UPSTREAM_RATE_LIMIT_COOLDOWN',status:429,retryAfterSeconds:result.retryAfterSeconds});
          await result.response?.body?.cancel().catch(()=>undefined);
          return replyRateLimited(res,result.retryAfterSeconds);
        }
        const upstream=result.response!;
        console.info('Model provider response',{code:upstream.ok&&upstream.body?'MODEL_UPSTREAM_OK':'MODEL_UPSTREAM_REJECTED',status:upstream.status});
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
