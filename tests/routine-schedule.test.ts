import test from 'node:test';
import assert from 'node:assert/strict';
import {nextRoutineRun,routineWhen,validateRoutineInput} from '../src/server/routine-store.ts';

test('weekly routine runs use the saved wall clock time zone and label',()=>{
 const schedule={kind:'weekly' as const,weekday:0,hour:23,minute:0};
 assert.equal(routineWhen(schedule,'America/Los_Angeles'),'Sundays at 11:00 PM');
 assert.equal(nextRoutineRun(schedule,'America/Los_Angeles',new Date('2026-11-04T16:00:00.000Z')).toISOString(),'2026-11-09T07:00:00.000Z');
});

test('weekly routine schedules through daylight-saving gaps at the first valid local minute',()=>{
 const schedule={kind:'weekly' as const,weekday:0,hour:2,minute:30};
 assert.equal(nextRoutineRun(schedule,'America/Los_Angeles',new Date('2026-03-01T12:00:00.000Z')).toISOString(),'2026-03-08T10:00:00.000Z');
});

test('routine validation enforces bounded schedules, instructions, and IANA zones',()=>{
 const requestId='e7ce5dce-60e3-49bf-9fc6-384f2e2f7e52';
 const valid={requestId,name:'Overnight outbound',instruction:'Prepare a weekly review.',schedule:{kind:'weekly',weekday:0,hour:23,minute:0},timezone:'America/Los_Angeles'};
 assert.deepEqual(validateRoutineInput(valid),valid);
 assert.throws(()=>validateRoutineInput({...valid,schedule:{kind:'interval',minutes:4}}),/Invalid routine/);
 assert.throws(()=>validateRoutineInput({...valid,timezone:'Not/AZone'}),/Invalid routine/);
 assert.throws(()=>validateRoutineInput({...valid,instruction:'  '}),/Invalid routine/);
});
