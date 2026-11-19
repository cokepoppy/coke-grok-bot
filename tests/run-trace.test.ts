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
  upstreamHttpStatus:400,adapterExitCode:1,adapterExitSignal:'SIGTERM',diagnosticCode:'agent_adapter_failed',reasonCode:'model_request_rejected',durationMs:37,releaseId:`sha-${'a'.repeat(40)}`,
  stage:'model-request',operation:'agent-adapter',transportCode:'ECONNRESET',
  prompt:'private user prompt',pageUrl:'https://mail.google.com/private',apiKey:'must not persist',
 });
 assert.deepEqual(event,{
  component:'agent-runtime',event:'agent.dispatch',outcome:'failed',httpStatus:400,
  attemptNumber:null,upstreamHttpStatus:400,upstreamErrorKind:null,upstreamErrorCode:null,retryAfterSeconds:null,requestBytes:null,requestLimitBytes:null,
  adapterExitCode:1,adapterExitSignal:'SIGTERM',databaseCode:null,relatedComponent:null,relatedEvent:null,
  diagnosticCode:'agent_adapter_failed',reasonCode:'model_request_rejected',durationMs:37,releaseId:`sha-${'a'.repeat(40)}`,
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
 assert.equal(validateRunTraceEvent({...base,upstreamHttpStatus:400})?.upstreamHttpStatus,400);
 assert.equal(validateRunTraceEvent({...base,component:'computer-worker',upstreamHttpStatus:400}),null);
  assert.deepEqual(validateRunTraceEvent({...base,httpStatus:413,diagnosticCode:'MODEL_GATEWAY_REQUEST_REJECTED',reasonCode:'request_body_too_large',stage:'request-validation',operation:'chat-completions',requestBytes:2_097_153,requestLimitBytes:2_097_152})?.requestBytes,2_097_153);
  assert.equal(validateRunTraceEvent({...base,requestBytes:2_097_153}),null);
  assert.equal(validateRunTraceEvent({...base,requestBytes:2_097_152,requestLimitBytes:2_097_152}),null);
 assert.equal(validateRunTraceEvent({...base,component:'agent-runtime',reasonCode:'private error text'}),null);
 assert.equal(validateRunTraceEvent({...base,component:'agent-runtime',adapterExitCode:256}),null);
 assert.equal(validateRunTraceEvent({...base,adapterExitCode:1}),null);
 const purchased=validateRunTraceEvent({...base,upstreamHttpStatus:403,upstreamErrorKind:'permission_denied',upstreamErrorCode:'model_not_purchased'});
 assert.equal(purchased?.upstreamErrorCode,'model_not_purchased');
 assert.equal(validateRunTraceEvent({...base,upstreamHttpStatus:403,upstreamErrorKind:'permission_denied',upstreamErrorCode:'AccessDenied.Unpurchased'}),null);
});

test('computer-control retries retain attempt number, status, transport code, and terminal reason',()=>{
 const base={component:'agent-runtime',event:'agent.computer.control',stage:'computer-control',outcome:'info',attemptNumber:2,diagnosticCode:'COMPUTER_CONTROL_CHECK_RETRY',httpStatus:503,transportCode:'ECONNREFUSED'};
 const event=validateRunTraceEvent({...base,reasonCode:'computer_control_unavailable'});
 assert.equal(event?.attemptNumber,2);assert.equal(event?.httpStatus,503);assert.equal(event?.transportCode,'ECONNREFUSED');assert.equal(event?.reasonCode,'computer_control_unavailable');
 assert.equal(validateRunTraceEvent({...base,event:'agent.adapter.exit',attemptNumber:2}),null,'attempt numbers are limited to control poll events for this runtime component');
});
