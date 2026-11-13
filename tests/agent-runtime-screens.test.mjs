import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

async function freePort() {
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
async function waitFor(file) {
  for(let i=0;i<200;i++){try{await access(file);return;}catch{}await new Promise(resolve=>setTimeout(resolve,25));}
  throw new Error('Timed out waiting for runtime marker');
}

test('Agent runtime parallelizes Bot screens, serializes one screen, and interrupts the active screen for takeover',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'grok-agent-screens-')),workspace=join(dir,'workspace');await mkdir(workspace,{recursive:true});
  const runtimeToken=randomUUID(),workerToken=randomUUID(),runtimePort=await freePort(),workerPort=await freePort();
  const botA=randomUUID(),botB=randomUUID(),controlScreens=[],owners=new Map();
  const worker=createServer((req,res)=>{
    if(req.url==='/v1/control'&&req.headers.authorization==='Bearer '+workerToken){const screenId=req.headers['x-coke-grok-screen-id'];controlScreens.push(screenId);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({owner:owners.get(screenId)||'agent'}));return;}
    res.writeHead(404);res.end();
  });worker.listen(workerPort,'127.0.0.1');await once(worker,'listening');
  const adapterSource="import {access,writeFile} from 'node:fs/promises';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>raw+=chunk);process.stdin.on('end',async()=>{const input=JSON.parse(raw),root=process.env.TEST_CAPTURE_DIR;await writeFile(root+'/start-'+input.taskId,JSON.stringify(input));if(input.prompt.startsWith('HOLD_SCREEN_LOCK')){await writeFile(root+'/held-'+input.taskId,'');while(true){try{await access(root+'/release-'+input.taskId);break}catch{}await new Promise(resolve=>setTimeout(resolve,20))}}await writeFile(root+'/finished-'+input.taskId,'');process.stdout.write(JSON.stringify({status:'done',message:'screen task completed'}));});";
  const kernels={pi:{command:process.execPath,args:['--input-type=module','-e',adapterSource]}};
  const runtime=spawn(process.execPath,['deploy/desktop/agent-runtime.mjs'],{cwd:process.cwd(),env:{...process.env,DOTS_AGENT_RUNTIME_TOKEN:runtimeToken,DOTS_AGENT_RUNTIME_PORT:String(runtimePort),LINUX_DESKTOP_WORKER_TOKEN:workerToken,LINUX_DESKTOP_WORKER_PORT:String(workerPort),DOTS_AGENT_WORKSPACE:workspace,TEST_CAPTURE_DIR:workspace,DOTS_DESKTOP_AGENT_ADAPTERS:'pi',DOTS_AGENT_KERNELS_JSON:JSON.stringify(kernels),COKE_GROK_MEDIATED_COMPUTER:'0',COKE_GROK_AGENT_PARALLELISM:'2'},stdio:['ignore','pipe','pipe']});
  let runtimeStderr='';runtime.stdout.resume();runtime.stderr.setEncoding('utf8');runtime.stderr.on('data',chunk=>runtimeStderr+=chunk);
  const base='http://127.0.0.1:'+runtimePort;
  try{
    let ready=false;
    for(let i=0;i<100;i++){if(runtime.exitCode!==null)throw new Error('Agent runtime exited before readiness');try{if((await fetch(base+'/healthz')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
    assert.equal(ready,true);
    const submit=(taskId,botId,prompt)=>{const pending=fetch(base+'/v1/tasks/run',{method:'POST',headers:{authorization:'Bearer '+runtimeToken,'content-type':'application/json'},body:JSON.stringify({engine:'pi',taskId,botId,screenId:botId,cwd:'tasks/'+taskId,prompt,modelConfig:{apiKey:'synthetic-model-key',baseUrl:'https://model.invalid/v1',model:'fixture-model'}})});pending.catch(()=>{});return pending};
    const firstId=randomUUID(),secondId=randomUUID(),parallelId=randomUUID();
    const first=submit(firstId,botA,'HOLD_SCREEN_LOCK');await waitFor(join(workspace,'start-'+firstId));await waitFor(join(workspace,'held-'+firstId));
    const second=submit(secondId,botA,'same screen queued');
    const parallel=submit(parallelId,botB,'HOLD_SCREEN_LOCK other screen parallel');
    await waitFor(join(workspace,'start-'+parallelId));await waitFor(join(workspace,'held-'+parallelId));
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await access(join(workspace,'start-'+secondId)).then(()=>true,()=>false),false,'second task on the active Bot screen must wait');
    const parallelInput=JSON.parse(await readFile(join(workspace,'start-'+parallelId),'utf8'));
    assert.equal(parallelInput.botId,botB);assert.equal(parallelInput.screenId,botB);assert.equal(parallelInput.computer.screenId,botB);
    assert.ok(controlScreens.includes(botA));assert.ok(controlScreens.includes(botB));
    await writeFile(join(workspace,'release-'+firstId),'');
    assert.equal((await first).status,200);await waitFor(join(workspace,'start-'+secondId));
    assert.equal((await second).status,200,'the next same-Bot task should start after the previous task completes');
    const takeoverId=randomUUID(),takeoverRun=submit(takeoverId,botA,'HOLD_SCREEN_LOCK active takeover');
    await waitFor(join(workspace,'start-'+takeoverId));await waitFor(join(workspace,'held-'+takeoverId));
    owners.set(botA,'user');
    const takeover=await fetch(base+'/v1/tasks/pause',{method:'POST',headers:{authorization:'Bearer '+runtimeToken,'content-type':'application/json'},body:JSON.stringify({botId:botA})});
    assert.equal(takeover.status,200);assert.deepEqual(await takeover.json(),{paused:true},'taking over an active Bot screen must interrupt its running adapter process');
    const takeoverResponse=await takeoverRun;assert.equal(takeoverResponse.status,200);
    const takeoverResult=await takeoverResponse.json();assert.equal(takeoverResult.status,'waiting');assert.equal(takeoverResult.pausedForControl,true);
    assert.equal(await access(join(workspace,'finished-'+parallelId)).then(()=>true,()=>false),false,'taking over Bot A must not cancel an active Bot B task');
    const blockedId=randomUUID(),blocked=await submit(blockedId,botA,'task submitted while the owner controls the screen');
    assert.equal(blocked.status,200);const blockedResult=await blocked.json();assert.equal(blockedResult.status,'waiting');assert.equal(blockedResult.pausedForControl,true);assert.equal(blockedResult.controlOwner,'user');
    const ownerEvents=runtimeStderr.split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(event=>event.event==='coke_grok_computer_control_observed');
    assert.ok(ownerEvents.some(event=>event.phase==='run_start'&&event.owner==='user'),'a blocked run must record the observed owner and phase');
    assert.ok(ownerEvents.every(event=>event.screenKey&&!event.screenKey.includes(botA)&&!event.screenKey.includes(botB)),'control logs use a screen hash instead of raw Bot IDs');
    assert.equal(await access(join(workspace,'start-'+blockedId)).then(()=>true,()=>false),false,'a new run must not start an adapter while its Bot screen is controlled by the user');
    owners.set(botA,'unexpected');
    const unknownOwnerId=randomUUID(),unknownOwner=await submit(unknownOwnerId,botA,'task submitted with an invalid owner response');
    assert.equal(unknownOwner.status,200);const unknownOwnerResult=await unknownOwner.json();assert.equal(unknownOwnerResult.status,'waiting');assert.equal(unknownOwnerResult.pausedForControl,false);assert.equal(unknownOwnerResult.controlOwner,'unknown');
    const unknownOwnerEvents=runtimeStderr.split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(event=>event.event==='coke_grok_computer_control_observed');
    assert.ok(unknownOwnerEvents.some(event=>event.phase==='run_start'&&event.owner==='unknown'),'an invalid owner response must not be attributed to the user');
    await writeFile(join(workspace,'release-'+parallelId),'');assert.equal((await parallel).status,200,'Bot B must finish when its own hold is released');
    assert.equal(await access(join(workspace,'finished-'+parallelId)).then(()=>true,()=>false),true);
    owners.set(botA,'agent');
    const resumedId=randomUUID(),resumed=await submit(resumedId,botA,'new task after returning control');
    assert.equal(resumed.status,200);assert.equal((await resumed.json()).status,'done');await waitFor(join(workspace,'start-'+resumedId));
    const badId=randomUUID(),mismatch=await fetch(base+'/v1/tasks/run',{method:'POST',headers:{authorization:'Bearer '+runtimeToken,'content-type':'application/json'},body:JSON.stringify({engine:'pi',taskId:badId,botId:botA,screenId:botB,cwd:'tasks/'+badId,prompt:'bad screen binding',modelConfig:{apiKey:'synthetic-model-key',baseUrl:'https://model.invalid/v1',model:'fixture-model'}})});
    assert.equal(mismatch.status,400);
  }finally{
    runtime.kill('SIGTERM');await Promise.race([once(runtime,'exit'),new Promise(resolve=>setTimeout(resolve,2000))]);
    await new Promise(resolve=>worker.close(resolve));await rm(dir,{recursive:true,force:true});
  }
});
