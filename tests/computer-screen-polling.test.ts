import test from 'node:test';
import assert from 'node:assert/strict';
import { computerScreenRetryDelay } from '../src/web/computer-screen-polling.ts';

test('computer screen polling backs off after repeated transport failures and resets to the normal cadence',()=>{
  assert.deepEqual([0,1,2,3,4,5].map(computerScreenRetryDelay),[2_000,2_000,4_000,8_000,15_000,15_000]);
  assert.equal(computerScreenRetryDelay(-1),2_000);
  assert.equal(computerScreenRetryDelay(Number.NaN),2_000);
});
