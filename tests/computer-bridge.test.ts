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
test('terminal approval is exact, lease-bound, screenshot-bound, and consumed before local execution',async()=>{
 let actionText='',consumed=0,workerActions=0,owner:'agent'|'user'='agent',screenshot='a'.repeat(64);
 const approvals:any={
  propose:async(_runId:string,_leaseId:string,action:string)=>{actionText=action;return {id:randomUUID(),action}},
  consume:async(_runId:string,_leaseId:string,_id:string,action:string)=>{if(action!==actionText)return false;consumed++;return true},
  status:async()=>null,
 };
 const worker={
  control:async()=>({owner}),snapshot:async()=>({owner,url:'https://example.test/',screenshotSha256:screenshot}),
  snapshotWithImage:async()=>({state:{owner,url:'https://example.test/',screenshotSha256:screenshot},image:Buffer.from('screenshot')}),
  inspect:async()=>({ready:true}),screenshot:async()=>Buffer.from('png'),performIfUnchanged:async()=>{workerActions++;return {ready:true}},
 };
 const bridge=new ComputerBridge({hasLiveLease:async()=>true},approvals,()=>worker),signal=new AbortController().signal;
 const input={kind:'terminal',action:'run',command:'printf approved',directory:'task'};
 const approval=await bridge.propose(scope,input,signal);assert.ok(approval.id);assert.match(actionText,/printf approved/);
 assert.deepEqual(await bridge.execute(scope,approval.id,input,signal),{approved:true});assert.equal(consumed,1);assert.equal(workerActions,0);
 const changed=await bridge.propose(scope,input,signal);screenshot='b'.repeat(64);
 await assert.rejects(bridge.execute(scope,changed.id,input,signal),/missing, expired or does not match/);assert.equal(consumed,1);
 owner='user';await assert.rejects(bridge.propose(scope,input,signal),/User controls the computer/);assert.equal(consumed,1);
});
