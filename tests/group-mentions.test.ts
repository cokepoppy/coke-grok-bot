import test from 'node:test';
import assert from 'node:assert/strict';
import {findGroupMentionQuery,groupMentionRecipientBotIds,groupRecipientBotIds,rebaseGroupMentionTokens} from '../src/web/group-mentions.ts';

test('group mention query opens only for a trailing @ token, not an email address or completed mention',()=>{
 assert.deepEqual(findGroupMentionQuery('Ask @Sales',10),{start:4,end:10,query:'Sales'});
 assert.deepEqual(findGroupMentionQuery('@',1),{start:0,end:1,query:''});
 assert.equal(findGroupMentionQuery('mail@example.com',16),null);
 assert.equal(findGroupMentionQuery('@Sales Outbound',15),null);
});

test('selected group Bot IDs follow edits outside their visible token and are dropped when token text changes',()=>{
 const token={kind:'bot' as const,botId:'bot-sales',name:'Sales Outbound',start:18,end:33};
 assert.deepEqual(rebaseGroupMentionTokens('@Chief please ask @Sales Outbound', '@Chief, please ask @Sales Outbound', [token]),[{...token,start:19,end:34}]);
 assert.deepEqual(rebaseGroupMentionTokens('@Chief please ask @Sales Outbound', '@Chief please ask @Sales', [token]),[]);
 assert.deepEqual(rebaseGroupMentionTokens('@Chief please ask @Sales Outbound', 'Update: @Chief please ask @Sales Outbound', [token]),[{...token,start:26,end:41}]);
});

test('@everyone expands only to the current group roster and survives edits outside the token',()=>{
 const members=['chief','sales','tester'];
 const everyone={kind:'everyone' as const,name:'everyone' as const,start:0,end:9};
 assert.deepEqual(groupMentionRecipientBotIds(members,[everyone]),members);
 assert.deepEqual(groupMentionRecipientBotIds(members,[everyone,{kind:'bot',botId:'sales',name:'Sales',start:14,end:20}]),members);
 assert.deepEqual(groupMentionRecipientBotIds(members,[{kind:'bot',botId:'unknown',name:'Other',start:0,end:6}]),[]);
 assert.deepEqual(rebaseGroupMentionTokens('@everyone please review', 'Today: @everyone please review', [everyone]),[{...everyone,start:7,end:16}]);
 assert.deepEqual(rebaseGroupMentionTokens('@everyone please review', '@every one please review', [everyone]),[]);
});

test('optimistic Bot activity follows the server-reported recipients',()=>{
 const members=['chief','sales','inbox'];
 assert.deepEqual(groupRecipientBotIds(members,['chief']),['chief']);
 assert.deepEqual(groupRecipientBotIds(members,members),members);
 assert.deepEqual(groupRecipientBotIds(members,[]),members);
 assert.deepEqual(groupRecipientBotIds(members,['chief','foreign']),['chief']);
});
