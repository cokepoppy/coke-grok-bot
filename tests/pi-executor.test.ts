import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { Agent } from 'undici';
import { ModelGateway } from '../src/server/model-gateway.ts';
import { AGENT_TASK_TRANSPORT_TIMEOUT_MS, classifyAgentRejection, DshExecutor, PiExecutor } from '../src/server/pi-executor.ts';
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

test('Pi logs an allowlisted attachment reason code without logging Agent response text',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const body=Buffer.from(JSON.stringify({error:'Task attachment is unavailable at a private workspace path',code:'task_attachment_source_unavailable'}));
 const response=new Response(body,{status:400,headers:{'content-type':'application/json','content-length':String(body.length)}});
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>response);
 const warnings:unknown[][]=[];const originalWarn=console.warn;
 console.warn=(...args)=>{warnings.push(args)};
 try {
  await assert.rejects(executor.execute(screen,run,new AbortController().signal,randomUUID()),error=>error instanceof RunDiagnosticError&&error.diagnosticCode==='agent_http_400');
 } finally {console.warn=originalWarn;gateway.close()}
 assert.deepEqual(warnings,[['Agent task endpoint rejected request',{status:400,code:'task_attachments_invalid',reasonCode:'task_attachment_source_unavailable'}]]);
});

test('Pi and DSH preload only enabled Skills named by the direct message and scope mutations to that request',async()=>{
 for(const [engine,Executor] of [['pi',PiExecutor],['dsh',DshExecutor]] as const){
  const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
  const selected:AgentRun={...run,prompt:'Use the BSE review Skill to inspect the current rule.'};
  const skill={id:randomUUID(),creatorBotId:run.botId,name:'BSE review',description:'Review a current rule change.',instructions:'Check the official rule, effective date, required UI behavior, and evidence.',visibility:'private' as const,enabled:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  let requestBody:Record<string,unknown>|undefined,scope:unknown;
  const issue=gateway.issue.bind(gateway);gateway.issue=options=>{scope=options.scope;return issue(options)};
  const skills={listForRun:async(value:unknown)=>{const actual=value as {owner:RunOwner;botId:string;runId:string;leaseId:string};assert.equal(actual.owner.tenantId,owner.tenantId);assert.equal(actual.owner.userId,owner.userId);assert.equal(actual.botId,run.botId);assert.equal(actual.runId,run.id);assert.match(actual.leaseId,/^[a-f0-9-]{36}$/i);return[skill]}} as never;
  const executor=new Executor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{requestBody=JSON.parse(String(init?.body));return Response.json({status:'done',message:'Skill prompt sent.'})},undefined,undefined,undefined,skills);
  try{
   const result=await executor.execute(screen,selected,new AbortController().signal,randomUUID());assert.equal(result.status,'completed');
   const payload=requestBody as {prompt:string;skills?:unknown};assert.match(payload.prompt,/BSE review/);assert.match(payload.prompt,/official rule, effective date/);assert.match(payload.prompt,/untrusted workflow references/);assert.deepEqual(payload.skills,{mode:'mediated',actions:['list','create','update','delete']});
   assert.deepEqual((scope as {skillMutations?:unknown})?.skillMutations,{create:false,update:false,delete:false});
  }finally{await executor.close();gateway.close()}

  const createTask:AgentRun={...run,prompt:'Save this process as a skill called BSE review.'};let createScope:{skillMutations?:unknown}|undefined;
  const gateway2=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));const issue2=gateway2.issue.bind(gateway2);gateway2.issue=options=>{createScope=options.scope;return issue2(options)};
  const executor2=new Executor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway2,'https://gateway.example.test/v1','model',async()=>Response.json({status:'done',message:'saved request scoped'}),undefined,undefined,undefined,skills);
  try{await executor2.execute(screen,createTask,new AbortController().signal,randomUUID());assert.deepEqual(createScope?.skillMutations,{create:true,update:false,delete:false})}finally{await executor2.close();gateway2.close()}
 }
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
  assert.match(receivedPrompt,/Browser User and Computer User are available for every task/i);
  assert.match(receivedPrompt,/without per-step approvals/i);
  assert.match(receivedPrompt,/open the Computer screen and choose Take control/i);
  assert.match(receivedPrompt,/Pause only at a real sign-in or a request to enter a password/i);
  assert.match(receivedPrompt,/do not enter or request credentials/i);
 }finally{await executor.close();gateway.close()}
});

test('Pi exposes computer actions without URL or prompt-word classifiers and pauses only for human verification',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const task:AgentRun={...run,prompt:'Make a file'};
 let issuedScope:unknown,receivedPrompt='';
 const issue=gateway.issue.bind(gateway);
 gateway.issue=options=>{issuedScope=options.scope;return issue(options)};
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  receivedPrompt=JSON.parse(String(init?.body)).prompt;
  return Response.json({status:'done',message:'Search task dispatched.'});
 });
 try{
  const result=await executor.execute(screen,task,new AbortController().signal,randomUUID());
  assert.equal(result.status,'completed');
  assert.doesNotMatch(JSON.stringify(issuedScope),/browserTask|requestedNavigationOrigins|signInHandoff|gmailReadDraftWorkflow/,'the task capability contains no prompt-derived browser permissions');
  assert.match(receivedPrompt,/Browser User and Computer User are available for every task/i);
  assert.match(receivedPrompt,/Do not use URL, site, prompt-wording, control, or action classifiers/i);
  assert.match(receivedPrompt,/page or desktop controls needed for the user's task without per-step approvals/i);
  assert.match(receivedPrompt,/Pause only at a real sign-in or a request to enter a password/i);
  assert.match(receivedPrompt,/Do not enter or request credentials/i);
 }finally{await executor.close();gateway.close()}
});

test('Pi does not classify user wording to decide whether ordinary browser actions are enabled',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const task:AgentRun={...run,prompt:'请在云电脑里打开 Chrome，访问 https://c-m-ai-copilot.github.io/coke-bse-trading-demo/ 并点击边界校验。不要登录，不要连接真实系统，不要提交订单。若按钮不可用，请停止并报告实际看到的控件。'};
 let issuedScope:unknown,receivedPrompt='';
 const issue=gateway.issue.bind(gateway);gateway.issue=options=>{issuedScope=options.scope;return issue(options)};
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  receivedPrompt=JSON.parse(String(init?.body)).prompt;
  return Response.json({status:'done',message:'Boundary validation task dispatched.'});
 });
 try{
  const result=await executor.execute(screen,task,new AbortController().signal,randomUUID());
  assert.equal(result.status,'completed');
  assert.doesNotMatch(JSON.stringify(issuedScope),/browserTask|requestedNavigationOrigins|signInHandoff|gmailReadDraftWorkflow/,'permissions are not derived from the current prompt wording or URL');
  assert.match(receivedPrompt,/Do not use URL, site, prompt-wording, control, or action classifiers/i);
  assert.match(receivedPrompt,/ordinary actions are allowed/i);
 }finally{await executor.close();gateway.close()}
});

test('Pi supports an ordinary Chinese mail request without explicit browser wording',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const task:AgentRun={...run,prompt:'找一封最近未读的邮件，点击进去详情，然后看看，帮我拟写一个回复呀。'};
 let issuedScope:unknown,receivedPrompt='';
 const issue=gateway.issue.bind(gateway);gateway.issue=options=>{issuedScope=options.scope;return issue(options)};
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  receivedPrompt=JSON.parse(String(init?.body)).prompt;
  return Response.json({status:'done',message:'Mail task dispatched.'});
 });
 try{
  const result=await executor.execute(screen,task,new AbortController().signal,randomUUID());
  assert.equal(result.status,'completed');
  assert.doesNotMatch(JSON.stringify(issuedScope),/browserTask|requestedNavigationOrigins|signInHandoff|gmailReadDraftWorkflow/,'natural-language phrasing does not control the task capability');
  assert.match(receivedPrompt,/Browser User and Computer User are available for every task/i);
  assert.match(receivedPrompt,/without per-step approvals/i);
  assert.doesNotMatch(receivedPrompt,/Never send or forward, delete, archive/i);
 }finally{await executor.close();gateway.close()}
});

test('Pi does not require tool names to enable Browser User artifact preview',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const task:AgentRun={...run,prompt:'请完成页面后用 computer_browser.open_artifact 打开本次任务 artifacts/bse-demo/index.html，并检查页面标题与委托控件。'};
 let issuedScope:unknown,receivedPrompt='';
 const issue=gateway.issue.bind(gateway);gateway.issue=options=>{issuedScope=options.scope;return issue(options)};
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  receivedPrompt=JSON.parse(String(init?.body)).prompt;
  return Response.json({status:'done',message:'Artifact preview dispatched.'});
 });
 try{
  const result=await executor.execute(screen,task,new AbortController().signal,randomUUID());
  assert.equal(result.status,'completed');
  assert.doesNotMatch(JSON.stringify(issuedScope),/browserTask|requestedNavigationOrigins|signInHandoff|gmailReadDraftWorkflow/,'artifact preview is not gated by a task classifier');
  assert.match(receivedPrompt,/Do not enter or request credentials/i);
  assert.match(receivedPrompt,/Pause only at a real sign-in or a request to enter a password/i);
 }finally{await executor.close();gateway.close()}
});

test('Pi carries a recent same-Bot sign-in handoff into a continuation without adding an action gate',async()=>{
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
  assert.doesNotMatch(receivedPrompt,/https:\/\/accounts\.google\.com/);
  assert.match(receivedPrompt,/continued this same Bot task/i);
  assert.match(receivedPrompt,/never claim the handoff completed without checking ownership/i);
  assert.match(receivedPrompt,/open the Computer screen and choose Take control/i);
  assert.match(receivedPrompt,/If an actual sign-in or human-verification challenge is visible, stop/i);
  assert.match(receivedPrompt,/do not enter or request credentials/i);
 }finally{await executor.close();gateway.close()}
});

test('Pi resumes the original Gmail task and generic Browser User scope after a short sign-in continuation',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const original='请检查 Gmail 最近的未读邮件并为最新一封拟写回复草稿。登录页出现后请停下来让我接管；我登录并把控制权还给你后继续。不要发送。';
 const followup:AgentRun={...run,prompt:'继续',previousPrompts:[original,'已登录并点了 Return to Bot']};
 let receivedPrompt='',issuedScope:unknown;
 const issue=gateway.issue.bind(gateway);gateway.issue=options=>{issuedScope=options.scope;return issue(options)};
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  receivedPrompt=JSON.parse(String(init?.body)).prompt;
  return Response.json({status:'done',message:'Unread review and reply draft completed.'});
 });
 try{
  const result=await executor.execute(screen,followup,new AbortController().signal,randomUUID());
  assert.equal(result.status,'completed');
  assert.doesNotMatch(JSON.stringify(issuedScope),/browserTask|requestedNavigationOrigins|signInHandoff|gmailReadDraftWorkflow/,'the resumed task receives the same lease-wide Browser and Computer capability');
  assert.match(receivedPrompt,/Original user task:[\s\S]*请检查 Gmail 最近的未读邮件/);
  assert.match(receivedPrompt,/User's current message:\n继续/);
  assert.match(receivedPrompt,/resume the original user-requested task from the current state/i);
  assert.match(receivedPrompt,/Never claim the handoff completed without checking ownership/i);
  assert.match(receivedPrompt,/If an actual sign-in or human-verification challenge is visible, stop/i);
  assert.doesNotMatch(receivedPrompt,/Do not interpret.*permission.*take account actions/i);
 }finally{await executor.close();gateway.close()}
});

test('Pi resumes a same-Bot web task without a Browser User classifier flag',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const original='Search Slack for the latest project channel and report its name.';
 const followup:AgentRun={...run,prompt:'继续',previousPrompts:[original]};
 let receivedPrompt='',issuedScope:unknown;
 const issue=gateway.issue.bind(gateway);gateway.issue=options=>{issuedScope=options.scope;return issue(options)};
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async(_url,init)=>{
  receivedPrompt=JSON.parse(String(init?.body)).prompt;
  return Response.json({status:'done',message:'Continued the search.'});
 });
 try{
  const result=await executor.execute(screen,followup,new AbortController().signal,randomUUID());
  assert.equal(result.status,'completed');
  assert.doesNotMatch(JSON.stringify(issuedScope),/browserTask|requestedNavigationOrigins|signInHandoff|gmailReadDraftWorkflow/,'continuations do not acquire prompt-derived Browser or Computer permission flags');
  assert.match(receivedPrompt,/Original user task:\nSearch Slack for the latest project channel/);
  assert.match(receivedPrompt,/User's current message:\n继续/);
  assert.match(receivedPrompt,/resume the original user-requested task from the current state/i);
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
 const interrupted=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>{calls++;return Response.json({status:'waiting',pausedForControl:true,controlOwner:'user',message:'paused'})});
 await assert.rejects(interrupted.execute(screen,run,new AbortController().signal,randomUUID()),error=>error instanceof RunDiagnosticError&&error.diagnosticCode==='agent_paused_for_control');assert.equal(calls,1);
 const unknownOwner=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>Response.json({status:'waiting',pausedForControl:true,controlOwner:'unknown',message:'paused'}));
 await assert.rejects(unknownOwner.execute(screen,run,new AbortController().signal,randomUUID()),error=>error instanceof RunDiagnosticError&&error.diagnosticCode==='computer_control_state_unknown');
 const waitingAudit={engine:'pi',model:'model',modelCompleted:true,calls:[{tool:'computer_browser',action:'navigate',outcome:'succeeded'}],truncated:false};
 const genericWaiting=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>Response.json({status:'waiting',message:'waiting for a non-computer reason',executionAudit:waitingAudit}));
 await assert.rejects(genericWaiting.execute(screen,run,new AbortController().signal,randomUUID()),error=>error instanceof RunDiagnosticError&&error.diagnosticCode==='agent_result_status_unconfirmed'&&JSON.stringify(error.executionAudit)===JSON.stringify(waitingAudit));
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

test('Pi treats a confirmed scheduled routine as a completed task',async()=>{
 const gateway=new ModelGateway('test-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const scheduledAudit={engine:'pi',model:'model',modelCompleted:true,calls:[{tool:'bot_routines',action:null,outcome:'succeeded'}],truncated:false};
 const artifact={name:'routine-summary.txt',mimeType:'text/plain',size:7,sha256:'c'.repeat(64),storageKey:`tasks/${run.id}/artifacts/routine-summary.txt`};
 const executor=new PiExecutor({connect:async()=>({agentUrl:endpoint,agentToken})},gateway,'https://gateway.example.test/v1','model',async()=>Response.json({status:'scheduled',message:'The routine was confirmed and scheduled.',files:[artifact],executionAudit:scheduledAudit}));
 try{assert.deepEqual(await executor.execute(screen,run,new AbortController().signal,randomUUID()),{status:'completed',result:'The routine was confirmed and scheduled.',artifacts:[artifact],executionAudit:scheduledAudit})}finally{gateway.close()}
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
