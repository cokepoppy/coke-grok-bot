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
});
test('computer actions reject unexpected fields, unsafe paths and invalid controls',()=>{
 const invalid:unknown[]=[
  {kind:'browser',action:'inspect'}, {kind:'browser',action:'click',by:'role',role:'button',target:'Submit',unexpected:true},
  {kind:'browser',action:'navigate',url:'https://user:password@example.test/'}, {kind:'browser',action:'open_artifact',path:'../secret'},
  {kind:'desktop',action:'click',x:1440,y:1}, {kind:'desktop',action:'click',x:1.5,y:1}, {kind:'desktop',action:'press',key:'Super+q'},
  {kind:'browser',action:'fill',by:'bad',target:'x',value:'x'}, {kind:'browser',action:'press',by:'label',target:'x',key:'Super+q'},
 ];
 for(const action of invalid)assert.throws(()=>canonicalComputerAction(action,snapshot));
 assert.throws(()=>canonicalComputerAction({kind:'desktop',action:'click',x:1,y:2},{...snapshot,screenshotSha256:'bad'}));
 const valid=JSON.parse(canonicalComputerAction({kind:'desktop',action:'click',x:12,y:34},snapshot));assert.deepEqual(valid.arguments,{x:12,y:34});
});
