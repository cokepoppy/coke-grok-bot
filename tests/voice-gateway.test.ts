import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createAuthServer } from '../src/server/auth-http.ts';
import type { GoogleAuthService } from '../src/server/google-auth.ts';
import type { Session } from '../src/server/tenant-store.ts';
import { BotStore, type StoredMessage } from '../src/server/bot-store.ts';
import type { Pool } from 'mysql2/promise';
import { encodeClientWebSocketFrame, parseVoiceRealtimeOptions, VoiceGateway, VoiceGatewayError, validatePcmWav, type VoiceGatewayApi } from '../src/server/voice-gateway.ts';

function wav(samples = 320): Buffer {
  const dataBytes = samples * 2, output = Buffer.alloc(44 + dataBytes);
  output.write('RIFF', 0); output.writeUInt32LE(output.length - 8, 4); output.write('WAVE', 8); output.write('fmt ', 12);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22); output.writeUInt32LE(16_000, 24);
  output.writeUInt32LE(32_000, 28); output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34); output.write('data', 36); output.writeUInt32LE(dataBytes, 40);
  return output;
}

test('Qwen ASR gateway sends private WAV as a Token Plan DashScope request and returns only transcript text', async () => {
  let called = 0;
  const gateway = new VoiceGateway('test-api-key', 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', async (input, init) => {
    called++;
    assert.equal(String(input), 'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-api-key');
    const body = JSON.parse(String(init?.body)) as { model: string; input: { messages: Array<{ content: Array<{ input_audio?: { data?: string } }> }> }; parameters: { format: string; sample_rate: string } };
    assert.equal(body.model, 'qwen-audio-3.0-asr-flash');
    assert.equal(body.parameters.format, 'wav'); assert.equal(body.parameters.sample_rate, '16000');
    assert.ok(body.input.messages[0].content[0].input_audio?.data?.startsWith('data:audio/wav;base64,'));
    return new Response(JSON.stringify({ output: { text: '  open my inbox  ' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  assert.equal(validatePcmWav(wav()), true);
  assert.equal(await gateway.transcribeWav(wav()), 'open my inbox');
  assert.equal(called, 1);
});

test('WebSocket setup frame masks payloads and encodes extended lengths correctly', () => {
  for (const length of [3, 125, 126, 1024]) {
    const text = 'x'.repeat(length), frame = encodeClientWebSocketFrame(text);
    const marker = frame[1] & 0x7f;
    const extendedLength = marker === 126 ? 2 : marker === 127 ? 8 : 0;
    assert.equal(frame[0], 0x81); assert.equal(Boolean(frame[1] & 0x80), true);
    const declaredLength = extendedLength === 2 ? frame.readUInt16BE(2) : extendedLength === 8 ? Number(frame.readBigUInt64BE(2)) : marker;
    assert.equal(declaredLength, length);
    const maskOffset = 2 + extendedLength, payloadOffset = maskOffset + 4;
    const mask = frame.subarray(maskOffset, payloadOffset);
    const decoded = Buffer.alloc(length);
    for (let i = 0; i < length; i++) decoded[i] = frame[payloadOffset + i] ^ mask[i % 4];
    assert.equal(decoded.toString(), text);
  }
  assert.throws(() => encodeClientWebSocketFrame('x'.repeat(16_385)), /frame too large/);
});

test('realtime call settings accept only documented Qwen 3.0 voices and bounded speech rates', () => {
  assert.deepEqual(parseVoiceRealtimeOptions(new URLSearchParams()), { voice: 'longanqian', speechRate: 1 });
  assert.deepEqual(parseVoiceRealtimeOptions(new URLSearchParams('voice=longanlingxi&speech_rate=1.5')), { voice: 'longanlingxi', speechRate: 1.5 });
  for (const query of ['voice=unknown', 'speech_rate=0.49', 'speech_rate=2.01', 'speech_rate=NaN', 'voice=longanqian&voice=longanlingxi', 'token=secret']) {
    assert.throws(() => parseVoiceRealtimeOptions(new URLSearchParams(query)), (error: unknown) => error instanceof VoiceGatewayError && error.status === 400);
  }
});

test('Qwen ASR gateway rejects invalid audio and suppresses provider response bodies', async () => {
  let called = 0;
  const gateway = new VoiceGateway('test-api-key', 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', async () => {
    called++;
    return new Response('private upstream diagnostic', { status: 500 });
  });
  await assert.rejects(gateway.transcribeWav(Buffer.from('not wav')), (error: unknown) => error instanceof VoiceGatewayError && error.code === 'VOICE_AUDIO_INVALID');
  assert.equal(called, 0);
  await assert.rejects(gateway.transcribeWav(wav()), (error: unknown) => error instanceof VoiceGatewayError && !error.message.includes('private upstream diagnostic'));
  assert.equal(called, 1);
  assert.throws(() => new VoiceGateway('test-api-key', 'https://attacker.example/compatible-mode/v1'), /Invalid voice model endpoint/);
});

test('Qwen TTS gateway downloads only the fixed Beijing signed audio object and returns no signed URL', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const gateway = new VoiceGateway('test-api-key', 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', async (input, init) => {
    const url = String(input); calls.push({ url, init });
    if (url.endsWith('/api/v1/services/audio/tts/SpeechSynthesizer')) {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-api-key');
      const body = JSON.parse(String(init?.body)) as { model: string; input: { text: string; voice: string; format: string; sample_rate: number } };
      assert.equal(body.model, 'qwen-audio-3.0-tts-plus');
      assert.deepEqual(body.input, { text: 'Hello from voice.', voice: 'longanhuan_v3.6', format: 'mp3', sample_rate: 22_050 });
      return new Response(JSON.stringify({ output: { finish_reason: 'stop', audio: { url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/prod/qwen-audio-3.0-tts-plus/2026/audio.mp3?signature=private' } } }), { status: 200 });
    }
    assert.equal(url, 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/prod/qwen-audio-3.0-tts-plus/2026/audio.mp3?signature=private');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    return new Response(Buffer.from('private-mp3-bytes'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  });
  const audio = await gateway.synthesizeSpeech('  Hello from voice.  ');
  assert.equal(audio.toString(), 'private-mp3-bytes');
  assert.equal(calls.length, 2);
  await assert.rejects(gateway.synthesizeSpeech(' '), (error: unknown) => error instanceof VoiceGatewayError && error.status === 400);
  const unsafe = new VoiceGateway('test-api-key', 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', async () => new Response(JSON.stringify({ output: { audio: { url: 'https://127.0.0.1/admin' } } }), { status: 200 }));
  await assert.rejects(unsafe.synthesizeSpeech('hello'), (error: unknown) => error instanceof VoiceGatewayError && error.code === 'VOICE_PROVIDER_UNAVAILABLE');
});

test('dictation endpoint requires authentication, same-origin request and Bot ownership', async () => {
  const owner: Session = { tenantId: randomUUID(), userId: randomUUID(), email: 'owner@example.test', name: 'Owner', role: 'owner' };
  const other: Session = { ...owner, userId: randomUUID(), email: 'other@example.test' };
  const botId = randomUUID(), calls: string[] = [];
  const auth = { session: async (req: import('node:http').IncomingMessage) => req.headers.cookie === 'owner' ? owner : req.headers.cookie === 'other' ? other : null } as unknown as GoogleAuthService;
  const runs = { ownsBot: async (session: Session, id: string) => session.userId === owner.userId && id === botId } as unknown as import('../src/server/run-store.ts').RunStore;
  const voice: VoiceGatewayApi = {
    async transcribeWav(audio) { calls.push(audio.toString('ascii', 0, 4)); return 'draft from speech'; },
    async synthesizeSpeech(text) { calls.push(`tts:${text}`); return Buffer.from('audio'); },
    async upgradeRealtime(_req, client) { client.end('HTTP/1.1 204 No Content\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); },
  };
  const probe = await import('node:net'); const listener = probe.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = (listener.address() as AddressInfo).port; await new Promise<void>(resolve => listener.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const server = createAuthServer(auth, `${origin}/grok-bot`, undefined, undefined, runs, undefined, undefined, 'pi', undefined, undefined, undefined, undefined, voice);
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  const url = `${origin}/grok-bot/api/bots/${botId}/voice/dictate`;
  try {
    const audio = wav();
    const post = (cookie: string, from = origin) => fetch(url, { method: 'POST', headers: { cookie, origin: from, 'content-type': 'audio/wav' }, body: audio });
    assert.equal((await post('')).status, 401);
    assert.equal((await post('other')).status, 404);
    assert.equal((await post('owner', 'https://attacker.example')).status, 403);
    const response = await post('owner');
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { text: 'draft from speech' });
    const speechUrl = `${origin}/grok-bot/api/bots/${botId}/voice/speech`;
    const speechPost = (cookie: string, text: unknown, from = origin) => fetch(speechUrl, { method: 'POST', headers: { cookie, origin: from, 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    assert.equal((await speechPost('')).status, 401);
    assert.equal((await speechPost('other', 'hello')).status, 404);
    assert.equal((await speechPost('owner', 'hello', 'https://attacker.example')).status, 403);
    const speech = await speechPost('owner', 'hello');
    assert.equal(speech.status, 200); assert.equal(speech.headers.get('content-type'), 'audio/mpeg'); assert.equal(await speech.text(), 'audio');
    assert.deepEqual(calls, ['RIFF', 'tts:hello']);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('voice call endpoint saves a duration and transcript card, and persists owned feedback', async () => {
  const owner: Session = { tenantId: randomUUID(), userId: randomUUID(), email: 'owner@example.test', name: 'Owner', role: 'owner' };
  const botId = randomUUID(), callId = randomUUID(), saved: StoredMessage[] = [];
  const auth = { session: async (req: import('node:http').IncomingMessage) => req.headers.cookie === 'owner' ? owner : null } as unknown as GoogleAuthService;
  const bots = {
    async addVoiceCall(session: Session, id: string, durationSeconds:number, messages: Array<{ role: 'user' | 'bot'; text: string }>) {
      if (session.userId !== owner.userId || id !== botId) return null;
      const row:StoredMessage={id:callId,role:'voice',text:'',createdAt:new Date().toISOString(),voiceCall:{durationSeconds,transcript:messages,feedback:null}};
      saved.push(row);return row;
    },
    async setVoiceCallFeedback(session:Session,id:string,recordId:string,feedback:'good'|'bad'){
      if(session.userId!==owner.userId||id!==botId||recordId!==callId)return false;
      const row=saved.find(message=>message.id===recordId);if(!row?.voiceCall)return false;row.voiceCall.feedback=feedback;return true;
    }
  } as unknown as BotStore;
  const probe = await import('node:net'); const listener = probe.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = (listener.address() as AddressInfo).port; await new Promise<void>(resolve => listener.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const server = createAuthServer(auth, `${origin}/grok-bot`, undefined, bots);
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  const url = `${origin}/grok-bot/api/bots/${botId}/voice/transcript`;
  const transcript = { durationSeconds:59, messages: [{ role: 'user', text: 'Find my unread mail.' }, { role: 'bot', text: 'I found three unread messages.' }] };
  try {
    const post = (cookie: string, body: unknown, from = origin) => fetch(url, { method: 'POST', headers: { cookie, origin: from, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('', transcript)).status, 401);
    assert.equal((await post('owner', transcript, 'https://attacker.example')).status, 403);
    assert.equal((await post('owner', { durationSeconds:59,messages: [{ role: 'system', text: 'forged' }] })).status, 400);
    assert.equal((await post('owner', { durationSeconds:-1,messages:[] })).status, 400);
    const response = await post('owner', transcript);
    assert.equal(response.status, 201);
    const value = await response.json() as { message: StoredMessage };
    assert.equal(value.message.role,'voice');assert.equal(value.message.voiceCall?.durationSeconds,59);
    assert.deepEqual(value.message.voiceCall?.transcript.map(message=>[message.role,message.text]),[['user','Find my unread mail.'],['bot','I found three unread messages.']]);
    const feedbackUrl=`${origin}/grok-bot/api/bots/${botId}/voice/calls/${callId}/feedback`;
    const feedbackPost=(cookie:string,body:unknown,from=origin)=>fetch(feedbackUrl,{method:'POST',headers:{cookie,origin:from,'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await feedbackPost('',{feedback:'good'})).status,401);
    assert.equal((await feedbackPost('owner',{feedback:'great'})).status,400);
    assert.equal((await feedbackPost('owner',{feedback:'good'},'https://attacker.example')).status,403);
    assert.deepEqual(await (await feedbackPost('owner',{feedback:'good'})).json(),{ok:true,feedback:'good'});
    assert.equal(saved[0].voiceCall?.feedback,'good');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('BotStore stores a bounded voice call separately from ordinary Bot messages and supports feedback', async () => {
  const owner: Session = { tenantId: randomUUID(), userId: randomUUID(), email: 'owner@example.test', name: 'Owner', role: 'owner' };
  const botId=randomUUID(), callId=randomUUID();let feedback:string|null=null;const savedAt='2026-11-14T00:00:01.000Z';
  const pool={async execute(sql:string,params:unknown[]=[]){
    if(sql.startsWith('INSERT INTO bot_voice_calls'))return[{affectedRows:params[3]===botId&&params[5]===owner.userId?1:0},[]];
    if(sql.startsWith('SELECT id,duration_seconds AS durationSeconds'))return[[{id:callId,durationSeconds:59,transcript:JSON.stringify([{role:'user',text:'Hello'},{role:'bot',text:'Hi there.'}]),feedback,createdAt:savedAt}],[]];
    if(sql.startsWith('UPDATE bot_voice_calls')){feedback=String(params[0]);return[{affectedRows:1},[]]}
    throw new Error(`Unexpected SQL in fake pool: ${sql}`);
  }};
  const store = new BotStore(pool);
  const saved = await store.addVoiceCall(owner, botId,59,[{ role: 'user', text: 'Hello' }, { role: 'bot', text: 'Hi there.' }]);
  assert.equal(saved?.role,'voice');assert.equal(saved?.voiceCall?.durationSeconds,59);assert.deepEqual(saved?.voiceCall?.transcript,[{role:'user',text:'Hello'},{role:'bot',text:'Hi there.'}]);
  assert.equal(await store.setVoiceCallFeedback(owner,botId,callId,'good'),true);assert.equal(feedback,'good');
  assert.equal(await store.addVoiceCall({...owner,userId:randomUUID()},botId,59,[]),null);
  await assert.rejects(store.addVoiceCall(owner,botId,-1,[]),/Invalid voice call/);
  await assert.rejects(store.addVoiceCall(owner,botId,59,[{role:'user',text:' '}]),/Invalid voice call/);
});
