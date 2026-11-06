import test from 'node:test';
import assert from 'node:assert/strict';
import {findGroupMentionQuery,groupRecipientBotIds,rebaseGroupMentionTokens} from '../src/web/group-mentions.ts';

test('group mention query opens only for a trailing @ token, not an email address or completed mention',()=>{
 assert.deepEqual(findGroupMentionQuery('Ask @Sales',10),{start:4,end:10,query:'Sales'});
 assert.deepEqual(findGroupMentionQuery('@',1),{start:0,end:1,query:''});
 assert.equal(findGroupMentionQuery('mail@example.com',16),null);
 assert.equal(findGroupMentionQuery('@Sales Outbound',15),null);
});

test('selected group Bot IDs follow edits outside their visible token and are dropped when token text changes',()=>{
 const token={botId:'bot-sales',name:'Sales Outbound',start:18,end:33};
 assert.deepEqual(rebaseGroupMentionTokens('@Chief please ask @Sales Outbound', '@Chief, please ask @Sales Outbound', [token]),[{...token,start:19,end:34}]);
 assert.deepEqual(rebaseGroupMentionTokens('@Chief please ask @Sales Outbound', '@Chief please ask @Sales', [token]),[]);
 assert.deepEqual(rebaseGroupMentionTokens('@Chief please ask @Sales Outbound', 'Update: @Chief please ask @Sales Outbound', [token]),[{...token,start:26,end:41}]);
});

test('optimistic Bot activity follows the server-reported recipients',()=>{
 const members=['chief','sales','inbox'];
 assert.deepEqual(groupRecipientBotIds(members,['chief']),['chief']);
 assert.deepEqual(groupRecipientBotIds(members,members),members);
 assert.deepEqual(groupRecipientBotIds(members,[]),members);
 assert.deepEqual(groupRecipientBotIds(members,['chief','foreign']),['chief']);
});
