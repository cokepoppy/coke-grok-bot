import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runCloudKernel } from '../deploy/desktop/cloud-kernel-adapter.mjs';

const capability='m'.repeat(43);

test('Pi registers the scoped Bot memory tool and routes it through the short-lived capability',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-pi-memory-')),cwd=path.join(workspace,'tasks','memory');await mkdir(cwd,{recursive:true});
 const oldFetch=globalThis.fetch;let options,requests=[];
 globalThis.fetch=async(url,init={})=>{requests.push({url:String(url),method:init.method||'GET',auth:new Headers(init.headers).get('authorization'),body:init.body?JSON.parse(init.body):undefined});if((init.method||'GET')==='GET')return Response.json({memories:[{id:randomUUID(),title:'Style',content:'Concise with links.'}]});return Response.json({memory:{id:randomUUID(),title:'Style',content:'Concise with links.'}},{status:201})};
 const sdk={
  AuthStorage:{inMemory:()=>({setRuntimeApiKey(){}})},ModelRegistry:{inMemory:()=>({registerProvider(){},find:()=>({id:'deepseek-v4.1-flash'})})},
  SessionManager:{list:async()=>[],create:()=>({getSessionId:()=>randomUUID()})},
  createAgentSession:async value=>{options=value;return{session:{messages:[{role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"status":"done","message":"Memory loaded."}'}]}],async prompt(value){assert.match(value,/Bot memory policy/);},dispose(){}}}},
 };
 try{
  await runCloudKernel({engine:'pi',modelConfig:{apiKey:capability,baseUrl:'https://gateway.example.test/v1',model:'deepseek-v4.1-flash'},memory:{mode:'mediated'},workspace,cwd:'tasks/memory',prompt:'What do you remember about how I like answers?',signal:new AbortController().signal},{piSdk:sdk});
  const tool=options.customTools.find(item=>item.name==='bot_memory');assert.ok(tool);assert.ok(options.tools.includes('bot_memory'));
  const listed=await tool.execute('list',{action:'list'},new AbortController().signal);assert.match(listed.content[0].text,/Concise with links/);
  const saved=await tool.execute('remember',{action:'remember',title:'Style',content:'Concise with links.'},new AbortController().signal);assert.match(saved.content[0].text,/Concise with links/);
  assert.deepEqual(requests.map(({method,url})=>({method,url})),[{method:'GET',url:'https://gateway.example.test/v1/bot-memory'},{method:'POST',url:'https://gateway.example.test/v1/bot-memory'}]);
  assert.ok(requests.every(request=>request.auth===`Bearer ${capability}`));assert.deepEqual(requests[1].body,{action:'remember',title:'Style',content:'Concise with links.'});
 }finally{globalThis.fetch=oldFetch;await rm(workspace,{recursive:true,force:true})}
});

test('DeepSeek Harness installs the mediated Bot memory plugin with the task capability',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-dsh-memory-')),cwd=path.join(workspace,'tasks','memory');await mkdir(cwd,{recursive:true});
 const oldBin=process.env.DOTS_DSH_BIN,oldProfile=process.env.DOTS_DSH_PROFILE;let options;
 class FakeDeepSeekHarness{
  constructor(value){options=value}
  async run(prompt){
   assert.match(prompt,/Each Bot has its own durable memory/);assert.match(await readFile(options.patches[0],'utf8'),/coke-grok-memory-/);
   const match=(await readFile(options.patches[0],'utf8')).match(/name: "\.\/(coke-grok-memory-[a-f0-9]+\.mjs)"/);assert.ok(match);
   const source=await readFile(path.join(options.dshHome,match[1]),'utf8');assert.match(source,/bot-memory/);
   return{finalResponse:'{"status":"done","message":"Memory tool installed."}',sessionId:'memory-session',events:[]}
  }
  async close(){}
 }
 process.env.DOTS_DSH_BIN='/opt/coke-grok/dsh-runtime/node_modules/.bin/dsh';process.env.DOTS_DSH_PROFILE='memory-test';
 try{
  const result=await runCloudKernel({engine:'dsh',modelConfig:{apiKey:capability,baseUrl:'https://gateway.example.test/v1',model:'deepseek-v4.1-flash'},memory:{mode:'mediated'},workspace,cwd:'tasks/memory',prompt:'Remember that I prefer concise answers.',signal:new AbortController().signal},{dshSdk:{DeepSeekHarness:FakeDeepSeekHarness}});
  assert.equal(result.message,'Memory tool installed.');assert.equal(options.env.COKE_GROK_MEMORY_BRIDGE_URL,'https://gateway.example.test/v1');assert.equal(options.env.COKE_GROK_MEMORY_BRIDGE_TOKEN,capability);
 }finally{if(oldBin===undefined)delete process.env.DOTS_DSH_BIN;else process.env.DOTS_DSH_BIN=oldBin;if(oldProfile===undefined)delete process.env.DOTS_DSH_PROFILE;else process.env.DOTS_DSH_PROFILE=oldProfile;await rm(workspace,{recursive:true,force:true})}
});
