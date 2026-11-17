import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RunScheduler } from '../src/server/run-scheduler.ts';

async function waitFor(check) {
  for (let attempt=0;attempt<200;attempt++) { if (check()) return; await new Promise(resolve=>setTimeout(resolve,10)); }
  throw new Error('Timed out waiting for the Bot screen scheduler');
}

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}

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

test('a pending claim on one Bot screen does not block later screens or future scans', async () => {
  const tenantId=randomUUID(),userId=randomUUID(),botA=randomUUID(),botB=randomUUID(),botC=randomUUID();
  const scopes=[botA,botB,botC].map(botId=>({tenantId,userId,botId}));
  const running=new Set(),completed=new Set(),runToBot=new Map(),started=[],releases=new Map(),aClaim=deferred();
  let claimsForA=0;
  const store={
    async queuedScreens(){return scopes.filter(scope=>!running.has(scope.botId)&&!completed.has(scope.botId));},
    async claimNext(scope){
      if(scope.botId===botA){claimsForA++;return aClaim.promise;}
      if(running.has(scope.botId)||completed.has(scope.botId))return null;
      running.add(scope.botId);
      const runId=randomUUID();runToBot.set(runId,scope.botId);
      return{run:{id:runId,botId:scope.botId,prompt:'test',status:'running',files:[]},leaseId:randomUUID()};
    },
    async renew(){return true;},
    async finish(runId){const botId=runToBot.get(runId);running.delete(botId);completed.add(botId);return true;},
    async markUnknown(){return true;},
  };
  const executor={execute(scope,run){started.push(scope.botId);return new Promise(resolve=>releases.set(scope.botId,()=>resolve({status:'completed',result:'done'})));}};
  const scheduler=new RunScheduler(store,executor,{concurrency:2,leaseSeconds:60,claimSlowAfterMs:1_000,onClaimEvent(){}});
  try{
    await scheduler.tick();
    await waitFor(()=>started.includes(botB));
    assert.equal(started.includes(botA),false,'the unresolved first claim must not delay the next Bot');
    assert.equal(started.includes(botC),false,'pending claim plus active run still consume the two global slots');
    assert.equal(claimsForA,1,'a pending claim must not be duplicated by another scan');

    releases.get(botB)();
    await waitFor(()=>completed.has(botB));
    await scheduler.tick();
    await waitFor(()=>started.includes(botC));
    assert.equal(started.includes(botA),false,'a later Bot must progress while the earlier claim remains pending');
    assert.equal(started.filter(botId=>botId!==botB).length,1,'the scheduler must keep the global concurrency limit');

    const runId=randomUUID();
    aClaim.resolve({run:{id:runId,botId:botA,prompt:'test',status:'running',files:[]},leaseId:randomUUID()});
    running.add(botA);runToBot.set(runId,botA);
    await waitFor(()=>started.includes(botA));
    releases.get(botA)();
    releases.get(botC)();
    await waitFor(()=>completed.has(botA)&&completed.has(botC));
  }finally{
    if(!started.includes(botA)){const runId=randomUUID();aClaim.resolve({run:{id:runId,botId:botA,prompt:'test',status:'running',files:[]},leaseId:randomUUID()});running.add(botA);runToBot.set(runId,botA);}
    for(const release of releases.values())release();
    await scheduler.stop();
  }
});

test('a rejected screen claim is logged without details and retried on a later scan', async()=>{
  const tenantId=randomUUID(),userId=randomUUID(),botId=randomUUID(),runId=randomUUID(),events=[],started=deferred();
  let claims=0,finished=false;
  const scope={tenantId,userId,botId};
  const store={
    async queuedScreens(){return finished?[]:[scope];},
    async claimNext(){if(++claims===1)throw new Error('sensitive database details');return{run:{id:runId,botId,prompt:'test',status:'running',files:[]},leaseId:randomUUID()};},
    async renew(){return true;},async finish(){finished=true;return true;},async markUnknown(){return true;},
  };
  const scheduler=new RunScheduler(store,{execute:async()=>{started.resolve();return{status:'completed',result:'done'};}},{concurrency:1,leaseSeconds:60,onClaimEvent:event=>events.push(event)});
  try{
    await scheduler.tick();
    await waitFor(()=>events.some(event=>event.event==='grok_scheduler_claim_failed'));
    assert.equal(JSON.stringify(events).includes('sensitive database details'),false);
    assert.equal(events.find(event=>event.event==='grok_scheduler_claim_failed').failureClass,'unknown');
    await scheduler.tick();
    await started.promise;
    await waitFor(()=>finished);
    assert.equal(claims,2);
  }finally{await scheduler.stop();}
});

test('a scheduler claim failure records only a safe database category',async()=>{
  const tenantId=randomUUID(),userId=randomUUID(),botId=randomUUID(),events=[];
  const store={
    async queuedScreens(){return[{tenantId,userId,botId}]},
    async claimNext(){throw Object.assign(new Error('private SQL and connection details'),{code:'ER_LOCK_DEADLOCK'})},
    async renew(){return true},async finish(){return true},async markUnknown(){return true},
  };
  const scheduler=new RunScheduler(store,{execute:async()=>({status:'completed',result:'unused'})},{concurrency:1,leaseSeconds:60,onClaimEvent:event=>events.push(event)});
  try{
    await scheduler.tick();
    await waitFor(()=>events.some(event=>event.event==='grok_scheduler_claim_failed'));
    const event=events.find(item=>item.event==='grok_scheduler_claim_failed');
    assert.equal(event.failureClass,'database_deadlock');
    assert.equal(JSON.stringify(event).includes('private SQL'),false);
  }finally{await scheduler.stop()}
});

test('a transient result-store deadlock retries persistence without replaying the Agent task',async()=>{
  const tenantId=randomUUID(),userId=randomUUID(),botId=randomUUID(),runId=randomUUID(),events=[];
  let claims=0,executions=0,finishes=0,saved=false;
  const store={
    async queuedScreens(){return saved?[]:[{tenantId,userId,botId}]},
    async claimNext(){if(claims++)return null;return{run:{id:runId,botId,prompt:'send a message once',status:'running',files:[]},leaseId:randomUUID()}},
    async renew(){return true;},
    async finish(){if(++finishes===1)throw Object.assign(new Error('sensitive SQL details'),{code:'ER_LOCK_DEADLOCK'});saved=true;return true;},
    async markUnknown(){assert.fail('successful result persistence should not mark the run unknown');},
  };
  const scheduler=new RunScheduler(store,{execute:async()=>{executions++;return{status:'completed',result:'sent'}}},{concurrency:1,leaseSeconds:60,onClaimEvent:event=>events.push(event)});
  try{
    await scheduler.tick();
    await waitFor(()=>saved);
    assert.equal(executions,1,'only persistence is retried; the task executor runs once');
    assert.equal(finishes,2);
    assert.ok(events.some(event=>event.event==='grok_scheduler_finish_retry'&&event.failureClass==='database_deadlock'));
    assert.equal(JSON.stringify(events).includes('sensitive SQL'),false);
  }finally{await scheduler.stop()}
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
