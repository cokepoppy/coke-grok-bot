import test from 'node:test';
import assert from 'node:assert/strict';
import { computerActionTraceEvent,validateRunTraceEvent } from '../src/server/run-trace.ts';

test('computer action trace names expose only a fixed action type',()=>{
 const url='https://mail.example/private?token=secret';
 const event=computerActionTraceEvent('computer.propose',{kind:'browser',action:'navigate',url});
 assert.equal(event,'computer.propose.browser.navigate');
 assert.equal(event.includes('private'),false);
 assert.equal(event.includes('secret'),false);
 assert.equal(validateRunTraceEvent({component:'computer-worker',event,outcome:'failed',httpStatus:500,diagnosticCode:'COMPUTER_BROWSER_NAVIGATION_NETWORK_FAILED'} )?.event,event);
 assert.equal(computerActionTraceEvent('computer.propose',{kind:'browser',action:'secret-input'}),'computer.propose.browser.unknown');
 assert.equal(computerActionTraceEvent('computer.execute',{kind:'desktop',action:'press',key:'Cmd+Shift+Secret'}),'computer.execute.desktop.press');
 assert.equal(computerActionTraceEvent('model.request',{kind:'browser',action:'navigate'}),'model.request');
});

test('run traces retain only bounded operational metadata',()=>{
 const event=validateRunTraceEvent({
  component:'agent-runtime',event:'agent.dispatch',outcome:'failed',httpStatus:400,
  upstreamHttpStatus:400,adapterExitCode:1,diagnosticCode:'agent_adapter_failed',reasonCode:'model_request_rejected',durationMs:37,releaseId:`sha-${'a'.repeat(40)}`,
  stage:'model-request',operation:'agent-adapter',transportCode:'ECONNRESET',
  prompt:'private user prompt',pageUrl:'https://mail.google.com/private',apiKey:'must not persist',
 });
 assert.deepEqual(event,{
  component:'agent-runtime',event:'agent.dispatch',outcome:'failed',httpStatus:400,
  upstreamHttpStatus:400,adapterExitCode:1,diagnosticCode:'agent_adapter_failed',reasonCode:'model_request_rejected',durationMs:37,releaseId:`sha-${'a'.repeat(40)}`,
  stage:'model-request',operation:'agent-adapter',transportCode:'ECONNRESET',
 });
 assert.equal(JSON.stringify(event).includes('private'),false);
 assert.equal(JSON.stringify(event).includes('apiKey'),false);
});

test('run traces reject malformed component, status, diagnostic, timing, and release identifiers',()=>{
 const base={component:'model-gateway',event:'model.request',outcome:'failed'};
 assert.equal(validateRunTraceEvent({...base,component:'arbitrary'}),null);
 assert.equal(validateRunTraceEvent({...base,httpStatus:600}),null);
 assert.equal(validateRunTraceEvent({...base,diagnosticCode:'includes private text'}),null);
 assert.equal(validateRunTraceEvent({...base,durationMs:-1}),null);
 assert.equal(validateRunTraceEvent({...base,releaseId:'latest'}),null);
 assert.equal(validateRunTraceEvent({...base,stage:'private URL https://example.test'}),null);
 assert.equal(validateRunTraceEvent({...base,operation:'private operation'}),null);
 assert.equal(validateRunTraceEvent({...base,transportCode:'private error text'}),null);
 assert.equal(validateRunTraceEvent({...base,upstreamHttpStatus:400}),null);
 assert.equal(validateRunTraceEvent({...base,component:'agent-runtime',reasonCode:'private error text'}),null);
 assert.equal(validateRunTraceEvent({...base,component:'agent-runtime',adapterExitCode:256}),null);
 assert.equal(validateRunTraceEvent({...base,adapterExitCode:1}),null);
});
