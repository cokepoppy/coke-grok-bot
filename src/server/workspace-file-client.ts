import { createHash } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { RunOwner } from './run-store.ts';
import type { DesktopConnections } from './pi-executor.ts';

export interface WorkspaceUploadResult { size: number; sha256: string }
export interface WorkspaceDownload { body: IncomingMessage; size: number }
export interface WorkspaceFileTransportApi {
  upload(owner: RunOwner, input: { id: string; extension: string; mimeType: string; size: number; body: IncomingMessage }, signal: AbortSignal): Promise<WorkspaceUploadResult>;
  download(owner: RunOwner, storageKey: string, signal: AbortSignal): Promise<WorkspaceDownload>;
  removeUpload(owner: RunOwner, id: string, extension: string, signal: AbortSignal): Promise<void>;
}

function validWorkspaceFileKey(value:string):boolean {
  if(/^shared\/uploads\/[a-f0-9-]{36}(?:\.[a-z0-9]{1,12})?$/i.test(value))return true;
  const parts=value.split('/');
  return parts.length>=4&&parts[0]==='tasks'&&/^[a-f0-9-]{36}$/i.test(parts[1])&&parts[2]==='artifacts'
    &&parts.slice(3).every(part=>part.length>0&&part.length<=180&&part!=='.'&&part!=='..'&&!part.startsWith('.')&&!part.includes('\\')&&!/[\u0000-\u001f\u007f]/.test(part))
    &&Buffer.byteLength(parts.slice(3).join('/'),'utf8')<=255;
}

export class WorkspaceFileTransportError extends Error {
  constructor(readonly diagnosticCode: string) {
    super('Workspace file transport failed');
    this.name = 'WorkspaceFileTransportError';
  }
}

function networkDiagnostic(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{1,48}$/.test(error.code)) return `AGENT_NETWORK_${error.code}`;
  return 'AGENT_NETWORK_ERROR';
}

/** Streams file bytes between the authenticated web request and the owner's private K3D Agent Pod. */
export class WorkspaceFileTransport implements WorkspaceFileTransportApi {
  constructor(private readonly desktops: DesktopConnections, private readonly request: typeof httpRequest = httpRequest) {}

  async upload(owner: RunOwner, input: { id: string; extension: string; mimeType: string; size: number; body: IncomingMessage }, signal: AbortSignal): Promise<WorkspaceUploadResult> {
    let connection: { endpoint: URL; token: string };
    try { connection = await this.connection(owner, signal); }
    catch { throw new WorkspaceFileTransportError('BROKER_CONNECT'); }
    const { endpoint, token } = connection;
    if (!/^[a-f0-9-]{36}$/i.test(input.id) || (input.extension && !/^[a-z0-9]{1,12}$/i.test(input.extension)) || !Number.isSafeInteger(input.size) || input.size < 1 || !/^[\w.+-]+\/[\w.+-]+$/.test(input.mimeType)) throw new WorkspaceFileTransportError('INVALID_UPLOAD');
    const suffix = input.extension ? `.${input.extension.toLowerCase()}` : '';
    const target = new URL(`/v1/workspace/uploads/${input.id}${suffix}`, endpoint);
    return new Promise<WorkspaceUploadResult>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, result?: WorkspaceUploadResult) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        input.body.removeListener('aborted', onBodyAborted);
        error ? reject(error) : resolve(result!);
      };
      const upstream = this.request(target, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': input.mimeType, 'content-length': String(input.size) }, signal, timeout: 5 * 60_000 }, response => {
        const chunks: Buffer[] = []; let received = 0;
        response.on('data', (chunk: Buffer) => { received += chunk.length; if (received > 4096) { response.destroy(new Error('Agent response too large')); return; } chunks.push(chunk); });
        response.on('error', error => finish(new WorkspaceFileTransportError(networkDiagnostic(error))));
        response.on('end', () => {
          if (response.statusCode !== 201) return finish(new WorkspaceFileTransportError(`AGENT_HTTP_${response.statusCode || 0}`));
          try {
            const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
            const result = value as { size?: unknown; sha256?: unknown };
            if (result.size !== input.size || typeof result.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(result.sha256)) throw new Error();
            finish(undefined, { size: result.size, sha256: result.sha256.toLowerCase() });
          } catch { finish(new WorkspaceFileTransportError('AGENT_INVALID_RECEIPT')); }
        });
      });
      const onAbort = () => { upstream.destroy(); input.body.destroy(); finish(new WorkspaceFileTransportError('CANCELLED')); };
      const onBodyAborted = () => upstream.destroy(new Error('Client upload was interrupted'));
      signal.addEventListener('abort', onAbort, { once: true });
      input.body.once('aborted', onBodyAborted);
      upstream.on('error', error => finish(new WorkspaceFileTransportError(networkDiagnostic(error))));
      upstream.on('timeout', () => { upstream.destroy(); finish(new WorkspaceFileTransportError('AGENT_TIMEOUT')); });
      input.body.on('error', error => upstream.destroy(error));
      input.body.pipe(upstream);
    });
  }

  async download(owner: RunOwner, storageKey: string, signal: AbortSignal): Promise<WorkspaceDownload> {
    const { endpoint, token } = await this.connection(owner, signal);
    if (!validWorkspaceFileKey(storageKey)) throw new Error('Invalid workspace file');
    const target = new URL('/v1/workspace/file', endpoint); target.searchParams.set('key', storageKey);
    return new Promise<WorkspaceDownload>((resolve, reject) => {
      const upstream = this.request(target, { method: 'GET', headers: { authorization: `Bearer ${token}` }, signal, timeout: 5 * 60_000 }, response => {
        if (response.statusCode !== 200 || !/^\d+$/.test(response.headers['content-length'] || '')) {
          response.resume();
          return reject(new Error('Workspace file is unavailable'));
        }
        const size = Number(response.headers['content-length']);
        if (!Number.isSafeInteger(size) || size < 0 || size > 1024 * 1024 * 1024) { response.destroy(); return reject(new Error('Workspace file is unavailable')); }
        resolve({ body: response, size });
      });
      upstream.on('error', reject);
      upstream.on('timeout', () => upstream.destroy(new Error('Agent download timed out')));
      upstream.end();
    });
  }

  async removeUpload(owner: RunOwner, id: string, extension: string, signal: AbortSignal): Promise<void> {
    const { endpoint, token } = await this.connection(owner, signal);
    if (!/^[a-f0-9-]{36}$/i.test(id) || (extension && !/^[a-z0-9]{1,12}$/i.test(extension))) throw new Error('Invalid workspace upload');
    const target = new URL(`/v1/workspace/uploads/${id}${extension ? `.${extension.toLowerCase()}` : ''}`, endpoint);
    await new Promise<void>((resolve, reject) => {
      const upstream = this.request(target, { method: 'DELETE', headers: { authorization: `Bearer ${token}` }, signal, timeout: 30_000 }, response => {
        response.resume();
        response.once('end', () => response.statusCode === 200 ? resolve() : reject(new Error('Workspace upload cleanup failed')));
        response.once('error', reject);
      });
      upstream.once('error', reject);
      upstream.once('timeout', () => upstream.destroy(new Error('Agent cleanup timed out')));
      upstream.end();
    });
  }

  private async connection(owner: RunOwner, signal: AbortSignal): Promise<{ endpoint: URL; token: string }> {
    const desktop = await this.desktops.connect(owner, signal);
    const endpoint = new URL(desktop.agentUrl);
    const ownerHash=createHash('sha256').update(`${owner.tenantId.toLowerCase()}:${owner.userId.toLowerCase()}`).digest('hex').slice(0,32);
    if (endpoint.protocol !== 'http:' || ![`agent.grok-user-${ownerHash}.svc.cluster.local`,`desktop.grok-user-${ownerHash}.svc.cluster.local`].includes(endpoint.hostname) || endpoint.port !== '8083' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || !/^[A-Za-z0-9_-]{43}$/.test(desktop.agentToken)) throw new Error('Invalid desktop file endpoint');
    return { endpoint, token: desktop.agentToken };
  }
}
