import test from 'node:test';
import assert from 'node:assert/strict';
import {formatChatTimestamp,shouldShowChatTimestamp} from '../src/web/chat-timestamps.ts';

test('formats chat timestamps as a time today and a dated time for older messages',()=>{
 const now=new Date(2026,10,17,16,30);
 assert.equal(formatChatTimestamp(new Date(2026,10,17,15,4),now),'15:04');
 assert.equal(formatChatTimestamp(new Date(2026,10,16,9,5),now),'Yesterday · 09:05');
 assert.equal(formatChatTimestamp(new Date(2026,10,12,9,5),now),'12 Nov · 09:05');
 assert.equal(formatChatTimestamp(new Date(2025,10,12,9,5),now),'12 Nov 2025 · 09:05');
});

test('invalid timestamps render as empty text',()=>{
 assert.equal(formatChatTimestamp('not-a-time',new Date(2026,10,17)),'');
});

test('shows a timestamp at the start, after a long gap, or across a calendar day',()=>{
 const first=new Date(2026,10,17,15,0).getTime();
 assert.equal(shouldShowChatTimestamp(first,null),true);
 assert.equal(shouldShowChatTimestamp(first+4*60*1000,first),false);
 assert.equal(shouldShowChatTimestamp(first+5*60*1000,first),true);
 const nextDay=new Date(2026,10,18,0,1).getTime();
 assert.equal(shouldShowChatTimestamp(nextDay,new Date(2026,10,17,23,59).getTime()),true);
 assert.equal(shouldShowChatTimestamp(0,null),false);
});
