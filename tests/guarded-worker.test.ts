import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {HttpGuardedComputerWorker} from '../src/server/guarded-worker.ts';
const owner={tenantId:randomUUID(),userId:randomUUID()},hash=createHash('sha256').update(`${owner.tenantId}:${owner.userId}`).digest('hex').slice(0,32),url=new URL(`http://desktop.grok-user-${hash}.svc.cluster.local:8082/`),token=randomBytes(32).toString('base64url'),taskId=randomUUID(),screenId=randomUUID(),signal=new AbortController().signal;
test('guarded worker scopes endpoint and task identity to the owner',async()=>{
 let calls=0;const worker=new HttpGuardedComputerWorker(owner,screenId,url,token,taskId,async (request,init)=>{calls++;assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${token}`);assert.equal(new Headers(init?.headers).get('x-coke-grok-screen-id'),screenId);if(calls===1){assert.equal(new URL(String(request)).pathname,'/v1/guarded/snapshot');return Response.json({owner:'agent',url:'https://example.test/',screenshotSha256:'a'.repeat(64)})}const body=JSON.parse(String(init?.body));assert.equal(body.action.taskId,taskId);assert.equal(body.action.action,'click');return Response.json({ready:true})});
 const state=await worker.snapshot(signal);assert.equal(state.owner,'agent');assert.deepEqual(await worker.performIfUnchanged({kind:'browser',action:'click',by:'role',role:'button',target:'Submit'},state,signal),{ready:true});
 await assert.rejects(worker.performIfUnchanged({kind:'browser',action:'click',taskId:randomUUID()},state,signal));assert.equal(calls,2);
 assert.throws(()=>new HttpGuardedComputerWorker(owner,screenId,new URL('http://other.svc:8082/'),token,taskId));
 assert.throws(()=>new HttpGuardedComputerWorker(owner,'not-a-bot',url,token,taskId));
});
