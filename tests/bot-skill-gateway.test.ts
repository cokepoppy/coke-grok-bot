import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {ModelGateway} from '../src/server/model-gateway.ts';
import {validateSkillInput} from '../src/server/bot-skill-store.ts';

const id=()=>randomUUID(),key='test-provider-key';

test('run-scoped Bot Skill gateway requires a matching owner capability and explicit mutation flags',async()=>{
  const botId=id(),runId=id(),leaseId=id(),tenantId=id(),userId=id(),skillId=id();let listed=0,created=0,updated=0,removed=0;
  const bridge={
    list:async(scope:unknown,signal:AbortSignal)=>{assert.equal(signal.aborted,false);assert.deepEqual(scope,{owner:{tenantId,userId},botId,runId,leaseId});listed++;return[{id:skillId,name:'Review',enabled:true}]},
    create:async(_scope:unknown,input:unknown,allowed:boolean)=>{if(!allowed)throw new Error('The user must directly ask to save or create a Skill.');const valid=validateSkillInput(input);created++;return{id:skillId,...valid}},
    update:async(_scope:unknown,target:string,input:unknown,allowed:boolean)=>{if(!allowed)throw new Error('The user must directly ask to edit a Skill.');assert.equal(target,skillId);const valid=validateSkillInput(input);updated++;return{id:target,...valid}},
    remove:async(_scope:unknown,target:string,allowed:boolean)=>{if(!allowed)throw new Error('The user must directly ask to delete a Skill.');assert.equal(target,skillId);removed++;return removed===1},
  };
  const gateway=new ModelGateway(key,'https://example.test/compatible-mode/v1','model',fetch,undefined,undefined,undefined,undefined,undefined,bridge as never);
  const server=gateway.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No test port');
  const base=`http://127.0.0.1:${address.port}/v1/bot-skills`,owner={tenantId,userId};
  const denied=gateway.issue({ttlMs:30_000,calls:1,scope:{runId,leaseId,botId,owner,skillMutations:{create:false,update:false,delete:false}}});
  const allowed=gateway.issue({ttlMs:30_000,calls:10,scope:{runId,leaseId,botId,owner,skillMutations:{create:true,update:true,delete:true}}});
  const call=(token:string,path='',method='GET',body?:unknown)=>fetch(`${base}${path}`,{method,headers:{authorization:`Bearer ${token}`,...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const input={name:'Review',description:'Check changes.',instructions:'Compare sources.'};
  try{
    assert.equal((await call(allowed)).status,200);assert.equal(listed,1);
    assert.equal((await call(denied,'','POST',{action:'create',skill:input})).status,403);assert.equal(created,0);
    assert.equal((await call(allowed,'','POST',{action:'create',skill:input})).status,201);assert.equal(created,1);
    assert.equal((await call(allowed,`/${skillId}`,'PATCH',{action:'update',skill:{...input,name:'Updated'}})).status,200);assert.equal(updated,1);
    assert.equal((await call(allowed,`/${skillId}`,'DELETE')).status,200);assert.equal(removed,1);
    assert.equal((await call(allowed,`/${skillId}`,'DELETE')).status,404);
    const malformed=gateway.issue({ttlMs:30_000,calls:1,scope:{runId,leaseId,botId,owner,skillMutations:{create:true,update:true,delete:true}}});
    assert.equal((await call(malformed,'','POST',{action:'create',skill:{...input,extra:'must reject'}})).status,400);
    assert.equal((await call('invalid')).status,401);
  }finally{gateway.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
