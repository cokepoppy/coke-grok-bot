import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { ModelGateway } from '../src/server/model-gateway.ts';
import { DshExecutor } from '../src/server/pi-executor.ts';
import type { AgentRun, RunOwner } from '../src/server/run-store.ts';

const owner:RunOwner={tenantId:randomUUID(),userId:randomUUID()};
const hash=createHash('sha256').update(`${owner.tenantId}:${owner.userId}`).digest('hex').slice(0,32);
const agentToken=randomBytes(32).toString('base64url');
const run:AgentRun={id:randomUUID(),botId:randomUUID(),prompt:'Summarize the task',status:'running',result:null};
const endpoint=new URL(`http://desktop.grok-user-${hash}.svc.cluster.local:8083/`);

test('DeepSeek Harness dispatch is owner-scoped and revokes its model capability',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const server=gateway.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No gateway');
 let issued='',calls=0;
 const request:typeof fetch=async(url,init)=>{
  calls++;assert.equal(String(url),`${endpoint.origin}/v1/tasks/run`);
  assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${agentToken}`);
  const body=JSON.parse(String(init?.body));issued=body.modelConfig.apiKey;
  assert.notEqual(issued,'test-provider-key');assert.equal(body.engine,'dsh');assert.equal(body.taskId,run.id);assert.equal(body.cwd,`tasks/${run.id}`);
  return Response.json({status:'done',message:`finished ${issued} ${agentToken}`});
 };
 try{
  const executor=new DshExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',request);
  const result=await executor.execute(owner,run,new AbortController().signal,randomUUID());
  assert.equal(calls,1);assert.equal(result.status,'completed');assert.equal(result.result,'finished [redacted] [redacted]');
  const after=await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`,{method:'POST',headers:{authorization:`Bearer ${issued}`,'content-type':'application/json'},body:JSON.stringify({model:'model',messages:[{role:'user',content:'hi'}]})});
  assert.equal(after.status,401);
 }finally{gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});

test('DeepSeek Harness preserves a confirmed failure and refuses uncertain outcomes',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const executor=new DshExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  assert.equal(JSON.parse(String(init?.body)).engine,'dsh');return Response.json({status:'failed',message:'The requested context was unavailable.'});
 });
 try{
  assert.deepEqual(await executor.execute(owner,run,new AbortController().signal,randomUUID()),{status:'failed',result:'The requested context was unavailable.'});
  const uncertain=new DshExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>Response.json({status:'waiting',pausedForControl:true,message:'Paused'}));
  await assert.rejects(uncertain.execute(owner,run,new AbortController().signal,randomUUID()),/reconciliation/);
 }finally{gateway.close()}
});
