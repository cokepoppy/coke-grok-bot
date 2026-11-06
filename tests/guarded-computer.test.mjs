import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {createGuardedComputer,stableScreenshotFingerprint} from '../deploy/desktop/guarded-computer.mjs';

function screenshot(panelColor,contentColor){
 const png=new PNG({width:32,height:64});
 for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
  const index=(y*png.width+x)*4,color=y<27?panelColor:contentColor;
  png.data[index]=color[0];png.data[index+1]=color[1];png.data[index+2]=color[2];png.data[index+3]=255;
 }
 return PNG.sync.write(png);
}

test('stable fingerprint ignores Xfce panel redraws but detects browser-area changes',()=>{
 const first=screenshot([1,2,3],[8,9,10]),panelOnly=screenshot([40,50,60],[8,9,10]),contentChanged=screenshot([40,50,60],[11,12,13]);
 assert.equal(stableScreenshotFingerprint(first),stableScreenshotFingerprint(panelOnly));
 assert.notEqual(stableScreenshotFingerprint(first),stableScreenshotFingerprint(contentChanged));
});
test('guarded worker rejects changed screens, locations and ownership',async()=>{
 let owner='agent',url='https://example.test/',image=Buffer.from('screen-a'),effects=0;
 const worker=createGuardedComputer({readOwner:()=>owner,readPageUrl:async()=>url,readScreenshot:async()=>image,perform:async()=>++effects});
 const state=await worker.snapshot();image=Buffer.from('screen-b');await assert.rejects(worker.execute({},state));image=Buffer.from('screen-a');url='https://example.test/changed';await assert.rejects(worker.execute({},state));url=state.url;owner='user';await assert.rejects(worker.execute({},state));assert.equal(effects,0);
 owner='agent';assert.equal(await worker.execute({},state),1);
});
test('approved browser navigation tolerates screenshot-only changes but keeps the source URL and owner bound',async()=>{
 let owner='agent',url='about:blank',image=Buffer.from('address-bar-caret-a'),effects=0;
 const worker=createGuardedComputer({readOwner:()=>owner,readPageUrl:async()=>url,readScreenshot:async()=>image,perform:async()=>++effects});
 const state=await worker.snapshot();
 image=Buffer.from('address-bar-caret-b');
 assert.equal(await worker.execute({kind:'browser',action:'navigate',url:'https://example.com/'},state),1);
 assert.equal(effects,1);
 await assert.rejects(worker.execute({kind:'browser',action:'navigate',url:'https://example.com/'},{...state,url:'https://other.example/'}),/state or ownership changed/);
 owner='user';
 await assert.rejects(worker.execute({kind:'browser',action:'navigate',url:'https://example.com/'},state),/state or ownership changed/);
 assert.equal(effects,1);
});
test('approved browser clicks remain bound to the exact screenshot',async()=>{
 let image=Buffer.from('screen-a'),effects=0;
 const worker=createGuardedComputer({readOwner:()=> 'agent',readPageUrl:async()=> 'https://example.test/',readScreenshot:async()=>image,perform:async()=>++effects});
 const state=await worker.snapshot();
 image=Buffer.from('screen-b');
 await assert.rejects(worker.execute({kind:'browser',action:'click',by:'role',role:'button',target:'Continue'},state),/state or ownership changed/);
 assert.equal(effects,0);
});
test('guarded browser actions tolerate only volatile panel pixels',async()=>{
 let image=screenshot([1,2,3],[8,9,10]),effects=0;
 const worker=createGuardedComputer({readOwner:()=> 'agent',readPageUrl:async()=> 'https://example.test/',readScreenshot:async()=>image,perform:async()=>++effects});
 const state=await worker.snapshot();image=screenshot([40,50,60],[8,9,10]);
 assert.equal(await worker.execute({kind:'browser',action:'click',by:'role',role:'button',target:'Continue'},state),1);
 image=screenshot([40,50,60],[11,12,13]);
 await assert.rejects(worker.execute({kind:'browser',action:'click',by:'role',role:'button',target:'Continue'},state),/state or ownership changed/);
 assert.equal(effects,1);
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
