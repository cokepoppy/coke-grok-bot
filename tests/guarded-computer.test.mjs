import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuardedComputer} from '../deploy/desktop/guarded-computer.mjs';
test('guarded worker rejects changed screens, locations and ownership',async()=>{
 let owner='agent',url='https://example.test/',image=Buffer.from('screen-a'),effects=0;
 const worker=createGuardedComputer({readOwner:()=>owner,readPageUrl:async()=>url,readScreenshot:async()=>image,perform:async()=>++effects});
 const state=await worker.snapshot();image=Buffer.from('screen-b');await assert.rejects(worker.execute({},state));image=Buffer.from('screen-a');url='https://example.test/changed';await assert.rejects(worker.execute({},state));url=state.url;owner='user';await assert.rejects(worker.execute({},state));assert.equal(effects,0);
 owner='agent';assert.equal(await worker.execute({},state),1);
});
test('ownership changes and guarded actions run serially',async()=>{
 let owner='agent',started=false,release;const gate=new Promise(resolve=>{release=resolve});
 const worker=createGuardedComputer({readOwner:()=>owner,readPageUrl:async()=>'',readScreenshot:async()=>Buffer.from('screen'),perform:async()=>{started=true;await gate;return 'done'}});
 const state=await worker.snapshot(),action=worker.execute({},state);
 while(!started)await new Promise(resolve=>setImmediate(resolve));
 let changed=false;const takeover=worker.locked(async()=>{owner='user';changed=true});await new Promise(resolve=>setImmediate(resolve));assert.equal(changed,false);
 release();assert.equal(await action,'done');await takeover;assert.equal(changed,true);
 await assert.rejects(worker.execute({},state));
});
