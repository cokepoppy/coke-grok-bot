import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRunTraceEvent } from '../src/server/run-trace.ts';

test('run traces retain only bounded operational metadata',()=>{
 const event=validateRunTraceEvent({
  component:'agent-runtime',event:'agent.dispatch',outcome:'failed',httpStatus:400,
  diagnosticCode:'agent_adapter_failed',durationMs:37,releaseId:`sha-${'a'.repeat(40)}`,
  prompt:'private user prompt',pageUrl:'https://mail.google.com/private',apiKey:'must not persist',
 });
 assert.deepEqual(event,{
  component:'agent-runtime',event:'agent.dispatch',outcome:'failed',httpStatus:400,
  diagnosticCode:'agent_adapter_failed',durationMs:37,releaseId:`sha-${'a'.repeat(40)}`,
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
});
