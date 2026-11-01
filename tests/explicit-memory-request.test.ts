import test from 'node:test';
import assert from 'node:assert/strict';
import { explicitMemoryRequest } from '../src/server/explicit-memory-request.ts';

test('explicit long-lived Bot preference becomes a bounded memory request',()=>{
 const prompt='Please remember this lasting preference for this Bot: when I ask for an acceptance marker, use exactly GKBOT_TEST_MARKER. This is a synthetic test value, not a secret. Confirm after saving it. Do not use the computer.';
 assert.deepEqual(explicitMemoryRequest(prompt),{title:'Bot preference',content:'when I ask for an acceptance marker, use exactly GKBOT_TEST_MARKER.'});
});

test('explicit first-person English and Chinese durable preferences are recognized',()=>{
 assert.deepEqual(explicitMemoryRequest('Please remember that I prefer concise answers with a short summary.'),{title:'User preference',content:'I prefer concise answers with a short summary.'});
 assert.deepEqual(explicitMemoryRequest('请记住我喜欢先给结论，再列出关键步骤。'),{title:'用户偏好',content:'我喜欢先给结论，再列出关键步骤。'});
 assert.deepEqual(explicitMemoryRequest('保存到记忆里：我的时区是 Asia/Shanghai。'),{title:'Bot 偏好',content:'我的时区是 Asia/Shanghai。'});
});

test('one-off, quoted, and negated instructions are not automatically persisted',()=>{
 assert.equal(explicitMemoryRequest('Remember to buy milk on the way home.'),null);
 assert.equal(explicitMemoryRequest('The user wrote: "Please remember this lasting preference for this Bot: use concise replies."'),null);
 assert.equal(explicitMemoryRequest('Please do not remember that I prefer concise answers.'),null);
 assert.equal(explicitMemoryRequest('记住我今天要买牛奶。'),null);
});
