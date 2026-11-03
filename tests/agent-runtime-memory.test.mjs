import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {access,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

async function freePort() {
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}

test('Agent runtime forwards only validated Bot memory and handoff rosters to Pi and DSH adapters',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'grok-agent-runtime-memory-'));
  const workerToken=randomUUID(),runtimeToken=randomUUID(),runtimePort=await freePort(),workerPort=await freePort();
  const worker=createServer((req,res)=>{
    if(req.url==='/v1/control'&&req.headers.authorization===`Bearer ${workerToken}`){res.writeHead(200,{'content-type':'application/json'});res.end('{"owner":"agent"}');return;}
    res.writeHead(404);res.end();
  });
  worker.listen(workerPort,'127.0.0.1');await once(worker,'listening');
  const adapterSource=`import {writeFile} from 'node:fs/promises';let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>raw+=chunk);process.stdin.on('end',async()=>{const input=JSON.parse(raw);await writeFile(process.env.TEST_CAPTURE_DIR+'/'+input.taskId+'.json',JSON.stringify(input));process.stdout.write(JSON.stringify({status:'done',message:'adapter fixture completed'}));});`;
  const kernels=Object.fromEntries(['pi','dsh'].map(engine=>[engine,{command:process.execPath,args:['--input-type=module','-e',adapterSource]}]));
  const runtime=spawn(process.execPath,['deploy/desktop/agent-runtime.mjs'],{cwd:process.cwd(),env:{...process.env,DOTS_AGENT_RUNTIME_TOKEN:runtimeToken,DOTS_AGENT_RUNTIME_PORT:String(runtimePort),LINUX_DESKTOP_WORKER_TOKEN:workerToken,LINUX_DESKTOP_WORKER_PORT:String(workerPort),DOTS_AGENT_WORKSPACE:dir,TEST_CAPTURE_DIR:dir,DOTS_DESKTOP_AGENT_ADAPTERS:'pi,dsh',DOTS_AGENT_KERNELS_JSON:JSON.stringify(kernels),COKE_GROK_MEDIATED_COMPUTER:'0'},stdio:['ignore','pipe','pipe']});
  runtime.stdout.resume();runtime.stderr.resume();
  try{
    let ready=false;
    for(let i=0;i<100;i++){
      if(runtime.exitCode!==null)throw new Error('Agent runtime exited before readiness');
      try{const response=await fetch(`http://127.0.0.1:${runtimePort}/healthz`);if(response.ok){ready=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(ready,true,'Agent runtime must become ready');
    for(const engine of ['pi','dsh']){
      const taskId=randomUUID(),botId=randomUUID(),target={id:randomUUID(),name:'Sales Outbound',label:'Research'},memoryExtra='memory-extra-field-must-not-reach-adapter',handoffExtra='handoff-token-extra-must-not-reach-adapter';
      const response=await fetch(`http://127.0.0.1:${runtimePort}/v1/tasks/run`,{method:'POST',headers:{authorization:`Bearer ${runtimeToken}`,'content-type':'application/json'},body:JSON.stringify({engine,taskId,botId,screenId:botId,cwd:`tasks/${taskId}`,prompt:'synthetic runtime test',modelConfig:{apiKey:'synthetic-model-key',baseUrl:'https://model.invalid/v1',model:'fixture-model'},memory:{mode:'mediated',token:memoryExtra},handoffs:{mode:'mediated',bots:[target],token:handoffExtra}})});
      assert.equal(response.status,200);assert.equal((await response.json()).status,'done');
      const captured=JSON.parse(await readFile(join(dir,`${taskId}.json`),'utf8'));
      assert.deepEqual(captured.memory,{mode:'mediated'},`${engine} must receive only the validated memory mode`);
      assert.deepEqual(captured.handoffs,{mode:'mediated',bots:[target]},`${engine} must receive the sanitized same-owner Bot roster`);
      assert.equal(JSON.stringify(captured).includes(memoryExtra),false,`${engine} must not receive caller-supplied memory credentials`);
      assert.equal(JSON.stringify(captured).includes(handoffExtra),false,`${engine} must not receive caller-supplied handoff credentials`);
      const plainTask=randomUUID(),plainBot=randomUUID();
      const plain=await fetch(`http://127.0.0.1:${runtimePort}/v1/tasks/run`,{method:'POST',headers:{authorization:`Bearer ${runtimeToken}`,'content-type':'application/json'},body:JSON.stringify({engine,taskId:plainTask,botId:plainBot,screenId:plainBot,cwd:`tasks/${plainTask}`,prompt:'synthetic runtime test',modelConfig:{apiKey:'synthetic-model-key',baseUrl:'https://model.invalid/v1',model:'fixture-model'}})});
      assert.equal(plain.status,200);const plainInput=JSON.parse(await readFile(join(dir,`${plainTask}.json`),'utf8'));assert.equal(Object.hasOwn(plainInput,'memory'),false);assert.equal(Object.hasOwn(plainInput,'handoffs'),false);
      const invalidTask=randomUUID(),invalidBot=randomUUID();
      const invalid=await fetch(`http://127.0.0.1:${runtimePort}/v1/tasks/run`,{method:'POST',headers:{authorization:`Bearer ${runtimeToken}`,'content-type':'application/json'},body:JSON.stringify({engine,taskId:invalidTask,botId:invalidBot,screenId:invalidBot,cwd:`tasks/${invalidTask}`,prompt:'synthetic runtime test',modelConfig:{apiKey:'synthetic-model-key',baseUrl:'https://model.invalid/v1',model:'fixture-model'},memory:{mode:'untrusted',token:memoryExtra}})});
      assert.equal(invalid.status,400);assert.equal(await access(join(dir,`${invalidTask}.json`)).then(()=>true,()=>false),false,'invalid memory bridge input must fail before starting an adapter');
      const invalidHandoffTask=randomUUID(),invalidHandoffBot=randomUUID();
      const invalidHandoff=await fetch(`http://127.0.0.1:${runtimePort}/v1/tasks/run`,{method:'POST',headers:{authorization:`Bearer ${runtimeToken}`,'content-type':'application/json'},body:JSON.stringify({engine,taskId:invalidHandoffTask,botId:invalidHandoffBot,screenId:invalidHandoffBot,cwd:`tasks/${invalidHandoffTask}`,prompt:'synthetic runtime test',modelConfig:{apiKey:'synthetic-model-key',baseUrl:'https://model.invalid/v1',model:'fixture-model'},handoffs:{mode:'mediated',bots:[{id:'not-a-bot',name:'Foreign Bot',label:''}]}})});
      assert.equal(invalidHandoff.status,400);assert.equal(await access(join(dir,`${invalidHandoffTask}.json`)).then(()=>true,()=>false),false,'invalid Bot roster must fail before starting an adapter');
    }
  }finally{
    runtime.kill('SIGTERM');await Promise.race([once(runtime,'exit'),new Promise(resolve=>setTimeout(resolve,2000))]);
    await new Promise(resolve=>worker.close(resolve));await rm(dir,{recursive:true,force:true});
  }
});
