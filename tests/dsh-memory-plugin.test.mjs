import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

test('DSH Bot memory plugin calls the scoped gateway for reads, saves and forgets',async()=>{
 const file=path.resolve('deploy/desktop/dsh-memory-plugin.mjs'),oldUrl=process.env.COKE_GROK_MEMORY_BRIDGE_URL,oldToken=process.env.COKE_GROK_MEMORY_BRIDGE_TOKEN,oldFetch=globalThis.fetch;
 const token='x'.repeat(43),memoryId=randomUUID(),requests=[];
 process.env.COKE_GROK_MEMORY_BRIDGE_URL='https://gateway.example.test/v1';process.env.COKE_GROK_MEMORY_BRIDGE_TOKEN=token;
 globalThis.fetch=async(url,init={})=>{requests.push({url:String(url),method:init.method||'GET',headers:init.headers,body:init.body?JSON.parse(init.body):undefined});if(String(url).endsWith('/bot-memory')&&(init.method||'GET')==='GET')return Response.json({memories:[]});return Response.json({forgotten:true})};
 try{
  const module=await import(`${pathToFileURL(file).href}?case=${randomUUID()}`),tools=[];module.apply({tools:{register:tool=>tools.push(tool)}});const tool=tools.find(item=>item.name==='bot_memory');assert.ok(tool);
  assert.deepEqual(await tool.execute({action:'list'},{signal:new AbortController().signal}),{memories:[]});
  await tool.execute({action:'remember',id:memoryId,title:'Preference',content:'Short replies'},{signal:new AbortController().signal});
  await tool.execute({action:'forget',id:memoryId},{signal:new AbortController().signal});
  assert.equal(requests.length,3);assert.equal(requests[1].method,'POST');assert.deepEqual(requests[1].body,{action:'remember',id:memoryId,title:'Preference',content:'Short replies'});
  assert.equal(requests[2].method,'DELETE');assert.ok(requests[2].url.endsWith(`/bot-memory/${memoryId}`));assert.equal(new Headers(requests[1].headers).get('authorization'),`Bearer ${token}`);
 }finally{
  globalThis.fetch=oldFetch;
  for(const [key,value] of [['COKE_GROK_MEMORY_BRIDGE_URL',oldUrl],['COKE_GROK_MEMORY_BRIDGE_TOKEN',oldToken]])if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
