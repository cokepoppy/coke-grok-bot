import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { ModelGateway } from '../src/server/model-gateway.ts';
import { PiExecutor } from '../src/server/pi-executor.ts';
import { RunDiagnosticError } from '../src/server/run-diagnostics.ts';
import type { AgentRun, RunOwner } from '../src/server/run-store.ts';
const owner:RunOwner={tenantId:randomUUID(),userId:randomUUID()};
const hash=createHash('sha256').update(`${owner.tenantId}:${owner.userId}`).digest('hex').slice(0,32);
const agentToken=randomBytes(32).toString('base64url');
const run:AgentRun={id:randomUUID(),botId:randomUUID(),prompt:'Make a file',status:'running',result:null,recoveryState:'none',replacementRunId:null,files:[]};
const endpoint=new URL(`http://desktop.grok-user-${hash}.svc.cluster.local:8083/`);

test('Pi dispatch is once, scoped to owner and revokes its capability after completion',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const server=gateway.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No gateway');
 let issued='',calls=0;
 const request:typeof fetch=async (url,init)=>{
  calls++;assert.equal(String(url),`${endpoint.origin}/v1/tasks/run`);
  assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${agentToken}`);
  const body=JSON.parse(String(init?.body));issued=body.modelConfig.apiKey;
  assert.notEqual(issued,'test-provider-key');assert.equal(body.engine,'pi');assert.equal(body.taskId,run.id);assert.equal(body.cwd,`tasks/${run.id}`);
  return Response.json({status:'done',message:`finished ${issued} ${agentToken}`});
 };
 try{
  const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',request);
  const result=await executor.execute(owner,run,new AbortController().signal,randomUUID());
  assert.equal(calls,1);assert.equal(result.status,'completed');assert.equal(result.result,'finished [redacted] [redacted]');
  const after=await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`,{method:'POST',headers:{authorization:`Bearer ${issued}`,'content-type':'application/json'},body:JSON.stringify({model:'model',messages:[{role:'user',content:'hi'}]})});
  assert.equal(after.status,401);
 }finally{gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});

test('Pi dispatch fails closed for wrong owner, transport error or interrupted desktop',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const wrong=new PiExecutor({connect:async()=>({agentUrl:new URL('http://other.svc.cluster.local:8083/'),agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>{throw new Error('must not dispatch')});
 await assert.rejects(wrong.execute(owner,run,new AbortController().signal,randomUUID()));
 let calls=0;
 const interrupted=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>{calls++;return Response.json({status:'waiting',pausedForControl:true,message:'paused'})});
 await assert.rejects(interrupted.execute(owner,run,new AbortController().signal,randomUUID()),error=>error instanceof RunDiagnosticError&&error.diagnosticCode==='agent_result_unconfirmed');assert.equal(calls,1);
 const transport=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>{calls++;throw new Error('unconfirmed')});
 await assert.rejects(transport.execute(owner,run,new AbortController().signal,randomUUID()),error=>error instanceof RunDiagnosticError&&error.diagnosticCode==='agent_transport_failed');assert.equal(calls,2);
 const unauthorized=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>new Response('{"error":"credential value must not be persisted"}',{status:401}));
 await assert.rejects(unauthorized.execute(owner,run,new AbortController().signal,randomUUID()),error=>error instanceof RunDiagnosticError&&error.diagnosticCode==='agent_http_401'&&!error.message.includes('credential'));gateway.close();
});

test('Pi reports a confirmed failure as failed rather than completed',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.match(body.prompt,/use failed if it could not be completed/i);return Response.json({status:'failed',message:'Could not access the requested page.'})});
 try{assert.deepEqual(await executor.execute(owner,run,new AbortController().signal,randomUUID()),{status:'failed',result:'Could not access the requested page.'})}finally{gateway.close()}
});

test('Pi forwards tenant attachment metadata and returns only Agent-reported artifact descriptors',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const attached={...run,files:[{id:randomUUID(),name:'notes.txt',mimeType:'text/plain',size:12,sha256:'a'.repeat(64),storageKey:`shared/uploads/${randomUUID()}.txt`,kind:'input' as const}]};
 const artifact={name:'summary.txt',mimeType:'text/plain',size:9,sha256:'b'.repeat(64),storageKey:`tasks/${run.id}/artifacts/summary.txt`};
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  const body=JSON.parse(String(init?.body));assert.deepEqual(body.attachments,attached.files.filter(file=>file.kind==='input').map(({kind,...file})=>file));return Response.json({status:'done',message:'Read the file and wrote a summary.',files:[artifact]});
 });
 try{assert.deepEqual(await executor.execute(owner,attached,new AbortController().signal,randomUUID()),{status:'completed',result:'Read the file and wrote a summary.',artifacts:[artifact]})}finally{gateway.close()}
});
