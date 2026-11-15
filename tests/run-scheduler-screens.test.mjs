import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RunScheduler } from '../src/server/run-scheduler.ts';

async function waitFor(check) {
  for (let attempt=0;attempt<200;attempt++) { if (check()) return; await new Promise(resolve=>setTimeout(resolve,10)); }
  throw new Error('Timed out waiting for the Bot screen scheduler');
}

test('run scheduler locks each Bot screen while allowing same-user screens to overlap', async () => {
  const tenantId=randomUUID(),userId=randomUUID(),botA=randomUUID(),botB=randomUUID();
  const queues=new Map([[botA,[randomUUID(),randomUUID()]],[botB,[randomUUID()]]]);
  const active=new Set(),runToBot=new Map(),finished=new Set(),started=[],releases=new Map();
  const scopes=new Map([[botA,{tenantId,userId,botId:botA}],[botB,{tenantId,userId,botId:botB}]]);
  const store={
    async markExpiredUnknown(){return 0;},
    async queuedScreens(limit){return [...queues].filter(([bot,runs])=>runs.length&&!active.has(bot)).slice(0,limit).map(([bot])=>scopes.get(bot));},
    async claimNext(scope){const runs=queues.get(scope.botId);if(!runs?.length||active.has(scope.botId))return null;const id=runs.shift();active.add(scope.botId);runToBot.set(id,scope.botId);return {run:{id,botId:scope.botId,prompt:'test',status:'running',files:[]},leaseId:randomUUID()};},
    async renew(){return true;},
    async finish(runId){finished.add(runId);active.delete(runToBot.get(runId));return true;},
    async markUnknown(){return true;},
  };
  const executor={execute(scope,run){started.push({botId:scope.botId,runId:run.id});return new Promise(resolve=>releases.set(run.id,()=>resolve({status:'completed',result:'done'})));}};
  const scheduler=new RunScheduler(store,executor,{concurrency:2,leaseSeconds:60});
  try {
    await scheduler.tick();
    await waitFor(()=>started.length===2);
    assert.deepEqual(new Set(started.map(item=>item.botId)),new Set([botA,botB]));
    const firstA=started.find(item=>item.botId===botA).runId;
    assert.equal(queues.get(botA).length,1,'the second task for Bot A must remain queued');
    assert.equal(started.filter(item=>item.botId===botA).length,1);
    releases.get(firstA)();
    await waitFor(()=>finished.has(firstA)&&!active.has(botA));
    await new Promise(resolve=>setImmediate(resolve));
    await scheduler.tick();
    await waitFor(()=>started.filter(item=>item.botId===botA).length===2);
    assert.equal(started.find(item=>item.botId===botB).runId===firstA,false);
    for (const release of releases.values()) release();
    await waitFor(()=>finished.size===3);
  } finally {
    for (const release of releases.values()) release();
    await scheduler.stop();
  }
});

test('scheduler passes a queue creation cutoff through selection and claim', async () => {
  const cutoff=new Date('2026-11-14T12:00:00.000Z'),tenantId=randomUUID(),userId=randomUUID(),botId=randomUUID(),seen=[];
  const store={
    async markExpiredUnknown(){return 0;},
    async queuedScreens(_limit,createdAfter){seen.push(['queuedScreens',createdAfter]);return [{tenantId,userId,botId}];},
    async claimNext(_scope,_leaseSeconds,createdAfter){seen.push(['claimNext',createdAfter]);return null;},
    async renew(){return true;},async finish(){return true;},async markUnknown(){return true;}
  };
  const scheduler=new RunScheduler(store,{execute:async()=>({status:'completed',result:'unused'})},{concurrency:1,leaseSeconds:30,queueCreatedAfter:cutoff});
  await scheduler.tick();await scheduler.stop();
  assert.deepEqual(seen,[['queuedScreens',cutoff],['claimNext',cutoff]]);
});

test('a transient lease renewal error retries before the lease can expire', async () => {
  const tenantId=randomUUID(),userId=randomUUID(),botId=randomUUID(),runId=randomUUID();
  let renewals=0,started=false,aborted=false,finished=false,release;
  const store={
    async markExpiredUnknown(){return 0;},
    async queuedScreens(){return started?[]:[{tenantId,userId,botId}];},
    async claimNext(){if(started)return null;started=true;return {run:{id:runId,botId,prompt:'test',status:'running',files:[]},leaseId:randomUUID()};},
    async renew(){renewals++;if(renewals===1)throw new Error('temporary database timeout');return true;},
    async finish(){finished=true;return true;},
    async markUnknown(){return true;},
  };
  const scheduler=new RunScheduler(store,{execute:async(_scope,_run,signal)=>{
    signal.addEventListener('abort',()=>{aborted=true;},{once:true});
    await new Promise(resolve=>{release=resolve;});
    return {status:'completed',result:'done'};
  }},{concurrency:1,leaseSeconds:6});
  try{
    await scheduler.tick();
    await waitFor(()=>typeof release==='function');
    await waitFor(()=>renewals>=1,4000);
    await waitFor(()=>renewals>=2,2000);
    assert.equal(aborted,false,'one failed renewal must not interrupt an otherwise live task');
    release();
    await waitFor(()=>finished);
  }finally{
    release?.();
    await scheduler.stop();
  }
});
