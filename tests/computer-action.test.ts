import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalComputerAction} from '../src/server/computer-action.ts';
const snapshot={url:'https://example.test/path?session=private#anchor',screenshotSha256:'a'.repeat(64)};
test('trusted server binds an approval to action, location and screenshot in a stable form',()=>{
 const first=canonicalComputerAction({kind:'browser',action:'click',by:'role',role:'button',target:'Submit'},snapshot);
 const reordered=canonicalComputerAction({target:'Submit',role:'button',action:'click',kind:'browser',by:'role'},snapshot);
 assert.equal(first,reordered);const decoded=JSON.parse(first);assert.equal(decoded.page,'https://example.test/path');assert.equal(first.includes('session=private'),false);
 assert.notEqual(first,canonicalComputerAction({kind:'browser',action:'click',by:'role',role:'button',target:'Delete'},snapshot));
 assert.notEqual(first,canonicalComputerAction({kind:'browser',action:'click',by:'role',role:'button',target:'Submit'},{...snapshot,url:'https://example.test/path?session=other'}));
 assert.notEqual(first,canonicalComputerAction({kind:'browser',action:'click',by:'role',role:'button',target:'Submit'},{...snapshot,screenshotSha256:'b'.repeat(64)}));
 const stable={...snapshot,guardFingerprint:'c'.repeat(64)},stableAction=canonicalComputerAction({kind:'browser',action:'click',by:'role',role:'button',target:'Submit'},stable);
 // The serialized proposal remains bound to the exact screenshot shown to the
 // user; ApprovalStore alone normalizes the volatile pixels for consumption.
 assert.notEqual(stableAction,canonicalComputerAction({kind:'browser',action:'click',by:'role',role:'button',target:'Submit'},{...stable,screenshotSha256:'d'.repeat(64)}));
 assert.notEqual(stableAction,canonicalComputerAction({kind:'browser',action:'click',by:'role',role:'button',target:'Submit'},{...stable,guardFingerprint:'e'.repeat(64)}));
 const blank=JSON.parse(canonicalComputerAction({kind:'browser',action:'navigate',url:'https://example.test/'},{url:'about:blank',screenshotSha256:'a'.repeat(64)}));assert.equal(blank.page,'about:blank');assert.equal(blank.arguments.url,'https://example.test/');
});
test('computer actions reject unexpected fields, unsafe paths and invalid controls',()=>{
 const invalid:unknown[]=[
  {kind:'browser',action:'inspect'}, {kind:'browser',action:'click',by:'role',role:'button',target:'Submit',unexpected:true},
  {kind:'browser',action:'navigate',url:'https://user:password@example.test/'}, {kind:'browser',action:'open_artifact',path:'../secret'},
  {kind:'browser',action:'open_artifact',path:'artifacts/index.html',artifactTaskId:'not-a-task-id'},
  {kind:'desktop',action:'click',x:1440,y:1}, {kind:'desktop',action:'click',x:1.5,y:1}, {kind:'desktop',action:'press',key:'Super+q'},
  {kind:'browser',action:'fill',by:'bad',target:'x',value:'x'}, {kind:'browser',action:'press',by:'label',target:'x',key:'Super+q'},
 ];
 for(const action of invalid)assert.throws(()=>canonicalComputerAction(action,snapshot));
 assert.throws(()=>canonicalComputerAction({kind:'desktop',action:'click',x:1,y:2},{...snapshot,screenshotSha256:'bad'}));
 const valid=JSON.parse(canonicalComputerAction({kind:'desktop',action:'click',x:12,y:34},snapshot));assert.deepEqual(valid.arguments,{x:12,y:34});
});
test('computer browser can target an explicitly identified same-user task artifact',()=>{
 const taskId='8faf80b9-752d-42f1-86fc-38bdaa0e4bc9';
 const action=JSON.parse(canonicalComputerAction({kind:'browser',action:'open_artifact',artifactTaskId:taskId,path:'artifacts/bse-demo/index.html'},snapshot));
 assert.deepEqual(action.arguments,{artifactTaskId:taskId,path:'artifacts/bse-demo/index.html'});
 assert.throws(()=>canonicalComputerAction({kind:'browser',action:'click',artifactTaskId:taskId,by:'role',role:'button',target:'Buy'},snapshot));
});
test('computer browser upload accepts only explicit same-user artifact paths and page file-input locators',()=>{
 const taskId='8faf80b9-752d-42f1-86fc-38bdaa0e4bc9';
 const action=JSON.parse(canonicalComputerAction({kind:'browser',action:'upload_file',artifactTaskId:taskId,path:'artifacts/bse-demo/index.html',by:'css',target:'input[type="file"]'},snapshot));
 assert.deepEqual(action.arguments,{artifactTaskId:taskId,path:'artifacts/bse-demo/index.html',by:'css',target:'input[type="file"]'});
 for(const invalid of [
  {kind:'browser',action:'upload_file',path:'/tmp/grok-test/secret.txt',by:'css',target:'input[type="file"]'},
  {kind:'browser',action:'upload_file',path:'shared/secret.txt',by:'css',target:'input[type="file"]'},
  {kind:'browser',action:'upload_file',path:'artifacts/../secret.txt',by:'css',target:'input[type="file"]'},
  {kind:'browser',action:'upload_file',path:'artifacts/.secret',by:'css',target:'input[type="file"]'},
  {kind:'browser',action:'upload_file',path:'artifacts/file.txt',by:'role',role:'button',target:'Upload'},
 ]) assert.throws(()=>canonicalComputerAction(invalid,snapshot));
});
test('computer actions can recover from Chromium’s canonical network error page',()=>{
 const failedPage={...snapshot,url:'chrome-error://chromewebdata/'};
 const navigate=JSON.parse(canonicalComputerAction({kind:'browser',action:'navigate',url:'http://127.0.0.1:8765/'},failedPage));
 assert.equal(navigate.page,'chrome-error://chromewebdata/');
 assert.equal(navigate.arguments.url,'http://127.0.0.1:8765/');
 const reload=JSON.parse(canonicalComputerAction({kind:'desktop',action:'click',x:295,y:48},failedPage));
 assert.equal(reload.page,'chrome-error://chromewebdata/');
 for(const url of ['chrome://settings/','chrome-error://other/','chrome-error://chromewebdata/path','chrome-error://chromewebdata/?x=1'])
  assert.throws(()=>canonicalComputerAction({kind:'browser',action:'navigate',url:'https://example.test/'},{...failedPage,url}));
});
test('terminal approvals bind the exact command and selected computer directory',()=>{
 const action={kind:'terminal',action:'run',command:'printf "done" > result.txt',directory:'shared'};
 const first=canonicalComputerAction(action,snapshot),decoded=JSON.parse(first);
 assert.equal(decoded.kind,'terminal');assert.deepEqual(decoded.arguments,{command:action.command,directory:'shared'});
 assert.notEqual(first,canonicalComputerAction({...action,command:'rm result.txt'},snapshot));
 assert.notEqual(first,canonicalComputerAction({...action,directory:'task'},snapshot));
 for(const invalid of [
  {...action,directory:'root'}, {...action,command:' '}, {...action,command:'echo x\u0000'}, {...action,unexpected:true},
  {...action,command:'x'.repeat(2401)},
 ]) assert.throws(()=>canonicalComputerAction(invalid,snapshot));
});
