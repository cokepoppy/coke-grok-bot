import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { runCloudKernel } from '../deploy/desktop/cloud-kernel-adapter.mjs';

test('Pi exposes a shared computer terminal only through exact owner approval, not the built-in Bash tool', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'grok-pi-tools-'));
  const cwd = path.join(workspace, 'tasks', 'shell-policy');
  await mkdir(cwd, { recursive: true });
  let options;
  const oldFetch = globalThis.fetch;
  const approvalId = randomUUID(), requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    requests.push({ pathname, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    if (pathname.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
    if (pathname.endsWith('/computer/actions')) return Response.json({ id: approvalId });
    if (pathname.endsWith(`/computer/actions/${approvalId}`)) return Response.json({ status: 'approved' });
    if (pathname.endsWith(`/computer/actions/${approvalId}/execute`)) return Response.json({ approved: true });
    throw new Error('Unexpected computer gateway request');
  };
  const sdk = {
    AuthStorage: { inMemory: () => ({ setRuntimeApiKey() {} }) },
    ModelRegistry: { inMemory: () => ({ registerProvider() {}, find: () => ({ id: 'deepseek-v4.1-flash' }) }) },
    SessionManager: {
      list: async () => [],
      create: () => ({ getSessionId: () => 'shell-policy-session' }),
    },
    createAgentSession: async value => {
      options = value;
      return { session: {
        messages: [{ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: '{"status":"done","message":"tools checked"}' }] }],
        async prompt() {},
        dispose() {},
      } };
    },
  };

  try {
    await runCloudKernel({
      engine: 'pi',
      modelConfig: { apiKey: 'test-only-key', baseUrl: 'https://models.example/v1', model: 'deepseek-v4.1-flash' },
      workspace,
      cwd: 'tasks/shell-policy',
      computer: { mode: 'mediated', gatewayUrl: 'https://gateway.example.test/v1', gatewayToken: 'x'.repeat(43) },
      prompt: 'Check the available tools.',
      signal: new AbortController().signal,
    }, { piSdk: sdk });

    assert.ok(options.tools.includes('read'));
    assert.ok(options.tools.includes('write'));
    assert.ok(options.tools.includes('computer_files'));
    assert.ok(options.tools.includes('computer_terminal'));
    assert.equal(options.tools.includes('bash'), false);
    const terminal = options.customTools.find(tool => tool.name === 'computer_terminal');
    const command = `printf PI_TERMINAL_OK > pi-${approvalId}.txt`;
    const result = await terminal.execute('run', { command, directory: 'shared' }, new AbortController().signal);
    assert.match(result.content[0].text, /"exitCode":0/);
    assert.equal(await readFile(path.join(workspace, 'shared', `pi-${approvalId}.txt`), 'utf8'), 'PI_TERMINAL_OK');
    assert.deepEqual(requests.find(request => request.pathname.endsWith('/computer/actions'))?.body, { action: { kind: 'terminal', action: 'run', command, directory: 'shared' } });
    assert.equal(requests.filter(request => request.pathname.endsWith(`/computer/actions/${approvalId}/execute`)).length, 1);
  } finally {
    globalThis.fetch = oldFetch;
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Pi reports only the allowlisted computer diagnostic after an approved action is rejected',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-pi-computer-diagnostic-')),cwd=path.join(workspace,'tasks','diagnostic');await mkdir(cwd,{recursive:true});
 const oldFetch=globalThis.fetch,approvalId=randomUUID(),token='x'.repeat(43);let options;
 globalThis.fetch=async(url,init={})=>{
  const pathname=new URL(String(url)).pathname;
  if(pathname==='/v1/computer/actions'&&init.method==='POST')return Response.json({id:approvalId},{status:201});
  if(pathname===`/v1/computer/actions/${approvalId}`)return Response.json({status:'approved'});
  if(pathname===`/v1/computer/actions/${approvalId}/execute`&&init.method==='POST')return Response.json({error:'computer_request_failed',diagnostic:{code:'COMPUTER_WORKER_HTTP_ERROR',status:503},message:'credential-do-not-forward'},{status:409});
  throw new Error('Unexpected mediated computer request');
 };
 const sdk={
  AuthStorage:{inMemory:()=>({setRuntimeApiKey(){}})},ModelRegistry:{inMemory:()=>({registerProvider(){},find:()=>({id:'deepseek-v4.1-flash'})})},
  SessionManager:{list:async()=>[],create:()=>({getSessionId:()=>randomUUID()})},
  createAgentSession:async value=>{options=value;return{session:{messages:[{role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"status":"done","message":"Adapter ready."}'}]}],async prompt(){},dispose(){}}}},
 };
 try{
  await runCloudKernel({engine:'pi',modelConfig:{apiKey:'test-only-key',baseUrl:'https://models.example/v1',model:'deepseek-v4.1-flash'},workspace,cwd:path.relative(workspace,cwd),taskId:randomUUID(),computer:{mode:'mediated',gatewayUrl:'https://gateway.example.test/v1',gatewayToken:token},prompt:'Check the browser tool.',signal:new AbortController().signal},{piSdk:sdk});
  const browser=options.customTools.find(tool=>tool.name==='computer_browser');assert.ok(browser);
  await assert.rejects(()=>browser.execute('call',{action:'navigate',url:'https://example.com/'},new AbortController().signal),error=>error instanceof Error&&error.message==='Computer action failed: COMPUTER_WORKER_HTTP_ERROR (worker HTTP 503)');
 }finally{globalThis.fetch=oldFetch;await rm(workspace,{recursive:true,force:true})}
});

test('Pi keeps group orchestration context in the system prompt and the user message intact',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-pi-group-context-')),cwd=path.join(workspace,'tasks','group');await mkdir(cwd,{recursive:true});
 let options,loaderOptions,loaded=false,userMessage='';
 class FakeResourceLoader{constructor(value){loaderOptions=value}async reload(){loaded=true}}
 const sdk={
  AuthStorage:{inMemory:()=>({setRuntimeApiKey(){}})},ModelRegistry:{inMemory:()=>({registerProvider(){},find:()=>({id:'deepseek-v4.1-flash'})})},
  SessionManager:{list:async()=>[],create:()=>({getSessionId:()=>randomUUID()})},DefaultResourceLoader:FakeResourceLoader,
  createAgentSession:async value=>{options=value;return{session:{messages:[{role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"status":"done","message":"Chief reply"}'}]}],async prompt(value){userMessage=value},dispose(){}}}},
 };
 const runtimeContext={kind:'group-chat',groupName:'Product crew',currentBot:{name:'Chief',label:'Coordinator'},members:[{name:'Chief',label:'Coordinator'},{name:'Sales',label:'Research'}],targeted:false};
 try{
  const result=await runCloudKernel({engine:'pi',modelConfig:{apiKey:'test-only-key',baseUrl:'https://models.example/v1',model:'deepseek-v4.1-flash'},workspace,cwd:path.relative(workspace,cwd),prompt:'Give one concise project update.',runtimeContext,signal:new AbortController().signal},{piSdk:sdk});
  assert.equal(result.message,'Chief reply');assert.equal(loaded,true);assert.equal(options.resourceLoader.constructor,FakeResourceLoader);
  assert.deepEqual(loaderOptions.appendSystemPromptOverride(['base system']),['base system',loaderOptions.appendSystemPromptOverride([])[0]]);
  assert.match(loaderOptions.appendSystemPromptOverride([])[0],/Current Bot identity.*Chief/);
  assert.match(loaderOptions.appendSystemPromptOverride([])[0],/Product crew/);
  assert.equal(userMessage,'Give one concise project update.');
 }finally{await rm(workspace,{recursive:true,force:true})}
});

test('Pi returns a bounded computer execution audit without tool arguments or results',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-pi-execution-audit-')),cwd=path.join(workspace,'tasks','audit');await mkdir(cwd,{recursive:true});
 const privateUrl='https://example.test/private?access_token=do-not-store';
 const messages=[
  {role:'assistant',content:[{type:'toolCall',id:'browser-1',name:'computer_browser',arguments:{action:'navigate',url:privateUrl}}]},
  {role:'toolResult',toolCallId:'browser-1',toolName:'computer_browser',details:{action:'navigate'},content:[{type:'text',text:'Private page contents'}]},
  {role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"status":"done","message":"Read-only check completed."}'}]},
 ];
 const sdk={
  AuthStorage:{inMemory:()=>({setRuntimeApiKey(){}})},ModelRegistry:{inMemory:()=>({registerProvider(){},find:()=>({id:'deepseek-v4.1-flash'})})},
  SessionManager:{list:async()=>[],create:()=>({getSessionId:()=>randomUUID()})},
  createAgentSession:async()=>({session:{messages,async prompt(){},dispose(){}}}),
 };
 try{
  const result=await runCloudKernel({engine:'pi',modelConfig:{apiKey:'test-only-key',baseUrl:'https://models.example/v1',model:'deepseek-v4.1-flash'},workspace,cwd:path.relative(workspace,cwd),taskId:randomUUID(),prompt:'Read one public page.',signal:new AbortController().signal},{piSdk:sdk});
  assert.deepEqual(result.executionAudit,{engine:'pi',model:'deepseek-v4.1-flash',modelCompleted:true,calls:[{tool:'computer_browser',action:'navigate',outcome:'succeeded'}],truncated:false});
  assert.equal(JSON.stringify(result.executionAudit).includes(privateUrl),false);
  assert.equal(JSON.stringify(result.executionAudit).includes('Private page contents'),false);
 }finally{await rm(workspace,{recursive:true,force:true})}
});
