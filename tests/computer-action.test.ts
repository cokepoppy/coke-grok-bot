import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalComputerAction} from '../src/server/computer-action.ts';

const snapshot={url:'https://example.test/path?session=private#anchor',screenshotSha256:'a'.repeat(64)};

test('computer action envelopes bind the observed screen and canonicalize fields',()=>{
 const first=canonicalComputerAction({kind:'browser',action:'click',by:'role',role:'button',target:'Submit'},snapshot);
 const reordered=canonicalComputerAction({target:'Submit',role:'button',action:'click',kind:'browser',by:'role'},snapshot);
 assert.equal(first,reordered);
 const decoded=JSON.parse(first);
 assert.equal(decoded.page,'https://example.test/path');
 assert.equal(first.includes('session=private'),false);
 assert.notEqual(first,canonicalComputerAction({kind:'browser',action:'click',by:'role',role:'button',target:'Delete'},snapshot));
 assert.notEqual(first,canonicalComputerAction({kind:'browser',action:'click',by:'role',role:'button',target:'Submit'},{...snapshot,url:'https://example.test/path?session=other'}));
 assert.notEqual(first,canonicalComputerAction({kind:'browser',action:'click',by:'role',role:'button',target:'Submit'},{...snapshot,screenshotSha256:'b'.repeat(64)}));
});

test('canonical action does not filter action names, URL schemes, keys, or extra fields',()=>{
 const key=`VendorKey+XF86AudioMute+${'CUSTOM'.repeat(900)}`;
 const input={
  kind:'browser',action:'future_browser_operation',url:'custom-scheme://app/window?token=value',
  by:'new-locator-kind',target:'an unrestricted target',key,
  extra:{nested:true,items:[1,'two',null]},path:'../same-user-file',
 };
 const result=JSON.parse(canonicalComputerAction(input,snapshot));
 assert.equal(result.action,input.action);
 assert.deepEqual(result.arguments,{
  url:input.url,by:input.by,target:input.target,key:input.key,extra:input.extra,path:input.path,
 });
 const desktop=JSON.parse(canonicalComputerAction({kind:'desktop',action:'future_desktop_operation',key,custom:'passed-through'},snapshot));
 assert.deepEqual(desktop.arguments,{key,custom:'passed-through'});
});

test('all syntactically valid browser URL schemes pass through canonicalization',()=>{
 for(const url of [
  'http://127.0.0.1:8765/',
  'https://example.test/path',
  'chrome://settings/',
  'chrome://newtab/',
  'data:text/plain,hello',
  'file:///workspace/index.html',
  'javascript:alert(1)',
  'custom-scheme://app/window',
 ]) {
  const action=JSON.parse(canonicalComputerAction({kind:'browser',action:'navigate',url},{...snapshot,url:'about:blank'}));
  assert.equal(action.arguments.url,url);
 }
});

test('browser and desktop key arguments preserve arbitrary names and combinations',()=>{
 const key=`XF86_${'CUSTOM'.repeat(900)}`;
 const browser=JSON.parse(canonicalComputerAction({kind:'browser',action:'press',by:'label',target:'Search',key},snapshot));
 const desktop=JSON.parse(canonicalComputerAction({kind:'desktop',action:'press',key},snapshot));
 assert.equal(browser.arguments.key,key);
 assert.equal(desktop.arguments.key,key);
});

test('only the computer action envelope and screen fingerprints require structural validity',()=>{
 for(const input of [
  null,
  [],
  {},
  {kind:'unknown-worker-route',action:'click'},
  {kind:'browser',action:''},
  {kind:'desktop',action:3},
 ]) assert.throws(()=>canonicalComputerAction(input,snapshot));
 assert.throws(()=>canonicalComputerAction({kind:'desktop',action:'click'},{...snapshot,screenshotSha256:'bad'}));
 assert.throws(()=>canonicalComputerAction({kind:'desktop',action:'click'},{...snapshot,guardFingerprint:'bad'}));
});
