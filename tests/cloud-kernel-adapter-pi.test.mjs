import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { runCloudKernel } from '../deploy/desktop/cloud-kernel-adapter.mjs';

test('Pi runs task-scoped terminal commands without per-command approvals or built-in Bash', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'grok-pi-tools-'));
  const cwd = path.join(workspace, 'tasks', 'shell-policy');
  await mkdir(cwd, { recursive: true });
  let options;
  const oldFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    requests.push({ pathname, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    if (pathname.endsWith('/computer/control')) return Response.json({ owner: 'agent' });
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
    const commandMarker = randomUUID();
    const command = `printf PI_TERMINAL_OK > pi-${commandMarker}.txt`;
    const result = await terminal.execute('run', { command, directory: 'shared' }, new AbortController().signal);
    assert.match(result.content[0].text, /"exitCode":0/);
    assert.equal(await readFile(path.join(workspace, 'shared', `pi-${commandMarker}.txt`), 'utf8'), 'PI_TERMINAL_OK');
    assert.deepEqual(requests.map(request => request.pathname), ['/v1/computer/control']);
  } finally {
    globalThis.fetch = oldFetch;
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Pi fails closed instead of polling a legacy computer approval id',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-pi-computer-diagnostic-')),cwd=path.join(workspace,'tasks','diagnostic');await mkdir(cwd,{recursive:true});
 const oldFetch=globalThis.fetch,approvalId=randomUUID(),token='x'.repeat(43),requests=[];let options;
 globalThis.fetch=async(url,init={})=>{
  const pathname=new URL(String(url)).pathname;requests.push({pathname,method:init.method||'GET'});
  if(pathname==='/v1/computer/actions'&&init.method==='POST')return Response.json({id:approvalId},{status:201});
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
  const variants=browser.parameters.anyOf||browser.parameters.oneOf;assert.ok(Array.isArray(variants));
  const clickByRole=variants.find(schema=>schema.properties?.action?.const==='click'&&schema.properties?.by?.const==='role');
  assert.deepEqual([...clickByRole.required].sort(),['action','by','role','target']);
  const clickByHref=variants.find(schema=>schema.properties?.action?.const==='click'&&schema.properties?.by?.const==='href');
  assert.deepEqual([...clickByHref.required].sort(),['action','by','target']);
  assert.equal(clickByHref.properties.target.maxLength,2048);
  assert.equal(variants.some(schema=>schema.properties?.action?.const==='fill'&&schema.properties?.by?.const==='href'),false);
  const fillByRole=variants.find(schema=>schema.properties?.action?.const==='fill'&&schema.properties?.by?.const==='role');
  assert.deepEqual([...fillByRole.required].sort(),['action','by','role','target','value']);
  await assert.rejects(()=>browser.execute('call',{action:'navigate',url:'https://example.com/'},new AbortController().signal),/Worker did not confirm that the computer action ran/);
  assert.deepEqual(requests,[{pathname:'/v1/computer/actions',method:'POST'}],'a legacy id must never be polled or executed');
 }finally{globalThis.fetch=oldFetch;await rm(workspace,{recursive:true,force:true})}
});

test('Pi explains invalid computer action parameters without adding an approval step',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-pi-invalid-browser-action-')),cwd=path.join(workspace,'tasks','invalid');await mkdir(cwd,{recursive:true});
 const oldFetch=globalThis.fetch,token='x'.repeat(43);let options;
 globalThis.fetch=async(url,init={})=>{
  const pathname=new URL(String(url)).pathname;
  if(pathname==='/v1/computer/control')return Response.json({owner:'agent'});
  if(pathname==='/v1/computer/actions'&&init.method==='POST')return Response.json({error:'Action rejected',diagnostic:{code:'COMPUTER_ACTION_INVALID'},secret:'never-return-this'},{status:400});
  throw new Error('Unexpected computer gateway request');
 };
 const sdk={
  AuthStorage:{inMemory:()=>({setRuntimeApiKey(){}})},ModelRegistry:{inMemory:()=>({registerProvider(){},find:()=>({id:'deepseek-v4.1-flash'})})},
  SessionManager:{list:async()=>[],create:()=>({getSessionId:()=>randomUUID()})},
  createAgentSession:async value=>{options=value;return{session:{messages:[{role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"status":"done","message":"Adapter ready."}'}]}],async prompt(){},dispose(){}}}},
 };
 try{
  await runCloudKernel({engine:'pi',modelConfig:{apiKey:'test-only-key',baseUrl:'https://models.example/v1',model:'deepseek-v4.1-flash'},workspace,cwd:path.relative(workspace,cwd),taskId:randomUUID(),computer:{mode:'mediated',gatewayUrl:'https://gateway.example.test/v1',gatewayToken:token},prompt:'Inspect then click the requested visible link.',signal:new AbortController().signal},{piSdk:sdk});
  const browser=options.customTools.find(tool=>tool.name==='computer_browser');
  await assert.rejects(()=>browser.execute('invalid-click',{action:'click' },new AbortController().signal),error=>{
   assert.match(error.message,/parameters were incomplete or invalid/i);
   assert.match(error.message,/any URL scheme/i);
   assert.match(error.message,/any key name or combination/i);
   assert.doesNotMatch(error.message,/approval/i);
   assert.doesNotMatch(error.message,/never-return-this/);
   return true;
  });
 }finally{globalThis.fetch=oldFetch;await rm(workspace,{recursive:true,force:true})}
});

test('Pi preserves fixed Worker diagnostics in the Auth service error response',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-pi-worker-diagnostic-')),cwd=path.join(workspace,'tasks','diagnostic');await mkdir(cwd,{recursive:true});
 const oldFetch=globalThis.fetch,token='x'.repeat(43);let options;
 globalThis.fetch=async(url,init={})=>{
  const pathname=new URL(String(url)).pathname;
  if(pathname==='/v1/computer/control')return Response.json({owner:'agent'});
  if(pathname==='/v1/computer/actions'&&init.method==='POST')return Response.json({error:'Service unavailable',diagnostic:{code:'COMPUTER_WORKER_REQUEST_BODY_INVALID',status:400},message:'private browser content'},{status:503});
  throw new Error('Unexpected computer gateway request');
 };
 const sdk={
  AuthStorage:{inMemory:()=>({setRuntimeApiKey(){}})},ModelRegistry:{inMemory:()=>({registerProvider(){},find:()=>({id:'deepseek-v4.1-flash'})})},
  SessionManager:{list:async()=>[],create:()=>({getSessionId:()=>randomUUID()})},
  createAgentSession:async value=>{options=value;return{session:{messages:[{role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"status":"done","message":"Adapter ready."}'}]}],async prompt(){},dispose(){}}}},
 };
 try{
  await runCloudKernel({engine:'pi',modelConfig:{apiKey:'test-only-key',baseUrl:'https://models.example/v1',model:'deepseek-v4.1-flash'},workspace,cwd:path.relative(workspace,cwd),taskId:randomUUID(),computer:{mode:'mediated',gatewayUrl:'https://gateway.example.test/v1',gatewayToken:token},prompt:'Check the browser tool.',signal:new AbortController().signal},{piSdk:sdk});
  const browser=options.customTools.find(tool=>tool.name==='computer_browser');assert.ok(browser);
  await assert.rejects(()=>browser.execute('browser-click',{action:'click',by:'role',role:'link',target:'Business Rules'},new AbortController().signal),/Computer action failed: COMPUTER_WORKER_REQUEST_BODY_INVALID \(worker HTTP 400\)/);
 }finally{globalThis.fetch=oldFetch;await rm(workspace,{recursive:true,force:true})}
});

test('Pi Computer User can operate Chrome tabs and address bar without approval',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-pi-navigation-directive-')),cwd=path.join(workspace,'tasks','navigation');await mkdir(cwd,{recursive:true});
 const oldFetch=globalThis.fetch,token='x'.repeat(43),requests=[];let options;
 globalThis.fetch=async(url,init={})=>{
  const pathname=new URL(String(url)).pathname;requests.push({pathname,method:init.method||'GET'});
  if(pathname==='/v1/computer/control')return Response.json({owner:'agent'});
  if(pathname==='/v1/computer/actions')return Response.json({status:'completed',result:{ready:true,url:'https://example.org/'}},{status:201});
  throw new Error('A direct desktop action must not be polled or retried');
 };
 const sdk={
  AuthStorage:{inMemory:()=>({setRuntimeApiKey(){}})},ModelRegistry:{inMemory:()=>({registerProvider(){},find:()=>({id:'deepseek-v4.1-flash'})})},
  SessionManager:{list:async()=>[],create:()=>({getSessionId:()=>randomUUID()})},
  createAgentSession:async value=>{options=value;return{session:{messages:[{role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"status":"done","message":"Adapter ready."}'}]}],async prompt(){},dispose(){}}}},
 };
 try{
  await runCloudKernel({engine:'pi',modelConfig:{apiKey:'test-only-key',baseUrl:'https://models.example/v1',model:'deepseek-v4.1-flash'},workspace,cwd:path.relative(workspace,cwd),taskId:randomUUID(),computer:{mode:'mediated',gatewayUrl:'https://gateway.example.test/v1',gatewayToken:token},prompt:'Open https://example.org/ and report its title.',signal:new AbortController().signal},{piSdk:sdk});
  const desktop=options.customTools.find(tool=>tool.name==='computer_desktop');assert.ok(desktop);
  const result=await desktop.execute('desktop-address-bar-click',{action:'click',x:295,y:90},new AbortController().signal);
  assert.match(result.content[0].text,/https:\/\/example\.org/);
  assert.equal(requests.filter(request=>request.pathname==='/v1/computer/actions').length,1);
  assert.equal(requests.length,2,'only the owner check and direct computer action are needed');
  assert.match(desktop.promptGuidelines.join(' '),/Browser User and Computer User are available on every live task lease/i);
  assert.match(desktop.promptGuidelines.join(' '),/Chrome tabs and the address bar are ordinary computer controls/i);
 }finally{globalThis.fetch=oldFetch;await rm(workspace,{recursive:true,force:true})}
});

test('Pi does not poll or execute legacy approval ids for browser or desktop actions',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-pi-denied-computer-action-')),cwd=path.join(workspace,'tasks','denied');await mkdir(cwd,{recursive:true});
 const oldFetch=globalThis.fetch,approvalIds=[],token='x'.repeat(43);let options;
 globalThis.fetch=async(url,init={})=>{
  const pathname=new URL(String(url)).pathname,method=init.method||'GET';
  if(pathname.endsWith('/computer/control'))return Response.json({owner:'agent'});
  if(pathname.endsWith('/computer/actions')&&method==='POST'){const id=randomUUID();approvalIds.push(id);return Response.json({id},{status:201})}
  throw new Error(`Unexpected computer gateway request: ${method} ${pathname}`);
 };
 const sdk={
  AuthStorage:{inMemory:()=>({setRuntimeApiKey(){}})},ModelRegistry:{inMemory:()=>({registerProvider(){},find:()=>({id:'deepseek-v4.1-flash'})})},
  SessionManager:{list:async()=>[],create:()=>({getSessionId:()=>randomUUID()})},
  createAgentSession:async value=>{options=value;return{session:{messages:[{role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"status":"done","message":"Adapter ready."}'}]}],async prompt(){},dispose(){}}}},
 };
 try{
  await runCloudKernel({engine:'pi',modelConfig:{apiKey:'test-only-key',baseUrl:'https://models.example/v1',model:'deepseek-v4.1-flash'},workspace,cwd:path.relative(workspace,cwd),taskId:randomUUID(),computer:{mode:'mediated',gatewayUrl:'https://gateway.example.test/v1',gatewayToken:token},prompt:'Use the requested browser site.',signal:new AbortController().signal},{piSdk:sdk});
  const browser=options.customTools.find(tool=>tool.name==='computer_browser'),desktop=options.customTools.find(tool=>tool.name==='computer_desktop');assert.ok(browser);assert.ok(desktop);
  await assert.rejects(()=>browser.execute('browser-navigate',{action:'navigate',url:'https://www.google.com/'},new AbortController().signal),/Worker did not confirm that the computer action ran/);
  assert.equal(approvalIds.length,1);
  await assert.rejects(()=>desktop.execute('desktop-click',{action:'click',x:10,y:10},new AbortController().signal),/Worker did not confirm that the computer action ran/);
  assert.equal(approvalIds.length,2,'each direct tool call fails fast and neither action is polled or executed');
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
  const sections=loaderOptions.appendSystemPromptOverride([]);
  assert.deepEqual(loaderOptions.appendSystemPromptOverride(['base system']),['base system',...sections]);
  assert.match(sections[0],/Current Bot identity.*Chief/);
  assert.match(sections[0],/Product crew/);
  assert.match(sections[1],/Grok Bot task-result contract/);
  assert.match(sections[1],/exactly one JSON object/);
  assert.ok(userMessage.startsWith('Give one concise project update.'));
  assert.match(userMessage,/Grok Bot task-result contract/);
  assert.match(userMessage,/exactly one JSON object/);
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
