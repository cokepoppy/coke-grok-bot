import test from 'node:test';
import assert from 'node:assert/strict';
import { startPiRuntime } from '../src/server/pi-runtime.ts';
import type { Pool } from 'mysql2/promise';
test('Pi integration is off unless explicitly enabled and fails closed without configuration',async()=>{
 const unused={} as Pool;
 assert.equal(await startPiRuntime(unused,{}),null);
 assert.equal(await startPiRuntime(unused,{COKE_GROK_PI_ENABLED:'0'}),null);
 await assert.rejects(startPiRuntime(unused,{COKE_GROK_PI_ENABLED:'1'}),/Missing COKE_GROK_MODEL_KEY_FILE/);
});
