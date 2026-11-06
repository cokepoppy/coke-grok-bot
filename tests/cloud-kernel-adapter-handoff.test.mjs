import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runCloudKernel} from '../deploy/desktop/cloud-kernel-adapter.mjs';

const capability='h'.repeat(43);
const sourceBot={id:randomUUID(),name:'Chief',label:'Operations'},targetBot={id:randomUUID(),name:'Sales Outbound',label:'Prospecting'};
const sameNameBot={id:randomUUID(),name:'Sales Outbound',label:'Research'};
const handoffs={mode:'mediated',bots:[targetBot]};

test('Pi installs an owner-scoped private async Bot handoff tool and queues through the short-lived gateway capability',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-pi-handoff-')),cwd=path.join(workspace,'tasks',randomUUID());await mkdir(cwd,{recursive:true});
 const oldFetch=globalThis.fetch;let options,request;
 globalThis.fetch=async(url,init={})=>{request={url:String(url),method:init.method,headers:new Headers(init.headers),body:JSON.parse(init.body)};return Response.json({handoff:{targetRunId:randomUUID()}},{status:202})};
 const sdk={
  AuthStorage:{inMemory:()=>({setRuntimeApiKey(){}})},ModelRegistry:{inMemory:()=>({registerProvider(){},find:()=>({id:'deepseek-v4.1-flash'})})},
  SessionManager:{list:async()=>[],create:()=>({getSessionId:()=>randomUUID()})},
  createAgentSession:async value=>{options=value;return{session:{messages:[{role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"status":"done","message":"Delegation queued."}'}]}],async prompt(prompt){assert.match(prompt,/Bot handoff policy/);},dispose(){}}}},
 };
 try{
  await runCloudKernel({engine:'pi',modelConfig:{apiKey:capability,baseUrl:'https://gateway.example.test/v1',model:'deepseek-v4.1-flash'},handoffs:{...handoffs,bots:[targetBot,sameNameBot]},workspace,cwd:path.relative(workspace,cwd),prompt:'Ask Sales Outbound to research one safe example prospect. Do not contact anyone.',signal:new AbortController().signal},{piSdk:sdk});
  const tool=options.customTools.find(item=>item.name==='bot_handoff');assert.ok(tool);assert.ok(options.tools.includes('bot_handoff'));
  assert.match(tool.description,/Sales Outbound \(Prospecting\).*Bot ID/);assert.match(tool.promptSnippet,/targetBotId/);
  const queued=await tool.execute('tool-call',{targetBotId:targetBot.id,message:'Research one fictional sample prospect without contacting anyone.'},new AbortController().signal);
  assert.match(queued.content[0].text,/queued private task/i);assert.equal(request.url,'https://gateway.example.test/v1/bot-handoffs');assert.equal(request.method,'POST');
  assert.equal(request.headers.get('authorization'),`Bearer ${capability}`);assert.deepEqual(request.body,{targetBotId:targetBot.id,message:'Research one fictional sample prospect without contacting anyone.'});
  await assert.rejects(()=>tool.execute('tool-call',{targetBotName:sourceBot.name,message:'not in the owner-scoped roster'},new AbortController().signal),/target or message is invalid/);
  await assert.rejects(()=>tool.execute('tool-call',{targetBotName:'Sales Outbound',message:'ambiguous display name'},new AbortController().signal),/target name is ambiguous/);
  const fallback=await tool.execute('tool-call',{targetBotName:'Sales Outbound (Prospecting)',message:'Use the unique legacy name-and-label address.'},new AbortController().signal);
  assert.match(fallback.content[0].text,/Sales Outbound/);assert.deepEqual(request.body,{targetBotId:targetBot.id,message:'Use the unique legacy name-and-label address.'});
 }finally{globalThis.fetch=oldFetch;await rm(workspace,{recursive:true,force:true})}
});

test('Pi records a successful handoff as pending delegation when the model ends with ordinary prose',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-pi-handoff-progress-')),cwd=path.join(workspace,'tasks',randomUUID());await mkdir(cwd,{recursive:true});
 const oldFetch=globalThis.fetch;let options;
 globalThis.fetch=async()=>Response.json({handoff:{targetRunId:randomUUID()}},{status:202});
 const queuedMessage='Research the public Example Domain page. Do not click links or submit anything.';
 const session={messages:[],async prompt(){
  const tool=options.customTools.find(item=>item.name==='bot_handoff');
  const result=await tool.execute('handoff-call',{targetBotName:'Sales Outbound (Prospecting)',message:queuedMessage},new AbortController().signal);
  this.messages=[
   {role:'assistant',content:[{type:'toolCall',id:'handoff-call',name:'bot_handoff',arguments:{targetBotName:'Sales Outbound (Prospecting)',message:queuedMessage}}]},
   {role:'toolResult',toolCallId:'handoff-call',toolName:'bot_handoff',details:result.details,isError:false,content:result.content},
   {role:'assistant',stopReason:'stop',content:[{type:'text',text:'I asked Sales Outbound to check the page and will wait for its reply.'}]},
  ];
 },dispose(){}};
 const sdk={
  AuthStorage:{inMemory:()=>({setRuntimeApiKey(){}})},ModelRegistry:{inMemory:()=>({registerProvider(){},find:()=>({id:'deepseek-v4.1-flash'})})},
  SessionManager:{list:async()=>[],create:()=>({getSessionId:()=>randomUUID()})},
  createAgentSession:async value=>{options=value;return{session}},
 };
 try{
  const result=await runCloudKernel({engine:'pi',modelConfig:{apiKey:capability,baseUrl:'https://gateway.example.test/v1',model:'deepseek-v4.1-flash'},handoffs,workspace,cwd:path.relative(workspace,cwd),prompt:'Ask Sales Outbound to check the page.',signal:new AbortController().signal},{piSdk:sdk});
  assert.equal(result.status,'delegating');assert.match(result.message,/Sales Outbound/);assert.match(result.message,/still in progress/);assert.doesNotMatch(result.message,/Example Domain/);
 }finally{globalThis.fetch=oldFetch;await rm(workspace,{recursive:true,force:true})}
});

test('Pi does not convert mixed computer and handoff tool activity into a delegation progress result',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-pi-handoff-mixed-')),cwd=path.join(workspace,'tasks',randomUUID());await mkdir(cwd,{recursive:true});
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({handoff:{targetRunId:randomUUID()}},{status:202});
 const session={messages:[],async prompt(){
  this.messages=[
   {role:'assistant',content:[{type:'toolCall',id:'handoff-call',name:'bot_handoff'},{type:'toolCall',id:'computer-call',name:'computer_browser'}]},
   {role:'toolResult',toolCallId:'handoff-call',toolName:'bot_handoff',details:{status:'queued',targetBotName:'Sales Outbound'},isError:false,content:[{type:'text',text:'queued'}]},
   {role:'assistant',stopReason:'stop',content:[{type:'text',text:'I completed the task.'}]},
  ];
 },dispose(){}};
 const sdk={AuthStorage:{inMemory:()=>({setRuntimeApiKey(){}})},ModelRegistry:{inMemory:()=>({registerProvider(){},find:()=>({id:'deepseek-v4.1-flash'})})},SessionManager:{list:async()=>[],create:()=>({getSessionId:()=>randomUUID()})},createAgentSession:async()=>({session})};
 try{
  await assert.rejects(()=>runCloudKernel({engine:'pi',modelConfig:{apiKey:capability,baseUrl:'https://gateway.example.test/v1',model:'deepseek-v4.1-flash'},handoffs,workspace,cwd:path.relative(workspace,cwd),prompt:'Continue the task.',signal:new AbortController().signal},{piSdk:sdk}),/structured result/);
 }finally{globalThis.fetch=oldFetch;await rm(workspace,{recursive:true,force:true})}
});

test('DeepSeek Harness installs the handoff plugin with only the scoped gateway capability and validated Bot roster',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-dsh-handoff-')),cwd=path.join(workspace,'tasks',randomUUID());await mkdir(cwd,{recursive:true});
 const oldBin=process.env.DOTS_DSH_BIN,oldProfile=process.env.DOTS_DSH_PROFILE;let options;
 class FakeDeepSeekHarness{
  constructor(value){options=value}
  async run(prompt){
   assert.match(prompt,/Bot handoff policy/);
   const patch=await readFile(options.patches[0],'utf8');assert.match(patch,/coke-grok-handoff-/);
   const match=patch.match(/name: "\.\/(coke-grok-handoff-[a-f0-9]+\.mjs)"/);assert.ok(match);
   const source=await readFile(path.join(options.dshHome,match[1]),'utf8');assert.match(source,/bot-handoffs/);
   return{finalResponse:'{"status":"done","message":"Delegation tool installed."}',sessionId:'handoff-session',events:[]};
  }
  async close(){}
 }
 process.env.DOTS_DSH_BIN='/opt/coke-grok/dsh-runtime/node_modules/.bin/dsh';process.env.DOTS_DSH_PROFILE='handoff-test';
 try{
  const result=await runCloudKernel({engine:'dsh',modelConfig:{apiKey:capability,baseUrl:'https://gateway.example.test/v1',model:'deepseek-v4.1-flash'},handoffs,workspace,cwd:path.relative(workspace,cwd),prompt:'Ask Sales Outbound to research one safe example prospect.',signal:new AbortController().signal},{dshSdk:{DeepSeekHarness:FakeDeepSeekHarness}});
  assert.equal(result.message,'Delegation tool installed.');assert.equal(options.env.COKE_GROK_HANDOFF_BRIDGE_URL,'https://gateway.example.test/v1');assert.equal(options.env.COKE_GROK_HANDOFF_BRIDGE_TOKEN,capability);assert.deepEqual(JSON.parse(options.env.COKE_GROK_HANDOFF_BOTS),[targetBot]);
 }finally{if(oldBin===undefined)delete process.env.DOTS_DSH_BIN;else process.env.DOTS_DSH_BIN=oldBin;if(oldProfile===undefined)delete process.env.DOTS_DSH_PROFILE;else process.env.DOTS_DSH_PROFILE=oldProfile;await rm(workspace,{recursive:true,force:true})}
});

test('DeepSeek Harness records an event-confirmed handoff as pending delegation when its final text is not JSON',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-dsh-handoff-progress-')),cwd=path.join(workspace,'tasks',randomUUID());await mkdir(cwd,{recursive:true});
 const oldBin=process.env.DOTS_DSH_BIN,oldProfile=process.env.DOTS_DSH_PROFILE;
 class FakeDeepSeekHarness{
  constructor(){}
  async run(){return{finalResponse:'I asked Sales Outbound to check the page and will wait for its reply.',sessionId:'handoff-progress-session',events:[
   {type:'tool/call',data:{callId:'call-1',name:'bot_handoff'}},
   {type:'tool/result',data:{message:{role:'tool',toolCallId:'call-1',isError:false,content:[{type:'text',text:JSON.stringify({status:'queued',target:'Sales Outbound',targetRunId:randomUUID()})}]}}},
  ]}}
  async close(){}
 }
 process.env.DOTS_DSH_BIN='/opt/coke-grok/dsh-runtime/node_modules/.bin/dsh';process.env.DOTS_DSH_PROFILE='handoff-progress-test';
 try{
  const result=await runCloudKernel({engine:'dsh',modelConfig:{apiKey:capability,baseUrl:'https://gateway.example.test/v1',model:'deepseek-v4.1-flash'},handoffs,workspace,cwd:path.relative(workspace,cwd),prompt:'Ask Sales Outbound to check the page.',signal:new AbortController().signal},{dshSdk:{DeepSeekHarness:FakeDeepSeekHarness}});
  assert.equal(result.status,'delegating');assert.match(result.message,/Sales Outbound/);assert.match(result.message,/still in progress/);
 }finally{if(oldBin===undefined)delete process.env.DOTS_DSH_BIN;else process.env.DOTS_DSH_BIN=oldBin;if(oldProfile===undefined)delete process.env.DOTS_DSH_PROFILE;else process.env.DOTS_DSH_PROFILE=oldProfile;await rm(workspace,{recursive:true,force:true})}
});

test('DSH handoff plugin sends only rostered targets through the mediated gateway',async()=>{
 const url=path.resolve('deploy/desktop/dsh-handoff-plugin.mjs'),oldUrl=process.env.COKE_GROK_HANDOFF_BRIDGE_URL,oldToken=process.env.COKE_GROK_HANDOFF_BRIDGE_TOKEN,oldBots=process.env.COKE_GROK_HANDOFF_BOTS,oldFetch=globalThis.fetch;
 let request;
 process.env.COKE_GROK_HANDOFF_BRIDGE_URL='https://gateway.example.test/v1';process.env.COKE_GROK_HANDOFF_BRIDGE_TOKEN=capability;process.env.COKE_GROK_HANDOFF_BOTS=JSON.stringify([targetBot,sameNameBot]);
 globalThis.fetch=async(input,init={})=>{request={url:String(input),method:init.method,headers:new Headers(init.headers),body:JSON.parse(init.body)};return Response.json({handoff:{targetRunId:randomUUID()}},{status:202})};
 try{
  const module=await import(`${new URL(`file://${url}`).href}?case=${randomUUID()}`),tools=[];module.apply({tools:{register:tool=>tools.push(tool)}});const tool=tools.find(item=>item.name==='bot_handoff');assert.ok(tool);
  assert.match(tool.description,/Bot ID/);
  const result=await tool.execute({targetBotId:targetBot.id,message:'Check one harmless detail.'},{signal:new AbortController().signal});assert.equal(result.status,'queued');
  assert.equal(request.url,'https://gateway.example.test/v1/bot-handoffs');assert.equal(request.method,'POST');assert.equal(request.headers.get('authorization'),`Bearer ${capability}`);assert.deepEqual(request.body,{targetBotId:targetBot.id,message:'Check one harmless detail.'});
  await assert.rejects(()=>tool.execute({targetBotName:sourceBot.name,message:'outside roster'},{signal:new AbortController().signal}),/target or message is invalid/);
  await assert.rejects(()=>tool.execute({targetBotName:'Sales Outbound',message:'ambiguous display name'},{signal:new AbortController().signal}),/target name is ambiguous/);
  await assert.rejects(()=>tool.execute({targetBotId:randomUUID(),message:'unrostered id'},{signal:new AbortController().signal}),/target or message is invalid/);
  const fallback=await tool.execute({targetBotName:'Sales Outbound (Prospecting)',message:'Legacy unique name-and-label address.'},{signal:new AbortController().signal});
  assert.equal(fallback.status,'queued');assert.deepEqual(request.body,{targetBotId:targetBot.id,message:'Legacy unique name-and-label address.'});
 }finally{
  globalThis.fetch=oldFetch;
  for(const [key,value] of [['COKE_GROK_HANDOFF_BRIDGE_URL',oldUrl],['COKE_GROK_HANDOFF_BRIDGE_TOKEN',oldToken],['COKE_GROK_HANDOFF_BOTS',oldBots]])if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
