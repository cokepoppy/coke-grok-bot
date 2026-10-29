import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ComputerBridge,type RunScope} from '../src/server/computer-bridge.ts';
const scope:RunScope={owner:{tenantId:randomUUID(),userId:randomUUID()},runId:randomUUID(),leaseId:randomUUID()};
test('bridge refuses expired or mismatched run scopes before reading a desktop',async()=>{
 let calls=0,live=false;const worker={control:async()=>({owner:'agent' as const}),snapshot:async()=>{calls++;return {owner:'agent' as const,url:'https://example.test/',screenshotSha256:'a'.repeat(64)}},inspect:async()=>{calls++;return {ready:true}},screenshot:async()=>{calls++;return Buffer.from('png')},performIfUnchanged:async()=>{calls++;return {ready:true}}};
 const approvals={propose:async()=>null,consume:async()=>false,status:async()=>null};
 const bridge=new ComputerBridge({hasLiveLease:async(owner,runId,leaseId)=>live&&owner.userId===scope.owner.userId&&runId===scope.runId&&leaseId===scope.leaseId},approvals,()=>worker),signal=new AbortController().signal;
 await assert.rejects(bridge.inspect(scope,signal));await assert.rejects(bridge.screenshot(scope,signal));assert.equal(calls,0);
 live=true;assert.deepEqual(await bridge.inspect(scope,signal),{ready:true});
 await assert.rejects(bridge.inspect({...scope,owner:{...scope.owner,userId:randomUUID()}},signal));
 await assert.rejects(bridge.propose({...scope,leaseId:randomUUID()},{kind:'desktop',action:'click',x:1,y:1},signal));assert.equal(calls,1);
 const abort=new AbortController();abort.abort();await assert.rejects(bridge.screenshot(scope,abort.signal));assert.equal(calls,1);
});
