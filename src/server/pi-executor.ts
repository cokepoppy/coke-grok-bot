import type { AgentRun, RunOwner } from './run-store.ts';
import type { RunExecutor, ExecutionResult } from './run-scheduler.ts';
import type { ModelGateway } from './model-gateway.ts';
import { createHash } from 'node:crypto';

export interface DesktopConnection { agentUrl: URL; agentToken: string }
export interface DesktopConnections { connect(owner:RunOwner, signal:AbortSignal):Promise<DesktopConnection> }

/** Dispatches once to a user's private desktop. Transport uncertainty is surfaced to the scheduler. */
export class PiExecutor implements RunExecutor {
  constructor(private readonly desktops:DesktopConnections, private readonly gateway:ModelGateway, private readonly gatewayUrl:string, private readonly model:string, private readonly request:typeof fetch = fetch) {
    const endpoint=new URL(gatewayUrl);
    if(endpoint.protocol!=='https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname!=='/v1' || !model) throw new Error('Invalid Pi gateway');
  }
  async execute(owner:RunOwner,run:AgentRun,signal:AbortSignal):Promise<ExecutionResult> {
    if(signal.aborted) throw new Error('Run stopped');
    const desktop=await this.desktops.connect(owner,signal);
    const endpoint=new URL(desktop.agentUrl);
    const ownerHash=createHash('sha256').update(`${owner.tenantId.toLowerCase()}:${owner.userId.toLowerCase()}`).digest('hex').slice(0,32);
    if(endpoint.protocol!=='http:' || endpoint.hostname!==`desktop.grok-user-${ownerHash}.svc.cluster.local` || endpoint.port!=='8083' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname!=='/' || !/^[A-Za-z0-9_-]{43}$/.test(desktop.agentToken)) throw new Error('Invalid desktop endpoint');
    const capability=this.gateway.issue({ttlMs:14*60_000,calls:100});
    try {
      const prompt=`${run.prompt}\n\nWhen your work finishes, return a JSON object with exactly these fields: {"status":"done","message":"<the user-facing result>"}. Report actual outcomes only. If work cannot be completed, explain it in message.`;
      const response=await this.request(new URL('/v1/tasks/run',endpoint),{
        method:'POST',redirect:'error',headers:{authorization:`Bearer ${desktop.agentToken}`,'content-type':'application/json'},
        body:JSON.stringify({engine:'pi',taskId:run.id,cwd:`tasks/${run.id}`,prompt,modelConfig:{apiKey:capability,baseUrl:this.gatewayUrl,model:this.model}}),
        signal:AbortSignal.any([signal,AbortSignal.timeout(14*60_000)]),
      });
      if (!response.ok) throw new Error('Desktop execution outcome could not be confirmed');
      const value:unknown=await response.json();
      if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Invalid desktop result');
      const result=value as {status?:unknown;message?:unknown;pausedForControl?:unknown};
      // A pause may have interrupted an operation after a side effect. Reconciliation is required.
      if (result.status!=='done' || result.pausedForControl===true || typeof result.message!=='string' || !result.message.trim()) throw new Error('Desktop outcome requires reconciliation');
      const safe=result.message.split(capability).join('[redacted]').split(desktop.agentToken).join('[redacted]').slice(0,20000);
      return {status:'completed',result:safe};
    } finally { this.gateway.revoke(capability); }
  }
}
