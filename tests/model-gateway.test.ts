import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ModelGateway } from '../src/server/model-gateway.ts';

const fakeKey = 'fake-sensitive-key-for-test';
const model = 'deepseek-v4.1-flash';
test('DeepSeek official root endpoint routes OpenAI Chat Completions without adding an extra slash', async()=>{
 let target='';
 const gateway=new ModelGateway(fakeKey,'https://api.deepseek.com','deepseek-flash',async input=>{
  target=String(input);
  return new Response('data: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
 });
 const server=gateway.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No test port');
 const token=gateway.issue({ttlMs:10_000,calls:1});
 try{
  const response=await fetch(`http://127.0.0.1:${address.port}/v1/chat/completions`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({model:'deepseek-flash',messages:[{role:'user',content:'hello'}],stream:true})});
  assert.equal(response.status,200);assert.equal(target,'https://api.deepseek.com/chat/completions');
  await response.arrayBuffer();
 }finally{gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});

test('run capability limits model routing and redacts secrets across streaming chunks', async () => {
  let calls = 0;
  const upstream: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), 'https://example.test/compatible-mode/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${fakeKey}`);
    assert.equal((JSON.parse(String(init?.body)) as { max_tokens: number }).max_tokens, 8192);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encoder.encode('prefix fake-sensi'));
      controller.enqueue(encoder.encode('tive-key-for-test suffix'));
      controller.close();
    } });
    return new Response(stream, { status: 200 });
  };
  const gateway = new ModelGateway(fakeKey, 'https://example.test/compatible-mode/v1', model, upstream);
  const server = gateway.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  const url = `http://127.0.0.1:${address.port}/v1/chat/completions`;
  const token = gateway.issue({ ttlMs: 10000, calls: 1 });
  const call = (capability: string, body: unknown) => fetch(url, { method: 'POST', headers: { authorization: `Bearer ${capability}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const payload = { model, messages: [{ role:'user', content:'hello' }], stream:true };
  try {
    assert.equal((await call('invalid', payload)).status, 401);
    assert.equal((await call(token, { ...payload, model:'other' })).status, 400);
    assert.equal((await call(token, { ...payload, max_tokens:8193 })).status, 400);
    const result = await call(token, payload);
    assert.equal(result.status, 200);
    assert.equal(await result.text(), 'prefix [redacted] suffix');
    assert.equal((await call(token, payload)).status, 401);
    assert.equal(calls, 1);
  } finally { gateway.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('revocation and expiry prevent use; upstream errors are not disclosed', async () => {
  const gateway = new ModelGateway(fakeKey, 'https://example.test/compatible-mode/v1', model, async () => new Response(fakeKey, { status: 401 }));
  const server = gateway.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  const url = `http://127.0.0.1:${address.port}/v1/chat/completions`;
  const call = (token: string) => fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({model,messages:[{role:'user',content:'hello'}]}) });
  try {
    const revoked = gateway.issue({ ttlMs: 1000, calls: 1 }); gateway.revoke(revoked);
    assert.equal((await call(revoked)).status,401);
    const expired = gateway.issue({ ttlMs: 1, calls: 1 }); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await call(expired)).status,401);
    const token = gateway.issue({ ttlMs: 1000, calls: 1 });
    const response = await call(token); assert.equal(response.status,502);
    assert.equal((await response.text()).includes(fakeKey), false);
  } finally { gateway.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('an upstream 429 is redacted and opens a shared cooldown across run capabilities', async () => {
  let upstreamCalls=0,cancelled=false;
  const encoder=new TextEncoder();
  const gateway=new ModelGateway(fakeKey,'https://example.test/compatible-mode/v1',model,async()=>{
    upstreamCalls++;
    await new Promise(resolve=>setTimeout(resolve,25));
    const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(encoder.encode(`${fakeKey} provider details`))},cancel(){cancelled=true}});
    return new Response(body,{status:429,headers:{'retry-after':'5'}});
  });
  const server=gateway.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();if(!address||typeof address==='string')throw new Error('No test port');
  const url=`http://127.0.0.1:${address.port}/v1/chat/completions`;
  const first=gateway.issue({ttlMs:10_000,calls:1}),second=gateway.issue({ttlMs:10_000,calls:1});
  const call=(token:string)=>fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:'hello'}]})});
  try{
    const [rejected,otherRun]=await Promise.all([call(first),call(second)]);
    assert.equal(rejected.status,429);assert.equal(rejected.headers.get('retry-after'),'5');
    assert.equal(otherRun.status,429);assert.equal(otherRun.headers.get('retry-after'),'5');
    const body=await rejected.text();assert.equal(body.includes(fakeKey),false);assert.equal(body.includes('provider details'),false);
    assert.deepEqual(JSON.parse(body),{error:{message:'The model provider rate-limited this run.',type:'rate_limit_error',code:'model_upstream_429'}});
    assert.equal(cancelled,true);assert.equal(gateway.diagnosticCode(first),'model_upstream_429');
    const sameRun=await call(first);assert.equal(sameRun.status,429);assert.equal(sameRun.headers.get('retry-after'),'5');
    assert.equal(gateway.diagnosticCode(first),'model_upstream_429');
    assert.equal(gateway.diagnosticCode(second),'model_upstream_429');assert.equal(upstreamCalls,1);
  }finally{gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});

test('an upstream 429 without Retry-After uses a bounded local cooldown',async()=>{
 let upstreamCalls=0;
 const gateway=new ModelGateway(fakeKey,'https://example.test/compatible-mode/v1',model,async()=>{upstreamCalls++;return new Response('private provider body',{status:429})});
 const server=gateway.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No test port');
 const url=`http://127.0.0.1:${address.port}/v1/chat/completions`,first=gateway.issue({ttlMs:10_000,calls:1}),second=gateway.issue({ttlMs:10_000,calls:1});
 const call=(token:string)=>fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:'hello'}]})});
 try{
  const initial=await call(first),suppressed=await call(second);
  assert.equal(initial.status,429);assert.equal(initial.headers.get('retry-after'),'60');
  assert.equal(suppressed.status,429);assert.equal(suppressed.headers.get('retry-after'),'60');
  assert.equal((await initial.text()).includes('private provider body'),false);assert.equal(upstreamCalls,1);
 }finally{gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});

test('the gateway restores parallel model requests after its initial healthy probe',async()=>{
 let upstreamCalls=0,parallelCalls=0,maxParallelCalls=0,releaseParallel!:()=>void;
 const parallelBarrier=new Promise<void>(resolve=>{releaseParallel=resolve});
 const gateway=new ModelGateway(fakeKey,'https://example.test/compatible-mode/v1',model,async()=>{
  upstreamCalls++;
  if(upstreamCalls===1)return new Response('{}');
  parallelCalls++;maxParallelCalls=Math.max(maxParallelCalls,parallelCalls);
  if(parallelCalls===2)releaseParallel();
  await parallelBarrier;parallelCalls--;
  return new Response('{}');
 });
 const server=gateway.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No test port');
 const url=`http://127.0.0.1:${address.port}/v1/chat/completions`,token=gateway.issue({ttlMs:10_000,calls:3});
 const call=()=>fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:'hello'}]})});
 try{
  const initial=await call();assert.equal(initial.status,200);await initial.text();
  const responses=await Promise.all([call(),call()]);
  for(const response of responses){assert.equal(response.status,200);await response.text()}
  assert.equal(upstreamCalls,3);assert.equal(maxParallelCalls,2);
 }finally{gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});

test('routine capabilities require an owner Bot and live-run scope and reject malformed schedule payloads',async()=>{
 const calls:{action:string;scope:unknown;routineId?:string;input?:unknown}[]=[];
 const routines={
  list:async(scope:unknown)=>{calls.push({action:'list',scope});return[]},
  create:async(scope:unknown,input:unknown)=>{calls.push({action:'create',scope,input});return{id:'routine-id'}},
  update:async(scope:unknown,routineId:string,input:unknown)=>{calls.push({action:'update',scope,routineId,input});return{id:routineId}},
 };
 const gateway=new ModelGateway(fakeKey,'https://example.test/compatible-mode/v1',model,fetch,undefined,undefined,undefined,undefined,routines as never);
 const server=gateway.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();if(!address||typeof address==='string')throw new Error('No test port');
 const url=`http://127.0.0.1:${address.port}/v1/bot-routines`;
 const botId='11111111-1111-4111-8111-111111111111',runId='22222222-2222-4222-8222-222222222222',leaseId='33333333-3333-4333-8333-333333333333';
 const scope={botId,runId,leaseId,owner:{tenantId:'44444444-4444-4444-8444-444444444444',userId:'55555555-5555-4555-8555-555555555555'}};
 const token=gateway.issue({ttlMs:10_000,calls:1,scope}),unscoped=gateway.issue({ttlMs:10_000,calls:1});
 const request=(capability:string,path='',init:RequestInit={})=>fetch(`${url}${path}`,{...init,headers:{authorization:`Bearer ${capability}`,...init.headers}});
 const input={name:'Weekly review',instruction:'Prepare a short status.',timezone:'Asia/Shanghai',schedule:{kind:'weekly',weekday:1,hour:9,minute:30}};
 try{
  assert.equal((await request(unscoped)).status,404);
  assert.equal((await request(token)).status,200);
  assert.equal((await request(token,'',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})).status,201);
  const routineId='66666666-6666-4666-8666-666666666666';
  assert.equal((await request(token,`/${routineId}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(input)})).status,200);
  assert.equal((await request(token,'',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...input,unexpected:true})})).status,400);
  assert.equal(calls.length,3);for(const call of calls)assert.deepEqual(call.scope,scope);
  assert.equal(calls[2].routineId,routineId);
 }finally{gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
