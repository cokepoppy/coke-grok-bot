import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

async function freePort() {
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}

async function startRuntime(worker,adapterDelayMs) {
  const dir=await mkdtemp(join(tmpdir(),'grok-agent-control-poll-'));
  const workerToken=randomUUID(),runtimeToken=randomUUID(),runtimePort=await freePort(),workerPort=await freePort();
  const runtime=spawn(process.execPath,['deploy/desktop/agent-runtime.mjs'],{cwd:process.cwd(),env:{...process.env,DOTS_AGENT_RUNTIME_TOKEN:runtimeToken,DOTS_AGENT_RUNTIME_PORT:String(runtimePort),LINUX_DESKTOP_WORKER_TOKEN:workerToken,LINUX_DESKTOP_WORKER_PORT:String(workerPort),DOTS_AGENT_WORKSPACE:dir,DOTS_DESKTOP_AGENT_ADAPTERS:'pi',DOTS_AGENT_KERNELS_JSON:JSON.stringify({pi:{command:process.execPath,args:['--input-type=module','-e',`process.stdin.resume();process.stdin.on('end',()=>setTimeout(()=>process.stdout.write(JSON.stringify({status:'done',message:'control poll fixture completed'})),${adapterDelayMs}));` ]}}),COKE_GROK_MEDIATED_COMPUTER:'0'},stdio:['ignore','pipe','pipe']});
  runtime.stdout.resume();runtime.stderr.resume();
  let ready=false;
  for(let i=0;i<100;i++){
    if(runtime.exitCode!==null)throw new Error('Agent runtime exited before readiness');
    try{const response=await fetch(`http://127.0.0.1:${runtimePort}/healthz`);if(response.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(ready,true,'Agent runtime must become ready');
  const workerHandle=worker({workerPort,workerToken});
  await workerHandle.ready;
  return {
    dir,runtime,workerHandle,runtimePort,runtimeToken,
    async run() {
      const taskId=randomUUID(),botId=randomUUID();
      const response=await fetch(`http://127.0.0.1:${runtimePort}/v1/tasks/run`,{method:'POST',headers:{authorization:`Bearer ${runtimeToken}`,'content-type':'application/json'},body:JSON.stringify({engine:'pi',taskId,botId,screenId:botId,cwd:`tasks/${taskId}`,prompt:'synthetic computer-control polling test',modelConfig:{apiKey:'synthetic-model-key',baseUrl:'https://model.invalid/v1',model:'fixture-model'}})});
      return {status:response.status,body:await response.json()};
    },
    async close() {
      runtime.kill('SIGTERM');await Promise.race([once(runtime,'exit'),new Promise(resolve=>setTimeout(resolve,2000))]);
      await workerHandle.close();await rm(dir,{recursive:true,force:true});
    },
  };
}

test('Agent runtime retries a transient computer-control transport failure and continues after recovery',async()=>{
  let calls=0,currentServer=null,reopenTimer=null;
  const fixture=await startRuntime(({workerPort,workerToken})=>{
    const handler=(req,res)=>{
      if(req.url!=='/v1/control'||req.headers.authorization!==`Bearer ${workerToken}`){res.writeHead(404);res.end();return;}
      calls+=1;res.writeHead(200,{'content-type':'application/json'});res.end('{"owner":"agent"}');
      if(calls===1){
        setTimeout(()=>{
          currentServer.close(()=>{
            reopenTimer=setTimeout(()=>{
              currentServer=createServer(handler);currentServer.listen(workerPort,'127.0.0.1');
            },2200);
          });
        },100);
      }
    };
    currentServer=createServer(handler);currentServer.listen(workerPort,'127.0.0.1');
    return {ready:once(currentServer,'listening'),close:async()=>{clearTimeout(reopenTimer);if(currentServer?.listening)await new Promise(resolve=>currentServer.close(resolve));}};
  },4300);
  try{
    const {status,body}=await fixture.run();
    assert.equal(status,200);assert.equal(body.status,'done');assert.ok(calls>=2,'control polling must resume after the worker returns');
    assert.ok(body.runtimeTrace.some(event=>event.event==='agent.computer.control'&&event.outcome==='info'&&event.diagnosticCode==='COMPUTER_CONTROL_CHECK_RETRY'&&event.attemptNumber===1&&event.transportCode==='ECONNREFUSED'),`the transient failure must be retained in the task trace: ${JSON.stringify(body.runtimeTrace)}`);
    assert.ok(body.runtimeTrace.some(event=>event.event==='agent.computer.control'&&event.outcome==='succeeded'&&event.diagnosticCode==='COMPUTER_CONTROL_RECOVERED'),'recovery must be visible in the task trace');
  }finally{await fixture.close();}
});

test('Agent runtime reports sustained computer-control HTTP failure with a concrete waiting reason and trace',async()=>{
  let calls=0;
  const fixture=await startRuntime(({workerPort,workerToken})=>{
    const server=createServer((req,res)=>{
      if(req.url!=='/v1/control'||req.headers.authorization!==`Bearer ${workerToken}`){res.writeHead(404);res.end();return;}
      calls+=1;
      if(calls===1){res.writeHead(200,{'content-type':'application/json'});res.end('{"owner":"agent"}');return;}
      res.writeHead(503,{'content-type':'text/plain'});res.end('synthetic control unavailable');
    });
    server.listen(workerPort,'127.0.0.1');return {ready:once(server,'listening'),close:()=>new Promise(resolve=>server.close(resolve))};
  },30_000);
  try{
    const {status,body}=await fixture.run();
    assert.equal(status,200);assert.equal(body.status,'waiting');assert.equal(body.controlOwner,'unknown');assert.equal(body.controlReason,'unavailable');
    const failure=body.runtimeTrace.find(event=>event.event==='agent.computer.control'&&event.outcome==='failed'&&event.reasonCode==='computer_control_unavailable');
    assert.ok(failure,'sustained control outage must produce a failed control trace');
    assert.equal(failure.httpStatus,503);assert.ok(failure.attemptNumber>=5);assert.equal(failure.diagnosticCode,'COMPUTER_CONTROL_CHECK_FAILED');
    assert.equal(body.runtimeTrace.find(event=>event.event==='agent.adapter.exit')?.outcome,'info','the expected pause must not be logged as an unrelated adapter crash');
  }finally{await fixture.close();}
});

test('Agent runtime still pauses immediately when the user takes control',async()=>{
  let calls=0;
  const fixture=await startRuntime(({workerPort,workerToken})=>{
    const server=createServer((req,res)=>{
      if(req.url!=='/v1/control'||req.headers.authorization!==`Bearer ${workerToken}`){res.writeHead(404);res.end();return;}
      calls+=1;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({owner:calls===1?'agent':'user'}));
    });
    server.listen(workerPort,'127.0.0.1');return {ready:once(server,'listening'),close:()=>new Promise(resolve=>server.close(resolve))};
  },30_000);
  try{
    const {status,body}=await fixture.run();
    assert.equal(status,200);assert.equal(body.status,'waiting');assert.equal(body.controlOwner,'user');assert.equal(body.pausedForControl,true);assert.ok(calls>=2);
    assert.equal(body.runtimeTrace.find(event=>event.event==='agent.adapter.exit')?.outcome,'info');
  }finally{await fixture.close();}
});
