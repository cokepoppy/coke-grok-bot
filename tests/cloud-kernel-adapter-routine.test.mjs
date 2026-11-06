import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runCloudKernel } from '../deploy/desktop/cloud-kernel-adapter.mjs';

const capability='r'.repeat(43);
const routineId='55555555-5555-4555-8555-555555555555';
const routineInput={name:'Weekly review',instruction:'Summarize new work for review.',timezone:'Asia/Shanghai',schedule:{kind:'weekly',weekday:1,hour:9,minute:30}};

test('Pi routine tool uses the scoped gateway for list, create, and edit',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-pi-routines-')),cwd=path.join(workspace,'tasks','routines');await mkdir(cwd,{recursive:true});
 const oldFetch=globalThis.fetch;let options;const requests=[];
 globalThis.fetch=async(url,init={})=>{requests.push({url:String(url),method:init.method||'GET',auth:new Headers(init.headers).get('authorization'),body:init.body?JSON.parse(init.body):undefined});return Response.json({routine:{id:routineId},routines:[]},{status:init.method==='POST'?201:200})};
 const sdk={
  AuthStorage:{inMemory:()=>({setRuntimeApiKey(){}})},ModelRegistry:{inMemory:()=>({registerProvider(){},find:()=>({id:'deepseek-v4.1-flash'})})},
  SessionManager:{list:async()=>[],create:()=>({getSessionId:()=>randomUUID()})},
  createAgentSession:async value=>{options=value;return{session:{messages:[{role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"status":"done","message":"Routine tool ready."}'}]}],async prompt(value){assert.match(value,/Bot routine policy/)},dispose(){}}}},
 };
 try{
  await runCloudKernel({engine:'pi',modelConfig:{apiKey:capability,baseUrl:'https://gateway.example.test/v1',model:'deepseek-v4.1-flash'},routines:{mode:'mediated'},workspace,cwd:'tasks/routines',prompt:'List my routines.',signal:new AbortController().signal},{piSdk:sdk});
  const tool=options.customTools.find(item=>item.name==='bot_routines');assert.ok(tool);assert.ok(options.tools.includes('bot_routines'));
  await tool.execute('list',{action:'list'},new AbortController().signal);
  await tool.execute('create',{action:'create',...routineInput},new AbortController().signal);
  await tool.execute('edit',{action:'edit',routineId,...routineInput},new AbortController().signal);
  assert.deepEqual(requests.map(request=>[new URL(request.url).pathname,request.method]),[['/v1/bot-routines','GET'],['/v1/bot-routines','POST'],[`/v1/bot-routines/${routineId}`,'PATCH']]);
  assert.ok(requests.every(request=>request.auth===`Bearer ${capability}`));
  await assert.rejects(()=>tool.execute('invalid',{action:'create',...routineInput,schedule:{...routineInput.schedule,extra:true}},new AbortController().signal),/missing required fields/);
 }finally{globalThis.fetch=oldFetch;await rm(workspace,{recursive:true,force:true})}
});

test('DeepSeek Harness installs the scoped routine plugin and gateway capability',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-dsh-routines-')),cwd=path.join(workspace,'tasks','routines');await mkdir(cwd,{recursive:true});
 const oldBin=process.env.DOTS_DSH_BIN,oldProfile=process.env.DOTS_DSH_PROFILE;let options;
 class FakeDeepSeekHarness{
  constructor(value){options=value}
  async run(prompt){
   assert.match(prompt,/Bot routine policy/);
   const patch=await (await import('node:fs/promises')).readFile(options.patches[0],'utf8');
   const match=patch.match(/name: "\.\/(coke-grok-routines-[a-f0-9]+\.mjs)"/);assert.ok(match);
   const source=await (await import('node:fs/promises')).readFile(path.join(options.dshHome,match[1]),'utf8');assert.match(source,/bot_routines/);
   return{finalResponse:'{"status":"done","message":"Routine plugin installed."}',sessionId:'routine-session',events:[]};
  }
  async close(){}
 }
 process.env.DOTS_DSH_BIN='/opt/coke-grok/dsh-runtime/node_modules/.bin/dsh';process.env.DOTS_DSH_PROFILE='routine-test';
 try{
  const result=await runCloudKernel({engine:'dsh',modelConfig:{apiKey:capability,baseUrl:'https://gateway.example.test/v1',model:'deepseek-v4.1-flash'},routines:{mode:'mediated'},workspace,cwd:'tasks/routines',prompt:'Show this Bot’s routines.',signal:new AbortController().signal},{dshSdk:{DeepSeekHarness:FakeDeepSeekHarness}});
  assert.equal(result.message,'Routine plugin installed.');
  assert.equal(options.env.COKE_GROK_ROUTINE_BRIDGE_URL,'https://gateway.example.test/v1');
  assert.equal(options.env.COKE_GROK_ROUTINE_BRIDGE_TOKEN,capability);
 }finally{if(oldBin===undefined)delete process.env.DOTS_DSH_BIN;else process.env.DOTS_DSH_BIN=oldBin;if(oldProfile===undefined)delete process.env.DOTS_DSH_PROFILE;else process.env.DOTS_DSH_PROFILE=oldProfile;await rm(workspace,{recursive:true,force:true})}
});

test('DSH routine plugin validates schedules and forwards only supported operations',async()=>{
 const url=path.resolve('deploy/desktop/dsh-routine-plugin.mjs'),oldUrl=process.env.COKE_GROK_ROUTINE_BRIDGE_URL,oldToken=process.env.COKE_GROK_ROUTINE_BRIDGE_TOKEN,oldFetch=globalThis.fetch;const requests=[];
 process.env.COKE_GROK_ROUTINE_BRIDGE_URL='https://gateway.example.test/v1';process.env.COKE_GROK_ROUTINE_BRIDGE_TOKEN=capability;
 globalThis.fetch=async(input,init={})=>{requests.push({url:String(input),method:init.method||'GET',auth:new Headers(init.headers).get('authorization'),body:init.body?JSON.parse(init.body):undefined});return Response.json({routine:{id:routineId},routines:[]},{status:init.method==='POST'?201:200})};
 try{
  const module=await import(`${new URL(`file://${url}`).href}?case=${randomUUID()}`),tools=[];module.apply({tools:{register:tool=>tools.push(tool)}});const tool=tools.find(item=>item.name==='bot_routines');assert.ok(tool);
  await tool.execute({action:'list'},{signal:new AbortController().signal});
  await tool.execute({action:'create',...routineInput},{signal:new AbortController().signal});
  await tool.execute({action:'edit',routineId,...routineInput},{signal:new AbortController().signal});
  assert.deepEqual(requests.map(request=>[new URL(request.url).pathname,request.method]),[['/v1/bot-routines','GET'],['/v1/bot-routines','POST'],[`/v1/bot-routines/${routineId}`,'PATCH']]);
  assert.ok(requests.every(request=>request.auth===`Bearer ${capability}`));
  await assert.rejects(()=>tool.execute({action:'create',...routineInput,schedule:{...routineInput.schedule,minute:90}},{signal:new AbortController().signal}),/incomplete/);
 }finally{globalThis.fetch=oldFetch;for(const [key,value] of [['COKE_GROK_ROUTINE_BRIDGE_URL',oldUrl],['COKE_GROK_ROUTINE_BRIDGE_TOKEN',oldToken]])if(value===undefined)delete process.env[key];else process.env[key]=value}
});
