import { createHash, randomBytes } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const audioEndpointPath = '/api/v1/services/aigc/multimodal-generation/generation';
const speechEndpointPath = '/api/v1/services/audio/tts/SpeechSynthesizer';
const realtimePath = '/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-plus';
const maxAudioBytes = 10 * 1024 * 1024;
const maxSpeechBytes = 20 * 1024 * 1024;
const maxSpeechTextLength = 3_000;
const websocketGuid = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class VoiceGatewayError extends Error {
  constructor(readonly code: 'VOICE_AUDIO_INVALID' | 'VOICE_PROVIDER_UNAVAILABLE' | 'VOICE_PROVIDER_REJECTED', readonly status = 502) {
    super(code);
  }
}

export interface VoiceGatewayApi {
  transcribeWav(audio: Buffer, signal?: AbortSignal): Promise<string>;
  synthesizeSpeech(text: string, signal?: AbortSignal): Promise<Buffer>;
  upgradeRealtime(req: IncomingMessage, client: Duplex, head: Buffer, options?: VoiceRealtimeOptions): Promise<void>;
}

export interface VoiceRealtimeOptions { voice: string; speechRate: number }
const realtimeVoices = new Set(['longanqian', 'longanlingxin', 'longanlingxi', 'longanxiaoxin', 'longanlufeng']);

export function parseVoiceRealtimeOptions(search: URLSearchParams): VoiceRealtimeOptions {
  const allowed = new Set(['voice', 'speech_rate']);
  const keys = [...search.keys()];
  if (keys.some(key => !allowed.has(key)) || new Set(keys).size !== keys.length) throw new VoiceGatewayError('VOICE_AUDIO_INVALID', 400);
  const voice = search.get('voice') || 'longanqian';
  const rawRate = search.get('speech_rate') || '1';
  const speechRate = Number(rawRate);
  if (!realtimeVoices.has(voice) || !Number.isFinite(speechRate) || speechRate < 0.5 || speechRate > 2) throw new VoiceGatewayError('VOICE_AUDIO_INVALID', 400);
  return { voice, speechRate };
}

export function validatePcmWav(audio: Buffer): boolean {
  if (audio.length < 44 || audio.length > maxAudioBytes) return false;
  if (audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') return false;
  const format = audio.readUInt16LE(20);
  const channels = audio.readUInt16LE(22);
  const sampleRate = audio.readUInt32LE(24);
  const byteRate = audio.readUInt32LE(28);
  const blockAlign = audio.readUInt16LE(32);
  const bitsPerSample = audio.readUInt16LE(34);
  const dataMarker = audio.indexOf('data', 36, 'ascii');
  if (format !== 1 || channels !== 1 || sampleRate !== 16_000 || byteRate !== 32_000 || blockAlign !== 2 || bitsPerSample !== 16 || dataMarker < 36) return false;
  const declaredDataBytes = audio.readUInt32LE(dataMarker + 4);
  return declaredDataBytes > 0 && declaredDataBytes <= maxAudioBytes - 44 && dataMarker + 8 + declaredDataBytes <= audio.length && declaredDataBytes / 32_000 <= 300;
}

export function encodeClientWebSocketFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  if (payload.length > 16_384) throw new Error('Voice setup frame too large');
  const mask = randomBytes(4);
  const extendedLength = payload.length > 125 ? 2 : 0;
  const payloadOffset = 2 + extendedLength + 4;
  const frame = Buffer.alloc(payloadOffset + payload.length);
  frame[0] = 0x81;
  frame[1] = 0x80 | (extendedLength ? 126 : payload.length);
  if (extendedLength) frame.writeUInt16BE(payload.length, 2);
  const maskOffset = 2 + extendedLength;
  mask.copy(frame, maskOffset);
  for (let i = 0; i < payload.length; i++) frame[payloadOffset + i] = payload[i] ^ mask[i % 4];
  return frame;
}

export class VoiceGateway implements VoiceGatewayApi {
  private readonly upstream: URL;
  constructor(private readonly apiKey: string, baseUrl: string, private readonly request: typeof fetch = fetch) {
    this.upstream = new URL(baseUrl);
    if (this.upstream.protocol !== 'https:' || this.upstream.hostname !== 'token-plan.cn-beijing.maas.aliyuncs.com' || this.upstream.username || this.upstream.password || this.upstream.search || this.upstream.hash || !this.upstream.pathname.endsWith('/compatible-mode/v1')) throw new Error('Invalid voice model endpoint');
    if (!apiKey || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw new Error('Invalid voice model configuration');
  }

  async transcribeWav(audio: Buffer, signal = AbortSignal.timeout(120_000)): Promise<string> {
    if (!validatePcmWav(audio)) throw new VoiceGatewayError('VOICE_AUDIO_INVALID', 400);
    const data = `data:audio/wav;base64,${audio.toString('base64')}`;
    let response: Response;
    try {
      response = await this.request(`${this.upstream.origin}${audioEndpointPath}`, {
        method: 'POST', redirect: 'error', signal,
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', 'x-dashscope-sse': 'disable' },
        body: JSON.stringify({
          model: 'qwen-audio-3.0-asr-flash',
          input: { messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data } }] }] },
          parameters: { format: 'wav', sample_rate: '16000' },
        }),
      });
    } catch {
      throw new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) throw new VoiceGatewayError('VOICE_PROVIDER_REJECTED', 502);
    let value: unknown;
    try { value = await response.json(); } catch { throw new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE'); }
    const text = value && typeof value === 'object' && 'output' in value && value.output && typeof value.output === 'object' && 'text' in value.output ? value.output.text : null;
    if (typeof text !== 'string' || text.length > 10_000) throw new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE');
    return text.trim();
  }

  async synthesizeSpeech(text: string, signal = AbortSignal.timeout(120_000)): Promise<Buffer> {
    const normalized = text.trim();
    if (!normalized || normalized.length > maxSpeechTextLength) throw new VoiceGatewayError('VOICE_AUDIO_INVALID', 400);
    let response: Response;
    try {
      response = await this.request(`${this.upstream.origin}${speechEndpointPath}`, {
        method: 'POST', redirect: 'error', signal,
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', 'x-dashscope-sse': 'disable' },
        body: JSON.stringify({ model: 'qwen-audio-3.0-tts-plus', input: { text: normalized, voice: 'longanhuan_v3.6', format: 'mp3', sample_rate: 22_050 } }),
      });
    } catch {
      throw new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE');
    }
    if (!response.ok) throw new VoiceGatewayError('VOICE_PROVIDER_REJECTED');
    let value: unknown;
    try { value = await response.json(); } catch { throw new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE'); }
    const rawUrl = value && typeof value === 'object' && 'output' in value && value.output && typeof value.output === 'object' && 'audio' in value.output && value.output.audio && typeof value.output.audio === 'object' && 'url' in value.output.audio ? value.output.audio.url : null;
    if (typeof rawUrl !== 'string' || rawUrl.length > 8192) throw new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE');
    let audioUrl: URL;
    try { audioUrl = new URL(rawUrl); } catch { throw new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE'); }
    if (!['http:', 'https:'].includes(audioUrl.protocol) || audioUrl.hostname !== 'dashscope-result-bj.oss-cn-beijing.aliyuncs.com' || audioUrl.port || audioUrl.username || audioUrl.password || audioUrl.hash || !/^\/(?:pre|prod)\/qwen-audio-3\.0-tts-plus\//.test(audioUrl.pathname)) throw new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE');
    // Token Plan examples return HTTP URLs for this signed object. Upgrade to TLS
    // before fetching and never expose the expiring signed URL to the browser.
    audioUrl.protocol = 'https:';
    let audioResponse: Response;
    try { audioResponse = await this.request(audioUrl, { method: 'GET', redirect: 'error', signal }); }
    catch { throw new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE'); }
    if (!audioResponse.ok) throw new VoiceGatewayError('VOICE_PROVIDER_REJECTED');
    const contentType = (audioResponse.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'audio/mpeg' && contentType !== 'application/octet-stream') throw new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE');
    const contentLength = Number(audioResponse.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxSpeechBytes) throw new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE');
    const reader = audioResponse.body?.getReader();
    if (!reader) throw new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE');
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        total += chunk.byteLength;
        if (total > maxSpeechBytes) {
          await reader.cancel();
          throw new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE');
        }
        chunks.push(Buffer.from(chunk));
      }
    } catch (error) {
      if (error instanceof VoiceGatewayError) throw error;
      throw new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE');
    } finally { reader.releaseLock(); }
    if (!total) throw new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE');
    return Buffer.concat(chunks, total);
  }

  async upgradeRealtime(req: IncomingMessage, client: Duplex, head: Buffer, suppliedOptions?: VoiceRealtimeOptions): Promise<void> {
    let options = suppliedOptions;
    if (!options) {
      let requestUrl: URL;
      try { requestUrl = new URL(req.url || '/', 'http://localhost'); } catch { throw new VoiceGatewayError('VOICE_AUDIO_INVALID', 400); }
      options = parseVoiceRealtimeOptions(requestUrl.searchParams);
    }
    const browserKey = req.headers['sec-websocket-key'];
    if (typeof browserKey !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(browserKey)) throw new VoiceGatewayError('VOICE_AUDIO_INVALID', 400);
    const upstreamKey = randomBytes(16).toString('base64');
    const upstreamRequest = httpsRequest({
      hostname: this.upstream.hostname,
      port: 443,
      path: realtimePath,
      method: 'GET',
      headers: {
        Host: this.upstream.host,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': upstreamKey,
        Authorization: `Bearer ${this.apiKey}`,
      },
      timeout: 12_000,
    });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(new VoiceGatewayError('VOICE_PROVIDER_UNAVAILABLE'));
      };
      upstreamRequest.once('upgrade', (response, upstream, upstreamHead) => {
        const expected = createHash('sha1').update(`${upstreamKey}${websocketGuid}`).digest('base64');
        if (response.statusCode !== 101 || String(response.headers.upgrade || '').toLowerCase() !== 'websocket' || response.headers['sec-websocket-accept'] !== expected) {
          upstream.destroy();
          return fail();
        }
        settled = true;
        const browserAccept = createHash('sha1').update(`${browserKey}${websocketGuid}`).digest('base64');
        client.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${browserAccept}\r\n\r\n`);
        if (upstreamHead.length) client.write(upstreamHead);
        upstream.write(encodeClientWebSocketFrame(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['audio', 'text'],
            voice: options.voice,
            speech_rate: options.speechRate,
            instructions: 'You are a helpful Grok Bot voice teammate. Keep answers concise and natural. Reply in the language the user speaks. Do not claim to perform actions outside this voice conversation.',
            input_audio_format: 'pcm',
            output_audio_format: 'pcm',
            turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 600 },
          },
        })));
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
        client.once('close', () => upstream.destroy());
        upstream.once('close', () => { if (!client.destroyed) client.destroy(); });
        resolve();
      });
      upstreamRequest.once('response', fail);
      upstreamRequest.once('timeout', () => upstreamRequest.destroy(new Error('Voice connection timed out')));
      upstreamRequest.once('error', fail);
      client.once('close', () => upstreamRequest.destroy());
      upstreamRequest.end();
    });
  }
}
