import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { Agent } from 'undici';
import { ModelGateway } from '../src/server/model-gateway.ts';
import { AGENT_TASK_TRANSPORT_TIMEOUT_MS, classifyAgentRejection, PiExecutor } from '../src/server/pi-executor.ts';
import { RunDiagnosticError } from '../src/server/run-diagnostics.ts';
import type { BotMemory, BotMemoryStore } from '../src/server/bot-memory-store.ts';
import type { BotHandoffStore } from '../src/server/bot-handoff-store.ts';
import type { AgentRun, RunOwner } from '../src/server/run-store.ts';
const owner:RunOwner={tenantId:randomUUID(),userId:randomUUID()};
const hash=createHash('sha256').update(`${owner.tenantId}:${owner.userId}`).digest('hex').slice(0,32);
const agentToken=randomBytes(32).toString('base64url');
const run:AgentRun={id:randomUUID(),botId:randomUUID(),prompt:'Make a file',status:'running',result:null,recoveryState:'none',replacementRunId:null,files:[]};
const screen={...owner,botId:run.botId};
const endpoint=new URL(`http://desktop.grok-user-${hash}.svc.cluster.local:8083/`);

test('Agent rejection diagnostics expose only fixed classes, never response text',()=>{
 assert.equal(classifyAgentRejection('desktop control state is unavailable'),'computer_control_unavailable');
 assert.equal(classifyAgentRejection('Agent adapter exited with code 1: provider response includes secret-value'),'agent_adapter_failed');
 assert.equal(classifyAgentRejection('Group task context is invalid'),'group_context_invalid');
 assert.equal(classifyAgentRejection('sensitive provider detail'),'unknown_agent_rejection');
 assert.equal(classifyAgentRejection(undefined),'unknown_agent_rejection');
});

test('Pi dispatch is once, scoped to owner and revokes its capability after completion',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const server=gateway.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No gateway');
 let issued='',calls=0;
 const request:typeof fetch=async (url,init)=>{
  calls++;assert.equal(String(url),`${endpoint.origin}/v1/tasks/run`);
  assert.ok(init?.dispatcher instanceof Agent);assert.equal(AGENT_TASK_TRANSPORT_TIMEOUT_MS,15*60_000);
  assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${agentToken}`);
  const body=JSON.parse(String(init?.body));issued=body.modelConfig.apiKey;
  assert.notEqual(issued,'test-provider-key');assert.equal(body.engine,'pi');assert.equal(body.taskId,run.id);assert.equal(body.botId,run.botId);assert.equal(body.screenId,run.botId);assert.equal(body.cwd,`tasks/${run.id}`);
  return Response.json({status:'done',message:`finished ${issued} ${agentToken}`});
 };
 try{
  const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',request);
  const result=await executor.execute(screen,run,new AbortController().signal,randomUUID());
  assert.equal(calls,1);assert.equal(result.status,'completed');assert.equal(result.result,'finished [redacted] [redacted]');
  const after=await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`,{method:'POST',headers:{authorization:`Bearer ${issued}`,'content-type':'application/json'},body:JSON.stringify({model:'model',messages:[{role:'user',content:'hi'}]})});
  assert.equal(after.status,401);
 }finally{gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});

test('Pi sends an explicit Gmail navigation and user sign-in handoff instruction to the Agent',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const gmailRun:AgentRun={...run,prompt:'帮我打开谷歌，然后登录我的 Gmail，登录时停下来让我操作。'};
 let receivedPrompt='';
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  const body=JSON.parse(String(init?.body));receivedPrompt=body.prompt;
  assert.equal(body.prompt.includes(gmailRun.prompt),true);
  return Response.json({status:'done',message:'Gmail is open for sign-in.'});
 });
 try{
  const result=await executor.execute(screen,gmailRun,new AbortController().signal,randomUUID());
  assert.equal(result.result,'Gmail is open for sign-in.');
  assert.match(receivedPrompt,/https:\/\/mail\.google\.com/);
  assert.match(receivedPrompt,/Use computer_browser\.navigate/);
  assert.match(receivedPrompt,/stop at the sign-in page|stop there.*take control/i);
  assert.match(receivedPrompt,/open the Computer screen and choose Take control/i);
  assert.match(receivedPrompt,/do not claim control has already transferred/i);
  assert.match(receivedPrompt,/This run ends at a user sign-in handoff/i);
  assert.match(receivedPrompt,/never enter or request their credentials/i);
 }finally{await executor.close();gateway.close()}
});

test('Pi grants generic Browser User scope for an unregistered app named in the user task',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const task:AgentRun={...run,prompt:'Search Slack for the latest project channel.'};
 let issuedScope:{browserTask?:boolean;requestedNavigationOrigins?:readonly string[]}|undefined,receivedPrompt='';
 const issue=gateway.issue.bind(gateway);
 gateway.issue=options=>{issuedScope=options.scope;return issue(options)};
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  receivedPrompt=JSON.parse(String(init?.body)).prompt;
  return Response.json({status:'done',message:'Search task dispatched.'});
 });
 try{
  const result=await executor.execute(screen,task,new AbortController().signal,randomUUID());
  assert.equal(result.status,'completed');
  assert.equal(issuedScope?.browserTask,true,"the user's direct task must produce the generic Browser User capability");
  assert.deepEqual(issuedScope?.requestedNavigationOrigins,[],'an unknown service does not need a site-specific origin entry');
  assert.match(receivedPrompt,/explicitly requested a browser task in this run/i);
  assert.match(receivedPrompt,/generic user-request scope/i);
 }finally{await executor.close();gateway.close()}
});

test('Pi carries a recent same-Bot sign-in handoff into an approval follow-up without expanding its scope',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const original='帮我打开谷歌，然后登录我的 Gmail，然后你在登录的时候停下来，让我去操作。在云电脑里面打开 Chrome 浏览器。';
 const followup:AgentRun={...run,prompt:'不需要我的批准呢，你直接去打开它，你不要每步都让我批准。',previousPrompts:[original]};
 let receivedPrompt='';
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  receivedPrompt=JSON.parse(String(init?.body)).prompt;
  return Response.json({status:'done',message:'Stopped at Google sign-in for you to take control.'});
 });
 try{
  const result=await executor.execute(screen,followup,new AbortController().signal,randomUUID());
  assert.equal(result.status,'completed');
  assert.match(receivedPrompt,/https:\/\/accounts\.google\.com/);
  assert.match(receivedPrompt,/continues the user's recent sign-in handoff/i);
  assert.match(receivedPrompt,/open the Computer screen and choose Take control/i);
  assert.match(receivedPrompt,/Once the sign-in or human-verification page is visible, stop/i);
  assert.match(receivedPrompt,/Do not interpret the request to avoid repeated approvals as permission to enter credentials/i);
 }finally{await executor.close();gateway.close()}
});

test('Pi does not carry a sign-in handoff across an intervening same-Bot task',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const original='帮我打开谷歌，然后登录我的 Gmail，然后你在登录的时候停下来，让我去操作。';
 const followup:AgentRun={...run,prompt:'不需要我的批准呢，你直接去打开它，你不要每步都让我批准。',previousPrompts:[original,'Tell me whether it will rain tomorrow.']};
 let receivedPrompt='';
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  receivedPrompt=JSON.parse(String(init?.body)).prompt;
  return Response.json({status:'done',message:'The unrelated task is complete.'});
 });
 try{
  const result=await executor.execute(screen,followup,new AbortController().signal,randomUUID());
  assert.equal(result.status,'completed');
  assert.doesNotMatch(receivedPrompt,/https:\/\/accounts\.google\.com/);
  assert.doesNotMatch(receivedPrompt,/continues the user's recent sign-in handoff/i);
 }finally{await executor.close();gateway.close()}
});

test('Pi routes a selected direct-chat Bot mention by stable ID while preserving the visible user prompt',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const target={id:randomUUID(),name:'Dex',label:'Research'};
 const leaseId=randomUUID(),mentionedRun:AgentRun={...run,prompt:'Please ask @Dex to research this topic.',runtimeContext:{kind:'bot-mentions',targets:[target]}};
 const handoffs={listTargets:async()=>[target]} as unknown as BotHandoffStore;
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  const body=JSON.parse(String(init?.body));
  assert.equal(body.prompt.includes(mentionedRun.prompt),true);
  assert.match(body.prompt,new RegExp(`Bot ID ${target.id}`));
  assert.equal(body.runtimeContext,undefined);
  assert.deepEqual(body.handoffs.bots,[target]);
  return Response.json({status:'done',message:'Dex returned its findings.'});
 },undefined,handoffs);
 try{
  const result=await executor.execute(screen,mentionedRun,new AbortController().signal,leaseId);
  assert.deepEqual(result,{status:'completed',result:'Dex returned its findings.'});
 }finally{await executor.close();gateway.close()}
});

test('Pi task transport uses the configured long-response dispatcher with Node fetch',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const server=createServer((_request,response)=>{setTimeout(()=>{response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({status:'done',message:'Delayed task completed.'}))},75)});
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No agent test server');
 const request:typeof fetch=(_url,init)=>fetch(`http://127.0.0.1:${address.port}/v1/tasks/run`,init);
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',request);
 try{
  assert.equal(AGENT_TASK_TRANSPORT_TIMEOUT_MS,15*60_000);
  assert.deepEqual(await executor.execute(screen,run,new AbortController().signal,randomUUID()),{status:'completed',result:'Delayed task completed.'});
 }finally{await executor.close();gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});

test('Pi maps a gateway rate limit to a fixed run diagnostic without reading Agent error text',async()=>{
 let upstreamCalls=0,agentCalls=0;
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>{
  upstreamCalls++;return new Response('provider quota details must stay private',{status:429,headers:{'retry-after':'12'}});
 });
 const server=gateway.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No gateway');
 const gatewayUrl=`http://127.0.0.1:${address.port}/v1/chat/completions`;
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  agentCalls++;const request=JSON.parse(String(init?.body)) as {modelConfig:{apiKey:string}};
  const response=await fetch(gatewayUrl,{method:'POST',headers:{authorization:`Bearer ${request.modelConfig.apiKey}`,'content-type':'application/json'},body:JSON.stringify({model:'model',messages:[{role:'user',content:'hello'}]})});
  assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'12');
  assert.equal((await response.text()).includes('provider quota details'),false);
  return new Response('Agent internal error: provider quota details must stay private',{status:400});
 });
 try{
  await assert.rejects(executor.execute(screen,run,new AbortController().signal,randomUUID()),error=>error instanceof RunDiagnosticError&&error.diagnosticCode==='model_upstream_429'&&!error.message.includes('provider quota details'));
  assert.equal(upstreamCalls,1);assert.equal(agentCalls,1);
 }finally{await executor.close();gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});

test('Pi dispatch fails closed for wrong owner, transport error or interrupted desktop',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const wrong=new PiExecutor({connect:async()=>({agentUrl:new URL('http://other.svc.cluster.local:8083/'),agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>{throw new Error('must not dispatch')});
 await assert.rejects(wrong.execute(screen,run,new AbortController().signal,randomUUID()));
 let calls=0;
 const interrupted=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>{calls++;return Response.json({status:'waiting',pausedForControl:true,message:'paused'})});
 await assert.rejects(interrupted.execute(screen,run,new AbortController().signal,randomUUID()),error=>error instanceof RunDiagnosticError&&error.diagnosticCode==='agent_paused_for_control');assert.equal(calls,1);
 const unexpected=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>Response.json({status:'running',message:'Still running'}));
 await assert.rejects(unexpected.execute(screen,run,new AbortController().signal,randomUUID()),error=>error instanceof RunDiagnosticError&&error.diagnosticCode==='agent_result_status_unconfirmed');
 const missing=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>Response.json({status:'done',message:'  '}));
 await assert.rejects(missing.execute(screen,run,new AbortController().signal,randomUUID()),error=>error instanceof RunDiagnosticError&&error.diagnosticCode==='agent_result_message_missing');
 const transport=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>{calls++;throw new Error('unconfirmed')});
 await assert.rejects(transport.execute(screen,run,new AbortController().signal,randomUUID()),error=>error instanceof RunDiagnosticError&&error.diagnosticCode==='agent_transport_failed');assert.equal(calls,2);
 const unauthorized=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>new Response('{"error":"credential value must not be persisted"}',{status:401}));
 await assert.rejects(unauthorized.execute(screen,run,new AbortController().signal,randomUUID()),error=>error instanceof RunDiagnosticError&&error.diagnosticCode==='agent_http_401'&&!error.message.includes('credential'));gateway.close();
});

test('Pi reports a confirmed failure as failed rather than completed',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.match(body.prompt,/use failed if it could not be completed/i);return Response.json({status:'failed',message:'Could not access the requested page.'})});
 try{assert.deepEqual(await executor.execute(screen,run,new AbortController().signal,randomUUID()),{status:'failed',result:'Could not access the requested page.'})}finally{gateway.close()}
});

test('Pi forwards tenant attachment metadata and returns only Agent-reported artifact descriptors',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const attached={...run,files:[{id:randomUUID(),name:'notes.txt',mimeType:'text/plain',size:12,sha256:'a'.repeat(64),storageKey:`shared/uploads/${randomUUID()}.txt`,kind:'input' as const}]};
 const artifact={name:'summary.txt',mimeType:'text/plain',size:9,sha256:'b'.repeat(64),storageKey:`tasks/${run.id}/artifacts/summary.txt`};
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  const body=JSON.parse(String(init?.body));assert.deepEqual(body.attachments,attached.files.filter(file=>file.kind==='input').map(({kind,...file})=>file));return Response.json({status:'done',message:'Read the file and wrote a summary.',files:[artifact]});
 });
 try{assert.deepEqual(await executor.execute(screen,attached,new AbortController().signal,randomUUID()),{status:'completed',result:'Read the file and wrote a summary.',artifacts:[artifact]})}finally{gateway.close()}
});

test('Pi persists an explicit durable memory request before dispatch and reports the committed result',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const leaseId=randomUUID(),stored:BotMemory={id:randomUUID(),title:'Bot preference',content:'when I ask for an acceptance marker, use exactly GKBOT_TEST_MARKER.',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 const memoryCalls:Array<{scope:unknown;title:unknown;content:unknown}>=[];
 const memories={list:async()=>[],remember:async(scope:unknown,title:unknown,content:unknown)=>{memoryCalls.push({scope,title,content});return stored},forget:async()=>true} as unknown as BotMemoryStore;
 const explicitRun={...run,prompt:'Please remember this lasting preference for this Bot: when I ask for an acceptance marker, use exactly GKBOT_TEST_MARKER. This is a synthetic test value, not a secret. Confirm after saving it. Do not use the computer.'};
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  const body=JSON.parse(String(init?.body));assert.equal(body.memory.mode,'mediated');assert.match(body.prompt,/Saved memory for this Bot/);assert.match(body.prompt,/GKBOT_TEST_MARKER/);return Response.json({status:'done',message:'I will use GKBOT_TEST_MARKER.'});
 },memories);
 try{
  const result=await executor.execute(screen,explicitRun,new AbortController().signal,leaseId);
  assert.equal(memoryCalls.length,1);assert.equal(memoryCalls[0].title,'Bot preference');assert.match(String(memoryCalls[0].content),/GKBOT_TEST_MARKER/);
  assert.deepEqual(memoryCalls[0].scope,{runId:run.id,leaseId,botId:run.botId,owner:{...owner,botId:run.botId}});assert.equal(result.result,'I will use GKBOT_TEST_MARKER.\n\nSaved to this Bot’s memory.');
 }finally{gateway.close()}
});

test('Pi never persists a sensitive explicit memory and reports that accurately',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const memoryCalls:{remember:number}={remember:0};
 const memories={list:async()=>[],remember:async()=>{memoryCalls.remember++;return null},forget:async()=>true} as unknown as BotMemoryStore;
 const sensitiveRun={...run,prompt:'Please remember this lasting preference for this Bot: my password is synthetic-placeholder-value. This is a synthetic test value, not a secret. Confirm after saving it. Do not use the computer.'};
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  const body=JSON.parse(String(init?.body));assert.match(body.prompt,/explicit memory request was not saved because it contains sensitive information/i);return Response.json({status:'done',message:'Saved successfully.'});
 },memories);
 try{
  const result=await executor.execute(screen,sensitiveRun,new AbortController().signal,randomUUID());assert.equal(memoryCalls.remember,0);assert.match(result.result,/This memory was not saved/);
 }finally{gateway.close()}
});
