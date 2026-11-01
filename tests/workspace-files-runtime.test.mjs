import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

async function listen(server) { server.listen(0,'127.0.0.1'); await once(server,'listening'); return server.address().port; }

test('tenant Agent runtime streams attachments into a task, reads them, and returns verified artifacts',async()=>{
  const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-workspace-files-'));
  const token=randomBytes(32).toString('base64url'),control=createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"owner":"agent"}')});
  const controlPort=await listen(control);
  const adapter=`let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>raw+=chunk);process.stdin.on('end',async()=>{const fs=await import('node:fs/promises'),path=await import('node:path'),input=JSON.parse(raw),attachment=input.attachments[0],content=await fs.readFile(path.join(input.cwd,attachment.path),'utf8');await fs.writeFile(path.join(input.cwd,'artifacts','result.txt'),'verified:'+content);process.stdout.write(JSON.stringify({status:'done',message:'Read attachment and wrote a result.'}))})`;
  let log='',child;
  try {
    const probe=createServer();const port=await listen(probe);await new Promise(resolve=>probe.close(resolve));
    child=spawn(process.execPath,['deploy/desktop/agent-runtime.mjs'],{cwd:process.cwd(),env:{...process.env,DOTS_AGENT_RUNTIME_TOKEN:token,DOTS_AGENT_RUNTIME_PORT:String(port),DOTS_AGENT_WORKSPACE:workspace,DOTS_AGENT_KERNELS_JSON:JSON.stringify({pi:{command:process.execPath,args:['-e',adapter]}}),DOTS_DESKTOP_AGENT_ADAPTERS:'pi',COKE_GROK_MEDIATED_COMPUTER:'1'},stdio:['ignore','pipe','pipe']});
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
    const base=`http://127.0.0.1:${port}`,headers={authorization:`Bearer ${token}`};
    let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`${base}/healthz`)).ok){ready=true;break}}catch{}if(i===99)throw new Error(`Agent runtime did not start: ${log}`);await new Promise(resolve=>setTimeout(resolve,50))}
    const payload=Buffer.from('customer notes: read me');const uploadId=randomUUID(),uploadKey=`shared/uploads/${uploadId}.txt`;
    assert.equal((await fetch(`${base}/v1/workspace/uploads/${uploadId}.txt`,{method:'PUT',body:payload})).status,401);
    const upload=await fetch(`${base}/v1/workspace/uploads/${uploadId}.txt`,{method:'PUT',headers,body:payload});
    const receipt=await upload.json();assert.equal(upload.status,201,JSON.stringify(receipt));assert.equal(receipt.size,payload.length);assert.equal(receipt.sha256,createHash('sha256').update(payload).digest('hex'));
    const original=await fetch(`${base}/v1/workspace/file?key=${encodeURIComponent(uploadKey)}`,{headers});assert.equal(original.status,200);assert.equal(Buffer.from(await original.arrayBuffer()).toString(),payload.toString());
    const taskId=randomUUID(),task=await fetch(`${base}/v1/tasks/run`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({engine:'pi',taskId,cwd:`tasks/${taskId}`,prompt:'Read the attached note and create a verified result.',attachments:[{id:uploadId,name:'note.txt',mimeType:'text/plain',size:payload.length,sha256:receipt.sha256,storageKey:uploadKey}],modelConfig:{apiKey:'test-only-key',baseUrl:`http://127.0.0.1:${controlPort}/v1`,model:'local-test-model'}})});
    const result=await task.json();assert.equal(task.status,200,JSON.stringify(result));assert.equal(result.status,'done');assert.match(result.message,/Read attachment/);assert.deepEqual(result.files.map(file=>file.name),['result.txt']);assert.equal(result.files[0].size,`verified:${payload.toString()}`.length);
    const output=await fetch(`${base}/v1/workspace/file?key=${encodeURIComponent(result.files[0].storageKey)}`,{headers});assert.equal(output.status,200);assert.equal(await output.text(),`verified:${payload.toString()}`);
    const revisedTaskId=randomUUID(),previousArtifact=await fetch(`${base}/v1/tasks/run`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({engine:'pi',taskId:revisedTaskId,cwd:`tasks/${revisedTaskId}`,prompt:'Revise the previous result.',attachments:[{id:randomUUID(),name:result.files[0].name,mimeType:result.files[0].mimeType,size:result.files[0].size,sha256:result.files[0].sha256,storageKey:result.files[0].storageKey}],modelConfig:{apiKey:'test-only-key',baseUrl:`http://127.0.0.1:${controlPort}/v1`,model:'local-test-model'}})});
    const revisedResult=await previousArtifact.json();assert.equal(previousArtifact.status,200,JSON.stringify(revisedResult));assert.equal(revisedResult.status,'done');assert.equal(await readFile(path.join(workspace,'tasks',revisedTaskId,'attachments','result.txt'),'utf8'),`verified:${payload.toString()}`);
    assert.equal((await fetch(`${base}/v1/workspace/file?key=${encodeURIComponent('../etc/passwd')}`,{headers})).status,400);
    const linkedId=randomUUID();await mkdir(path.join(workspace,'shared','uploads'),{recursive:true});await symlink('/etc/hosts',path.join(workspace,'shared','uploads',`${linkedId}.txt`));
    assert.equal((await fetch(`${base}/v1/workspace/file?key=${encodeURIComponent(`shared/uploads/${linkedId}.txt`)}`,{headers})).status,400);
    assert.equal(await readFile(path.join(workspace,'tasks',taskId,'attachments','note.txt'),'utf8'),payload.toString());
  } finally {
    if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await once(child,'close')}
    control.close();
    await rm(workspace,{recursive:true,force:true});
  }
});
