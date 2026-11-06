import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCloudKernel } from '../deploy/desktop/cloud-kernel-adapter.mjs';

test('DeepSeekHarness receives the supported SDK launch options', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'grok-dsh-sdk-options-'));
  const cwd = path.join(workspace, 'tasks', 'demo');
  await mkdir(cwd, { recursive: true });
  const realCwd = await realpath(cwd);
  const previousBin = process.env.DOTS_DSH_BIN;
  const previousProfile = process.env.DOTS_DSH_PROFILE;
  let options, patchContent;
  let closeCalls = 0;

  class FakeDeepSeekHarness {
    constructor(value) { options = value; }
    async run(prompt, runOptions) {
      assert.equal(prompt, 'Return a structured completion.');
      assert.deepEqual(runOptions, { sessionId: undefined });
      patchContent = await readFile(options.patches[0], 'utf8');
      return {
        finalResponse: JSON.stringify({ status: 'done', message: 'DSH adapter test passed' }),
        sessionId: 'fixture-session',
        events: [],
      };
    }
    async close() { closeCalls += 1; }
  }

  process.env.DOTS_DSH_BIN = '/opt/coke-grok/dsh-runtime/node_modules/.bin/dsh';
  process.env.DOTS_DSH_PROFILE = 'sdk-fixture';
  try {
    const result = await runCloudKernel({
      engine: 'dsh',
      modelConfig: { apiKey: 'test-only-key', baseUrl: 'https://models.example/v1', model: 'deepseek-v4.1-flash' },
      cwd: path.relative(workspace, cwd),
      workspace,
      prompt: 'Return a structured completion.',
      signal: new AbortController().signal,
    }, { dshSdk: { DeepSeekHarness: FakeDeepSeekHarness } });

    assert.deepEqual(result, { status: 'done', message: 'DSH adapter test passed', sessionId: 'fixture-session', executionAudit:{engine:'dsh',model:'deepseek-v4.1-flash',modelCompleted:true,calls:[],truncated:false} });
    assert.equal(options.dshBin, process.env.DOTS_DSH_BIN);
    assert.equal(options.profile, process.env.DOTS_DSH_PROFILE);
    assert.equal(options.dshHome, path.join(realCwd, '.coke-dots-agent-runtime', 'dsh-home'));
    assert.equal(options.processCwd, realCwd);
    assert.equal(options.cwd, realCwd);
    assert.equal(options.provider, 'coke-dots-shared');
    assert.equal(options.model, 'deepseek-v4.1-flash');
    assert.equal(options.patches.length, 1);
    assert.equal(path.dirname(options.patches[0]), options.dshHome);
    assert.match(path.basename(options.patches[0]), /^coke-dots-[a-f0-9]+\.cordis\.yml$/);
    assert.match(patchContent, /models:\n\s+- id: "deepseek-v4\.1-flash"\n\s+input: \[text, image\]/u);
    assert.equal(options.env.HOME, options.dshHome);
    assert.equal(options.env.DSH_HOME, options.dshHome);
    assert.equal(options.env.DEEPSEEK_API_KEY, 'test-only-key');
    assert.equal(options.env.DEEPSEEK_BASE_URL, 'https://models.example/v1');
    assert.equal(options.env.DSH_MODEL, 'deepseek-v4.1-flash');
    assert.equal(closeCalls, 1);
  } finally {
    if (previousBin === undefined) delete process.env.DOTS_DSH_BIN;
    else process.env.DOTS_DSH_BIN = previousBin;
    if (previousProfile === undefined) delete process.env.DOTS_DSH_PROFILE;
    else process.env.DOTS_DSH_PROFILE = previousProfile;
    await rm(workspace, { recursive: true, force: true });
  }
});

test('DeepSeek Harness receives group identity as a system-prompt section, not as the user task',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-dsh-group-context-')),cwd=path.join(workspace,'tasks','group');await mkdir(cwd,{recursive:true});
 let options,closeCalls=0;
 const runtimeContext={kind:'group-chat',groupName:'Product crew',currentBot:{name:'Chief',label:'Coordinator'},members:[{name:'Chief',label:'Coordinator'},{name:'Sales',label:'Research'}],targeted:true};
 class FakeDeepSeekHarness{
  constructor(value){options=value}
  async run(prompt){
   assert.equal(prompt,'Give one concise project update.');
   const patch=await readFile(options.patches[0],'utf8');
   const pluginFile=patch.match(/name: "\.\/([^"\\]+\.mjs)"/u)?.[1];assert.ok(pluginFile);
   const plugin=await readFile(path.join(options.dshHome,pluginFile),'utf8');
   assert.match(plugin,/export const inject = \['systemPrompt'\]/u);
   assert.match(plugin,/ctx\.systemPrompt\.section/u);
   assert.match(plugin,/Current Bot identity/u);
   assert.match(plugin,/Product crew/u);
   assert.match(plugin,/explicitly selected by an @mention/u);
   return{finalResponse:JSON.stringify({status:'done',message:'Chief reply'}),sessionId:'group-context-session',events:[]};
  }
  async close(){closeCalls++}
 }
 try{
  const result=await runCloudKernel({engine:'dsh',modelConfig:{apiKey:'test-only-key',baseUrl:'https://models.example/v1',model:'deepseek-v4.1-flash'},workspace,cwd:path.relative(workspace,cwd),prompt:'Give one concise project update.',runtimeContext,signal:new AbortController().signal},{dshSdk:{DeepSeekHarness:FakeDeepSeekHarness}});
  assert.deepEqual(result,{status:'done',message:'Chief reply',sessionId:'group-context-session',executionAudit:{engine:'dsh',model:'deepseek-v4.1-flash',modelCompleted:true,calls:[],truncated:false}});
  assert.equal(closeCalls,1);
 }finally{await rm(workspace,{recursive:true,force:true})}
});

test('DeepSeek Harness returns a bounded computer execution audit without tool arguments or results',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'grok-dsh-execution-audit-')),cwd=path.join(workspace,'tasks','audit');await mkdir(cwd,{recursive:true});
 const privateUrl='https://example.test/private?access_token=do-not-store';
 class FakeDeepSeekHarness{
  constructor(){}
  async run(){return{finalResponse:JSON.stringify({status:'done',message:'Read-only check completed.'}),sessionId:'audit-session',events:[
   {type:'tool/call',data:{callId:'browser-1',name:'computer_browser',arguments:{action:'navigate',url:privateUrl}}},
   {type:'tool/result',data:{message:{role:'tool',toolCallId:'browser-1',toolName:'computer_browser',details:{action:'navigate'},content:[{type:'text',text:'Private page contents'}]}}},
   {type:'turn/end',data:{reason:{kind:'stop'}}},
  ]}}
  async close(){}
 }
 try{
  const result=await runCloudKernel({engine:'dsh',modelConfig:{apiKey:'test-only-key',baseUrl:'https://models.example/v1',model:'deepseek-v4.1-flash'},workspace,cwd:path.relative(workspace,cwd),prompt:'Read one public page.',signal:new AbortController().signal},{dshSdk:{DeepSeekHarness:FakeDeepSeekHarness}});
  assert.deepEqual(result.executionAudit,{engine:'dsh',model:'deepseek-v4.1-flash',modelCompleted:true,calls:[{tool:'computer_browser',action:'navigate',outcome:'succeeded'}],truncated:false});
  assert.equal(JSON.stringify(result.executionAudit).includes(privateUrl),false);
  assert.equal(JSON.stringify(result.executionAudit).includes('Private page contents'),false);
 }finally{await rm(workspace,{recursive:true,force:true})}
});
