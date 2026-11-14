import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runCloudKernel} from '../deploy/desktop/cloud-kernel-adapter.mjs';

const capability='s'.repeat(43),actions=['list','create','update','delete'];
const input={name:'BSE review',description:'Research current BSE rule changes.',instructions:'Check the primary source, compare the effective date, validate the UI, and return evidence.',visibility:'private'};

test('Pi registers mediated Bot Skills and routes CRUD through the run capability',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-pi-skills-')),cwd=path.join(workspace,'tasks','skill');await mkdir(cwd,{recursive:true});
 const oldFetch=globalThis.fetch;let options;const requests=[];
 globalThis.fetch=async(url,init={})=>{requests.push({url:String(url),method:init.method||'GET',auth:new Headers(init.headers).get('authorization'),body:init.body?JSON.parse(init.body):undefined});return Response.json(init.method==='GET'?{skills:[{id:'60000000-0000-4000-8000-000000000001',name:'BSE review'}]}:{skill:{id:'60000000-0000-4000-8000-000000000001',...input}},{status:init.method==='POST'?201:200})};
 const sdk={AuthStorage:{inMemory:()=>({setRuntimeApiKey(){}})},ModelRegistry:{inMemory:()=>({registerProvider(){},find:()=>({id:'deepseek-v4.1-flash'})})},SessionManager:{list:async()=>[],create:()=>({getSessionId:()=>randomUUID()})},createAgentSession:async value=>{options=value;return{session:{messages:[{role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"status":"done","message":"Skill tool ready."}'}]}],async prompt(prompt){assert.match(prompt,/Bot Skill policy/);assert.match(prompt,/Apply only an enabled Skill/);},dispose(){}}}}};
 try{
  await runCloudKernel({engine:'pi',modelConfig:{apiKey:capability,baseUrl:'https://gateway.example.test/v1',model:'deepseek-v4.1-flash'},skills:{mode:'mediated',actions},workspace,cwd:'tasks/skill',prompt:'Use the BSE review Skill.',signal:new AbortController().signal},{piSdk:sdk});
  const tool=options.customTools.find(item=>item.name==='bot_skills');assert.ok(tool);assert.ok(options.tools.includes('bot_skills'));
  await tool.execute('list',{action:'list'},new AbortController().signal);
  await tool.execute('create',{action:'create',...input},new AbortController().signal);
  await tool.execute('update',{action:'update',id:'60000000-0000-4000-8000-000000000001',...input},new AbortController().signal);
  await tool.execute('delete',{action:'delete',id:'60000000-0000-4000-8000-000000000001'},new AbortController().signal);
  assert.deepEqual(requests.map(({url,method})=>[new URL(url).pathname,method]),[['/v1/bot-skills','GET'],['/v1/bot-skills','POST'],['/v1/bot-skills/60000000-0000-4000-8000-000000000001','PATCH'],['/v1/bot-skills/60000000-0000-4000-8000-000000000001','DELETE']]);
  assert.ok(requests.every(request=>request.auth===`Bearer ${capability}`));
  assert.deepEqual(requests[1].body,{action:'create',skill:input});
  await assert.rejects(()=>tool.execute('bad',{action:'create',...input,extra:true},new AbortController().signal),/unsupported fields/);
 }finally{globalThis.fetch=oldFetch;await rm(workspace,{recursive:true,force:true})}
});

test('DeepSeek Harness loads the mediated Skill plugin with the task capability and allowlisted actions',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-dsh-skills-')),cwd=path.join(workspace,'tasks','skill');await mkdir(cwd,{recursive:true});
 const oldBin=process.env.DOTS_DSH_BIN,oldProfile=process.env.DOTS_DSH_PROFILE;let options;
 class FakeDeepSeekHarness{constructor(value){options=value}async run(prompt){assert.match(prompt,/Bot Skill policy/);const patch=await readFile(options.patches[0],'utf8');const match=patch.match(/name: "\.\/(coke-grok-skills-[a-f0-9]+\.mjs)"/);assert.ok(match);const source=await readFile(path.join(options.dshHome,match[1]),'utf8');assert.match(source,/bot_skills/);return{finalResponse:'{"status":"done","message":"Skill plugin installed."}',sessionId:'skill-session',events:[]}}async close(){}}
 process.env.DOTS_DSH_BIN='/opt/coke-grok/dsh-runtime/node_modules/.bin/dsh';process.env.DOTS_DSH_PROFILE='skill-test';
 try{
  const result=await runCloudKernel({engine:'dsh',modelConfig:{apiKey:capability,baseUrl:'https://gateway.example.test/v1',model:'deepseek-v4.1-flash'},skills:{mode:'mediated',actions},workspace,cwd:'tasks/skill',prompt:'Save the workflow as a Skill.',signal:new AbortController().signal},{dshSdk:{DeepSeekHarness:FakeDeepSeekHarness}});
  assert.equal(result.message,'Skill plugin installed.');assert.equal(options.env.COKE_GROK_SKILL_BRIDGE_URL,'https://gateway.example.test/v1');assert.equal(options.env.COKE_GROK_SKILL_BRIDGE_TOKEN,capability);assert.deepEqual(JSON.parse(options.env.COKE_GROK_SKILL_ACTIONS),actions);
 }finally{if(oldBin===undefined)delete process.env.DOTS_DSH_BIN;else process.env.DOTS_DSH_BIN=oldBin;if(oldProfile===undefined)delete process.env.DOTS_DSH_PROFILE;else process.env.DOTS_DSH_PROFILE=oldProfile;await rm(workspace,{recursive:true,force:true})}
});

test('DSH Skill plugin forwards only schema-validated CRUD actions to the scoped gateway',async()=>{
 const capability='t'.repeat(43),oldUrl=process.env.COKE_GROK_SKILL_BRIDGE_URL,oldToken=process.env.COKE_GROK_SKILL_BRIDGE_TOKEN,oldActions=process.env.COKE_GROK_SKILL_ACTIONS,oldFetch=globalThis.fetch,requests=[];
 process.env.COKE_GROK_SKILL_BRIDGE_URL='https://gateway.example.test/v1';process.env.COKE_GROK_SKILL_BRIDGE_TOKEN=capability;process.env.COKE_GROK_SKILL_ACTIONS=JSON.stringify(actions);
 globalThis.fetch=async(url,init={})=>{requests.push({url:String(url),method:init.method||'GET',auth:new Headers(init.headers).get('authorization'),body:init.body?JSON.parse(init.body):undefined});return Response.json(init.method==='GET'?{skills:[]}:{skill:{id:'60000000-0000-4000-8000-000000000001'}},{status:init.method==='POST'?201:200})};
 try{
  const module=await import(`${new URL(`file://${path.resolve('deploy/desktop/dsh-skill-plugin.mjs')}`).href}?case=${randomUUID()}`),tools=[];module.apply({tools:{register:tool=>tools.push(tool)}});const tool=tools.find(item=>item.name==='bot_skills');assert.ok(tool);
  await tool.execute({action:'list'},{signal:new AbortController().signal});
  await tool.execute({action:'create',...input},{signal:new AbortController().signal});
  await tool.execute({action:'update',id:'60000000-0000-4000-8000-000000000001',...input},{signal:new AbortController().signal});
  await tool.execute({action:'delete',id:'60000000-0000-4000-8000-000000000001'},{signal:new AbortController().signal});
  assert.deepEqual(requests.map(request=>[new URL(request.url).pathname,request.method]),[['/v1/bot-skills','GET'],['/v1/bot-skills','POST'],['/v1/bot-skills/60000000-0000-4000-8000-000000000001','PATCH'],['/v1/bot-skills/60000000-0000-4000-8000-000000000001','DELETE']]);assert.ok(requests.every(request=>request.auth===`Bearer ${capability}`));
  await assert.rejects(()=>tool.execute({action:'create',...input,extra:true},{signal:new AbortController().signal}),/unsupported fields/);
 }finally{globalThis.fetch=oldFetch;for(const [key,value] of [['COKE_GROK_SKILL_BRIDGE_URL',oldUrl],['COKE_GROK_SKILL_BRIDGE_TOKEN',oldToken],['COKE_GROK_SKILL_ACTIONS',oldActions]])if(value===undefined)delete process.env[key];else process.env[key]=value}
});
