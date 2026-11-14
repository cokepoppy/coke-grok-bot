import React, { useEffect, useRef, useState } from 'react';
import { realtimeInputTranscriptText, upsertInputTranscript, type TranscriptLine } from './voice-transcript';

export type VoiceCallData = { durationSeconds: number; transcript: { role: 'user' | 'bot'; text: string }[]; feedback: 'good' | 'bad' | null };

function websocketUrl(botId: string, voice: string, speechRate: number): string {
  const url = new URL(`${import.meta.env.BASE_URL}api/bots/${encodeURIComponent(botId)}/voice/realtime`, window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('voice', voice);
  url.searchParams.set('speech_rate', String(speechRate));
  return url.toString();
}

const voiceOptions = [
  ['longanqian', 'Longan Qian'], ['longanlingxin', 'Longan Lingxin'], ['longanlingxi', 'Longan Lingxi'],
  ['longanxiaoxin', 'Longan Xiaoxin'], ['longanlufeng', 'Longan Lufeng'],
] as const;

function VoiceIcon({ name }: { name: 'gear' | 'transcript' | 'mic' | 'close' | 'return' }) {
  const paths = {
    gear: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z"/></>,
    transcript: <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-3 2v-5a7.5 7.5 0 1 1 16-4.5Z"/><circle cx="9" cy="12" r=".75" fill="currentColor" stroke="none"/><circle cx="12.5" cy="12" r=".75" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r=".75" fill="currentColor" stroke="none"/></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3M9 20h6"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    return: <><path d="m10 7-5 5 5 5M5 12h9a5 5 0 0 1 5 5"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function formatDuration(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function snapshotVoiceCallDuration(startedAt: number | null, now: number, savedDuration: number | null): number {
  if (startedAt === null) return 0;
  return savedDuration ?? Math.max(0, Math.floor((now - startedAt) / 1000));
}

function ThumbIcon({ down = false }: { down?: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={down ? 'M7 10v10M4 10h3l3 8a2 2 0 0 0 2 1h4a2 2 0 0 0 2-2v-3h2a2 2 0 0 0 2-2l-1-6a2 2 0 0 0-2-2h-8l-2 6H4z' : 'M7 14V4M4 14h3l3-8a2 2 0 0 1 2-1h4a2 2 0 0 1 2 2v3h2a2 2 0 0 1 2 2l-1 6a2 2 0 0 1-2 2h-8l-2-6H4z'} /></svg>;
}

export function VoiceCallCard({ botName, messageId, call, onFeedback }: { botName:string;messageId:string;call:VoiceCallData;onFeedback:(callId:string,value:'good'|'bad')=>Promise<void> }) {
  const [expanded,setExpanded]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  async function saveFeedback(value:'good'|'bad') {
    if(saving)return;
    setSaving(true);setError('');
    try{await onFeedback(messageId,value)}catch{setError('Feedback could not be saved. Try again.')}finally{setSaving(false)}
  }
  return <div className="voice-call-card" role="group" aria-label={`Voice chat with ${botName}`}>
    <div className="voice-call-summary-row">
      <button type="button" className="voice-call-summary" aria-expanded={expanded} aria-label={`${expanded?'Hide':'Open'} transcript for Voice chat, ${formatDuration(call.durationSeconds)}`} onClick={()=>setExpanded(value=>!value)}>
        <span className="voice-call-wave" aria-hidden="true">{Array.from({length:7},(_,index)=><i key={index} style={{height:`${8+(index*7)%13}px`}} />)}</span>
        <span className="voice-call-summary-title">Voice chat · {formatDuration(call.durationSeconds)}</span>
      </button>
      <div className="voice-call-feedback" role="group" aria-label="Call feedback">
        <span className="sr-only">{call.feedback?'Thanks for the feedback':'Rate this call'}</span>
        <button type="button" className={call.feedback==='good'?'selected':''} aria-label="Good" aria-pressed={call.feedback==='good'} title="Good" disabled={saving} onClick={()=>void saveFeedback('good')}><ThumbIcon /></button>
        <button type="button" className={call.feedback==='bad'?'selected':''} aria-label="Bad" aria-pressed={call.feedback==='bad'} title="Bad" disabled={saving} onClick={()=>void saveFeedback('bad')}><ThumbIcon down /></button>
      </div>
    </div>
    {expanded&&<section className="voice-call-transcript" aria-label="Voice chat transcript">
      {call.transcript.length?call.transcript.map((line,index)=><p key={`${index}:${line.role}`} className={line.role}><small>{line.role==='user'?'You':botName}</small>{line.text}</p>):<span className="voice-chat-empty-transcript">No transcript was captured for this call.</span>}
    </section>}
    {error&&<p className="voice-call-feedback-error" role="alert">{error}</p>}
  </div>;
}

function pcm16ToBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, clipped < 0 ? clipped * 32768 : clipped * 32767, true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return btoa(binary);
}

export function VoiceChatOverlay({ botId, botName, isActiveBot, onReturnToBot, onClose, onSaved }: { botId: string; botName: string; isActiveBot: boolean; onReturnToBot: () => void; onClose: () => void; onSaved?: () => void }) {
  const [status, setStatus] = useState<'connecting' | 'listening' | 'speaking' | 'ended' | 'error'>('connecting');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [voice, setVoice] = useState('longanqian');
  const [speechRate, setSpeechRate] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const inputTranscriptActive = useRef(false);
  const socket = useRef<WebSocket | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const processor = useRef<ScriptProcessorNode | null>(null);
  const sources = useRef(new Set<AudioBufferSourceNode>());
  const playbackCursor = useRef(0);
  const ready = useRef(false);
  const mutedRef = useRef(false);
  const pendingSamples = useRef<number[]>([]);
  const botResponseActive = useRef(false);
  const stopCall = useRef<() => void>(() => {});
  const callStartedAt = useRef<number | null>(null);
  const endedDurationSeconds = useRef<number | null>(null);
  const endCallRequested = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: number | undefined;
    let reconnectCount = 0;
    const fail = (message: string) => { if (!cancelled) { stopCall.current(); setError(message); setStatus('error'); } };
    const reconnect = () => {
      if (cancelled || endCallRequested.current || reconnectTimer !== undefined) return;
      if (reconnectCount >= 4) { fail('Voice chat disconnected. Check the network and try again.'); return; }
      const delay = [1_000, 2_000, 4_000, 8_000][reconnectCount++];
      stopCall.current();
      setError('Connection interrupted. Reconnecting…');
      setStatus('connecting');
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        if (!cancelled && !endCallRequested.current) setConnectionAttempt(value => value + 1);
      }, delay);
    };
    const setLines = (lines: TranscriptLine[]) => {
      let next = lines.filter(line => line.text.trim()).slice(-50).map(line => ({ ...line, text: line.text.slice(0, 10_000) }));
      let chars = next.reduce((sum, line) => sum + line.text.length, 0);
      while (chars > 40_000 && next.length) {
        chars -= next[0].text.length;
        next = next.slice(1);
      }
      transcriptRef.current = next;
      setTranscript(next);
    };
    const addLine = (role: TranscriptLine['role'], text: string) => {
      if (!text) return;
      setLines([...transcriptRef.current, { role, text }]);
    };
    const start = async () => {
      endCallRequested.current = false;
      setStatus('connecting'); setError('');
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined' || typeof WebSocket === 'undefined') {
        fail('Voice chat needs microphone access and a modern browser.'); return;
      }
      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (cancelled || endCallRequested.current) { media.getTracks().forEach(track => track.stop()); return; }
        stream.current = media;
        const audioContext = new AudioContext();
        context.current = audioContext;
        await audioContext.resume();
        if (cancelled || endCallRequested.current) {
          media.getTracks().forEach(track => track.stop()); stream.current = null; context.current = null; await audioContext.close(); return;
        }
        const ws = new WebSocket(websocketUrl(botId, voice, speechRate));
        socket.current = ws;
        const stop = () => {
          ready.current = false;
          processor.current?.disconnect(); processor.current = null;
          for (const source of sources.current) { try { source.stop(); } catch { /* Already stopped. */ } }
          sources.current.clear();
          if (socket.current === ws) socket.current = null;
          if (ws.readyState < WebSocket.CLOSING) ws.close(1000, 'Call ended');
          if (stream.current === media) {
            media.getTracks().forEach(track => track.stop());
            stream.current = null;
          }
          const activeContext = context.current;
          context.current = null;
          void activeContext?.close();
        };
        stopCall.current = stop;
        ws.onopen = () => { /* The server sends the model session configuration. */ };
        ws.onerror = () => reconnect();
        ws.onclose = event => { if (!cancelled && event.code !== 1000) reconnect(); };
        ws.onmessage = event => {
          if (typeof event.data !== 'string') return;
          let message: Record<string, unknown>;
          try { message = JSON.parse(event.data) as Record<string, unknown>; } catch { return; }
          const type = message.type;
          if (type === 'session.updated') {
            ready.current = true;
            reconnectCount = 0;
            inputTranscriptActive.current = false;
            setError('');
            if (callStartedAt.current === null) callStartedAt.current = Date.now();
            setStatus('listening');
            const source = audioContext.createMediaStreamSource(media);
            const node = audioContext.createScriptProcessor(4096, 1, 1);
            const silent = audioContext.createGain(); silent.gain.value = 0;
            processor.current = node;
            node.onaudioprocess = inputEvent => {
              if (!ready.current || mutedRef.current || ws.readyState !== WebSocket.OPEN) return;
              const input = inputEvent.inputBuffer.getChannelData(0);
              const ratio = audioContext.sampleRate / 16_000;
              const count = Math.floor(input.length / ratio);
              for (let i = 0; i < count; i++) {
                const at = i * ratio, left = Math.floor(at), fraction = at - left;
                const right = Math.min(input.length - 1, left + 1);
                pendingSamples.current.push(input[left] * (1 - fraction) + input[right] * fraction);
              }
              while (pendingSamples.current.length >= 1600) {
                const chunk = pendingSamples.current.splice(0, 1600);
                ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: pcm16ToBase64(Float32Array.from(chunk)) }));
              }
            };
            source.connect(node); node.connect(silent); silent.connect(audioContext.destination);
          } else if (type === 'input_audio_buffer.speech_started') {
            inputTranscriptActive.current = false;
            botResponseActive.current = false;
            for (const source of sources.current) { try { source.stop(); } catch { /* Already stopped. */ } }
            sources.current.clear(); playbackCursor.current = audioContext.currentTime;
            setStatus('listening');
          } else if (type === 'conversation.item.input_audio_transcription.delta') {
            const text = realtimeInputTranscriptText(message.text, message.stash);
            if (text.trim()) {
              setLines(upsertInputTranscript(transcriptRef.current, text, inputTranscriptActive.current));
              inputTranscriptActive.current = true;
            }
          } else if (type === 'conversation.item.input_audio_transcription.completed' && typeof message.transcript === 'string') {
            setLines(upsertInputTranscript(transcriptRef.current, message.transcript, inputTranscriptActive.current));
            inputTranscriptActive.current = false;
          } else if (type === 'response.audio_transcript.delta' && typeof message.delta === 'string') {
            const delta = message.delta.slice(0, 10_000);
            const lines = transcriptRef.current;
            const last = lines.at(-1);
            if (botResponseActive.current && last?.role === 'bot') setLines([...lines.slice(0, -1), { role: 'bot', text: `${last.text}${delta}` }]);
            else { botResponseActive.current = true; addLine('bot', delta); }
          } else if (type === 'response.audio_transcript.done') {
            botResponseActive.current = false;
          } else if (type === 'response.audio.delta' && typeof message.delta === 'string') {
            try {
              const raw = atob(message.delta);
              const samples = new Float32Array(Math.floor(raw.length / 2));
              const view = new DataView(Uint8Array.from(raw, character => character.charCodeAt(0)).buffer);
              for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
              const audio = audioContext.createBuffer(1, samples.length, 24_000);
              audio.copyToChannel(samples, 0);
              const source = audioContext.createBufferSource(); source.buffer = audio; source.connect(audioContext.destination);
              source.onended = () => sources.current.delete(source);
              const when = Math.max(audioContext.currentTime, playbackCursor.current);
              source.start(when); playbackCursor.current = when + audio.duration;
              sources.current.add(source); setStatus('speaking');
            } catch { /* Ignore malformed audio deltas; the provider reports the session error separately. */ }
          } else if (type === 'response.done') {
            botResponseActive.current = false;
            setStatus('listening');
          } else if (type === 'error') {
            fail('The voice model could not continue this call.');
          }
        };
      } catch (cause) {
        if (!cancelled) {
          const name = cause instanceof DOMException ? cause.name : '';
          fail(name === 'NotAllowedError' ? 'Allow microphone access in your browser, then try again.' : name === 'NotFoundError' ? 'No microphone was found.' : 'Voice chat could not start.');
        }
      }
    };
    void start();
    return () => {
      cancelled = true; ready.current = false;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      stopCall.current();
      stopCall.current = () => {};
    };
  }, [botId, voice, speechRate, connectionAttempt]);

  useEffect(() => {
    if (callStartedAt.current === null || status === 'ended') return;
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - callStartedAt.current!) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [status]);

  function toggleMute() { mutedRef.current = !mutedRef.current; setMuted(mutedRef.current); }
  function retryConnection() { setConnectionAttempt(value => value + 1); }

  async function hangUp() {
    if (saving) return;
    endCallRequested.current = true;
    stopCall.current();
    const durationSeconds = snapshotVoiceCallDuration(callStartedAt.current, Date.now(), endedDurationSeconds.current);
    if (callStartedAt.current !== null) {
      endedDurationSeconds.current = durationSeconds;
      setElapsed(durationSeconds);
    }
    setStatus('ended');
    const messages = transcriptRef.current.map(line => ({ role: line.role === 'you' ? 'user' as const : 'bot' as const, text: line.text }));
    if (callStartedAt.current === null) { onClose(); return; }
    setSaving(true); setSaveError('');
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}api/bots/${encodeURIComponent(botId)}/voice/transcript`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ durationSeconds, messages }),
      });
      if (!response.ok) throw new Error('Transcript save failed');
      onSaved?.();
      onClose();
    } catch {
      setSaving(false);
      setSaveError('The call ended, but its transcript could not be saved. Retry while this call card stays open, or close without saving.');
    }
  }

  const label = status === 'connecting' ? 'Connecting' : status === 'listening' ? 'Listening' : status === 'speaking' ? 'Speaking' : status === 'ended' ? `Voice chat · ${formatDuration(elapsed)}` : 'Connection issue';
  return <div className="voice-chat-float" role="region" aria-label={`Voice chat with ${botName}`}>
    <section className={`voice-chat-pill ${status}`}>
      <span className={`voice-chat-presence ${status}`} aria-hidden="true" />
      <span className={`voice-chat-label${status === 'error' ? '' : ' sr-only'}`} role="status">{isActiveBot || status === 'ended' ? status === 'connecting' && error ? error : label : `${botName} · Voice chat in progress`}</span>
      <span className={`voice-chat-wave ${status}`} aria-hidden="true">{Array.from({ length: 14 }, (_, index) => <i key={index} style={{ animationDelay: `${(index % 7) * 65}ms` }} />)}</span>
      <div className="voice-chat-controls">
        {!isActiveBot && <button type="button" className="voice-chat-control voice-chat-return" aria-label={`Return to voice chat with ${botName}`} title={`Return to ${botName}`} onClick={onReturnToBot}><VoiceIcon name="return" /></button>}
        {status !== 'ended' && <><button type="button" className={`voice-chat-control ${settingsOpen ? 'active' : ''}`} aria-label="Voice chat settings" title="Settings" aria-expanded={settingsOpen} disabled={status === 'error'} onClick={()=>{setSettingsOpen(value=>!value);setTranscriptOpen(false)}}><VoiceIcon name="gear" /></button>
        <button type="button" className={`voice-chat-control ${transcriptOpen ? 'active' : ''}`} aria-label="Show transcript" title="Transcript" aria-pressed={transcriptOpen} onClick={()=>{setTranscriptOpen(value=>!value);setSettingsOpen(false)}}><VoiceIcon name="transcript" /></button>
        <button type="button" className={`voice-chat-control voice-chat-mic ${muted ? 'muted' : ''}`} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} title={muted ? 'Unmute' : 'Mute'} disabled={status === 'error'||saving} aria-pressed={muted} onClick={toggleMute}><VoiceIcon name="mic" /></button>
        <button type="button" className="voice-chat-control voice-chat-hangup" aria-label="Hang up" title="Hang up" disabled={saving} onClick={()=>void hangUp()}><VoiceIcon name="close" /></button></>}
        {status === 'ended' && <><button type="button" className={`voice-chat-control ${transcriptOpen ? 'active' : ''}`} aria-label="Show call transcript" title="Transcript" aria-pressed={transcriptOpen} onClick={()=>setTranscriptOpen(value=>!value)}><VoiceIcon name="transcript" /></button>{saveError ? <><button type="button" className="voice-chat-ended-action" onClick={()=>void hangUp()} disabled={saving}>{saving ? 'Saving…' : 'Retry'}</button><button type="button" className="voice-chat-ended-action" onClick={onClose}>Discard</button></> : <button type="button" className="voice-chat-dismiss" aria-label="Close voice chat summary" onClick={onClose}>×</button>}</>}
      </div>
    </section>
    {settingsOpen && status !== 'ended' && status !== 'error' && <section className="voice-chat-popover voice-chat-settings" aria-label="Voice chat settings">
      <label>Voice<select value={voice} disabled={saving} onChange={event=>setVoice(event.currentTarget.value)}>{voiceOptions.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      <label>Speed<select value={speechRate} disabled={saving} onChange={event=>setSpeechRate(Number(event.currentTarget.value))}>{[0.5,0.75,1,1.25,1.5,1.75,2].map(value=><option key={value} value={value}>{value}×</option>)}</select></label>
      <span>Language <strong>Auto-detect</strong></span>
      {status === 'connecting' && <small>Applying voice settings…</small>}
      {error && <p role="alert">{error}<button type="button" onClick={retryConnection}>Retry connection</button></p>}
    </section>}
    {transcriptOpen && <section className="voice-chat-popover voice-chat-transcript-panel" aria-label={status === 'ended' ? 'Voice chat transcript' : 'Live voice chat transcript'} aria-live="polite">
      <header><strong>Transcript</strong><span>{botName}</span></header>
      <div>{transcript.length ? transcript.map((line, index) => <p key={`${index}:${line.role}`} className={line.role}><small>{line.role === 'you' ? 'You' : botName}</small>{line.text}</p>) : <span className="voice-chat-empty-transcript">Your conversation will appear here.</span>}</div>
    </section>}
    {status === 'error' && <section className="voice-chat-popover voice-chat-error-panel" role="alert"><strong>Voice chat couldn’t connect</strong><span>{error}</span><button type="button" onClick={retryConnection}>Try again</button></section>}
    {status === 'ended' && saveError && <section className="voice-chat-popover voice-chat-error-panel" role="alert"><strong>Transcript not saved</strong><span>{saveError}</span></section>}
  </div>;
}
