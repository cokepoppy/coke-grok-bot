import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {ModelGateway} from '../src/server/model-gateway.ts';
test('internal action approval routes are disabled for every run capability',async()=>{
 const gateway=new ModelGateway('fake-provider-key','https://example.test/compatible-mode/v1','model',async()=>new Response('{}'));
 const server=gateway.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No gateway');const base=`http://127.0.0.1:${address.port}/v1/action-approvals`;
 try{
  const id=randomUUID(),token=gateway.issue({ttlMs:30000,calls:1,scope:{runId:randomUUID(),leaseId:randomUUID()}}),unscoped=gateway.issue({ttlMs:30000,calls:1});
  const call=(path:string,cap:string,body?:unknown)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${cap}`,...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  assert.equal((await call('',token,{action:'Send test action'})).status,410);
  assert.equal((await call(`/${id}`,token)).status,410);
  assert.equal((await call(`/${id}/consume`,token,{action:'Send test action'})).status,410);
  assert.equal((await call('',unscoped,{action:'Send test action'})).status,410);
  assert.equal((await call('',randomUUID(),{action:'Send test action'})).status,401);
  gateway.revoke(token);assert.equal((await call(`/${id}`,token)).status,401);
 }finally{gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
