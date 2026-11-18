import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { avatarPaths } from './avatar-paths';
import { computerScreenRetryDelay } from './computer-screen-polling';
import { WebsiteDemoApp } from './website-demo';
import { VoiceCallCard, VoiceChatOverlay, type VoiceCallData } from './voice-chat';
import { formatChatTimestamp, shouldShowChatTimestamp } from './chat-timestamps';
import {findGroupMentionQuery,groupMentionRecipientBotIds,groupRecipientBotIds,rebaseGroupMentionTokens,type GroupMentionQuery,type GroupMentionToken} from './group-mentions';
import './shell.css';

type Shape = 'cloud' | 'drop' | 'hex' | 'round' | 'triangle' | 'oval' | 'square' | 'pill' | 'spark' | 'heart' | 'flower' | 'pentagon' | 'star';
type Bot = { id: string; name: string; label: string; color: string; shape: Shape; group: string; preview: string; lastActivityAt?: string | null; pinned?: boolean; hidden?: boolean };
type Message = { id: string; role: 'user' | 'bot' | 'system' | 'voice'; text: string; createdAt?: string | null; voiceCall?:VoiceCallData };
type RunFile = { id: string; name: string; mimeType: string; size: number; sha256: string; kind: 'input' | 'output' };
type BotLibraryCategory = 'All'|'Pages'|'Media'|'Links'|'Files'|'Apps'|'Pinned';
type BotLibraryItem = RunFile & {kind:'output';createdAt:string;pinned:boolean};
type ExecutionAudit = {engine:'pi'|'dsh';model:string;modelCompleted:boolean;calls:{tool:string;action:string|null;outcome:'succeeded'|'failed'|'unconfirmed'}[];truncated:boolean};
type RunTraceEntry = {sequence:number;source?:'database'|'memory';component:'control-plane'|'scheduler'|'agent-runtime'|'model-gateway'|'computer-worker'|'mysql';event:string;outcome:'started'|'succeeded'|'failed'|'info';attemptNumber:number|null;httpStatus:number|null;upstreamHttpStatus:number|null;upstreamErrorKind:string|null;upstreamErrorCode:string|null;retryAfterSeconds:number|null;requestBytes:number|null;requestLimitBytes:number|null;adapterExitCode:number|null;adapterExitSignal:string|null;databaseCode:string|null;relatedComponent?:RunTraceEntry['component']|null;relatedEvent?:string|null;diagnosticCode:string|null;reasonCode:string|null;durationMs:number|null;releaseId:string|null;stage:string|null;operation:string|null;transportCode:string|null;at:string};
type AgentRun = { id: string; prompt: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'unknown'; result: string | null; recoveryState: 'none' | 'pending' | 'retried' | 'acknowledged' | 'auto_resumed'; replacementRunId: string | null; files: RunFile[]; computerUsed?: boolean; executionAudit?:ExecutionAudit|null; createdAt?:string|null; updatedAt?: string | null; diagnosticCode?: string | null; failureTraceDiagnosticCode?:string|null; failureComponent?:string|null; failureReasonCode?:string|null; failureStage?:string|null;failureHttpStatus?:number|null;failureUpstreamHttpStatus?:number|null;failureUpstreamErrorKind?:string|null;failureUpstreamErrorCode?:string|null;failureAdapterExitCode?:number|null;failureAdapterExitSignal?:string|null;failureDatabaseCode?:string|null;failureTransportCode?:string|null;failureOperation?:string|null;failureAttemptNumber?:number|null;failureDurationMs?:number|null;failureRequestBytes?:number|null;failureRequestLimitBytes?:number|null };
type GroupMember = Pick<Bot,'id'|'name'|'label'|'color'|'shape'> & { position: number };
type BotMentionCandidate = {kind:'bot';id:string;bot:GroupMember|Bot}|{kind:'everyone';id:'everyone'};
type GroupChat = { id: string; name: string; members: GroupMember[]; preview: string; lastActivityAt: string | null };
type GroupReplacementRun = { id:string; status:AgentRun['status']; result:string|null; computerUsed:boolean; executionAudit?:ExecutionAudit|null; updatedAt:string|null; diagnosticCode?:string|null; failureTraceDiagnosticCode?:string|null; failureComponent?:string|null;failureReasonCode?:string|null;failureStage?:string|null;failureHttpStatus?:number|null;failureUpstreamHttpStatus?:number|null;failureUpstreamErrorKind?:string|null;failureUpstreamErrorCode?:string|null;failureAdapterExitCode?:number|null;failureAdapterExitSignal?:string|null;failureDatabaseCode?:string|null;failureTransportCode?:string|null;failureOperation?:string|null;failureAttemptNumber?:number|null;failureDurationMs?:number|null;failureRequestBytes?:number|null;failureRequestLimitBytes?:number|null;files:RunFile[] };
type GroupMessage = { id:string;turnId:string;role:'user'|'bot';botId:string|null;botName:string|null;text:string|null;createdAt:string;runId:string|null;status:AgentRun['status']|null;recoveryState:AgentRun['recoveryState']|null;replacementRunId:string|null;replacementRun:GroupReplacementRun|null;computerUsed:boolean;executionAudit?:ExecutionAudit|null;updatedAt:string|null;diagnosticCode?:string|null;failureTraceDiagnosticCode?:string|null;failureComponent?:string|null;failureReasonCode?:string|null;failureStage?:string|null;failureHttpStatus?:number|null;failureUpstreamHttpStatus?:number|null;failureUpstreamErrorKind?:string|null;failureUpstreamErrorCode?:string|null;failureAdapterExitCode?:number|null;failureAdapterExitSignal?:string|null;failureDatabaseCode?:string|null;failureTransportCode?:string|null;failureOperation?:string|null;failureAttemptNumber?:number|null;failureDurationMs?:number|null;failureRequestBytes?:number|null;failureRequestLimitBytes?:number|null;targetBotIds?:string[];files?:RunFile[] };
type GroupChatView = { group: GroupChat; messages: GroupMessage[] };
type Routine = { id:string; name:string; instruction:string; schedule:{kind:'weekly';weekday:number;hour:number;minute:number}|{kind:'interval';minutes:number}|{kind:'webhook'}; timezone:string; paused:boolean; when:string; nextRunAt:string|null; runs:{id:string;status:string;scheduledFor:string;result:string|null}[] };
type RoutineWebhook = {endpointPath:string;key:string;authorizationHeader:string};
type PrivateSkill = {id:string;creatorBotId:string|null;name:string;description:string;instructions:string;visibility:'private'|'bot';enabled:boolean;published:boolean;publishedTenantIds:string[];outOfSyncTenantIds:string[];isOwner:boolean;sharedBy:string|null;outOfSync:boolean;createdAt:string;updatedAt:string};
type SkillPublishTarget = {tenantId:string;name:string;memberCount:number};
type PreviewState = { bots: Bot[]; activeId: string; messages: Record<string, Message[]>; showOnboarding: Record<string, boolean> };
type IconName = 'search' | 'plus' | 'mic' | 'sound' | 'close' | 'panel' | 'share' | 'screen' | 'arrow' | 'smile' | 'reply' | 'more' | 'gear' | 'back' | 'clock';
const avatarShapes:Shape[]=['round','oval','square','pill','triangle','hex','cloud','drop'];
const avatarColors=['#000000','#a27952','#ff3e51','#ff781c','#ffaf38','#00c972','#1cc3b0','#2a92fe','#a97efe','#ff5eb1','#959595'];
const createShapes:Shape[]=['round','oval','square','spark','cloud','heart','flower','drop','pill','triangle','pentagon','star','hex'];
const createColors=['#000000','#a06b39','#fb2b3e','#fd690f','#f59312','#14c16f','#13b7a2','#1e86fc','#8f59f9','#f93498','#959595'];

const STORAGE_KEY = 'coke-grok-bot:desktop-preview:v1';
const PRODUCT_SIDEBAR_MIN = 84;
function productPanelMin(): number { return Math.max(240, Math.min(400, Math.floor((window.innerWidth - 16) * 0.27))); }
function productSidebarMax(): number { return Math.max(PRODUCT_SIDEBAR_MIN, Math.min(560, Math.floor(window.innerWidth * 0.4))); }
function clampProductSidebarWidth(width: number): number { return Math.min(productSidebarMax(), Math.max(PRODUCT_SIDEBAR_MIN, Math.round(width))); }
function initialProductSidebarWidth(preferenceKey: string): number {
  try {
    const raw = preferenceKey ? localStorage.getItem(preferenceKey) : null;
    const stored = raw === null ? NaN : Number(raw);
    if (Number.isFinite(stored)) return clampProductSidebarWidth(stored);
  } catch { /* Use the reference width if storage is unavailable. */ }
  return clampProductSidebarWidth(Math.max(280, Math.round(window.innerWidth * 0.28)));
}
function productPanelMax(sidebarWidth: number): number { return Math.max(productPanelMin(), Math.min(920, Math.floor(window.innerWidth - sidebarWidth - 420))); }
function clampProductPanelWidth(width: number, sidebarWidth: number): number { return Math.min(productPanelMax(sidebarWidth), Math.max(productPanelMin(), Math.round(width))); }
function initialProductPanelWidth(preferenceKey: string, sidebarWidth: number, legacyPreferenceKey: string): number {
  try {
    const raw = preferenceKey ? localStorage.getItem(preferenceKey) : null;
    const stored = raw === null ? NaN : Number(raw);
    if (Number.isFinite(stored)) return clampProductPanelWidth(stored, sidebarWidth);
    const legacyRaw = legacyPreferenceKey ? localStorage.getItem(legacyPreferenceKey) : null;
    const legacyStored = legacyRaw === null ? NaN : Number(legacyRaw);
    // 320px was the old default minimum. Keep larger user-sized panels, but
    // let the new responsive reference width replace that old default.
    if (Number.isFinite(legacyStored) && legacyStored > 320) return clampProductPanelWidth(legacyStored, sidebarWidth);
  } catch { /* Use the reference width if storage is unavailable. */ }
  return clampProductPanelWidth(Math.max(productPanelMin(), Math.min(440, Math.round((window.innerWidth - 16) * 0.27))), sidebarWidth);
}
const attachmentCountLimit = 20;
const attachmentImageLimit = 25 * 1024 * 1024;
const attachmentImagesTotalLimit = 200 * 1024 * 1024;
const attachmentDocumentLimit = 250 * 1024 * 1024;
const attachmentVideoLimit = 1024 * 1024 * 1024;
async function audioBlobToPcmWav16k(blob: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (!decoded.length || decoded.duration > 300) throw new Error('Audio must be five minutes or shorter.');
    const sampleCount = Math.ceil(decoded.duration * 16_000);
    const bytes = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(bytes);
    const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    write(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    write(36, 'data'); view.setUint32(40, sampleCount * 2, true);
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    for (let i = 0; i < sampleCount; i++) {
      const sourceIndex = i * decoded.sampleRate / 16_000;
      const left = Math.min(decoded.length - 1, Math.floor(sourceIndex));
      const right = Math.min(decoded.length - 1, left + 1);
      const fraction = sourceIndex - left;
      let sample = 0;
      for (const channel of channels) sample += channel[left] * (1 - fraction) + channel[right] * fraction;
      sample /= channels.length;
      const clipped = Math.max(-1, Math.min(1, sample));
      view.setInt16(44 + i * 2, clipped < 0 ? clipped * 32768 : clipped * 32767, true);
    }
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Recording exceeds the 10 MB limit.');
    return new Blob([bytes], { type: 'audio/wav' });
  } finally { await context.close(); }
}
const previewVideoTypes = new Set(['video/mp4','video/webm','video/quicktime']);
const previewAudioTypes = new Set(['audio/mpeg','audio/wav','audio/mp4','audio/ogg','audio/webm','audio/aac']);
const previewImageTypes = new Set(['image/png','image/jpeg','image/webp','image/gif','image/avif']);
const primary: Bot = { id: 'bobo', name: 'bobo', label: 'life stabilizer', color: '#4c8ff4', shape: 'cloud', group: '', preview: '' };
const initialBots: Bot[] = [
  { id: 'new', name: 'New Bot', label: '', color: '#a382ef', shape: 'drop', group: 'Unassigned', preview: 'What do you want me helping ...' },
  { id: 'support', name: 'Sample support bot', label: '', color: '#a48a6d', shape: 'triangle', group: 'Unassigned', preview: 'Want me to hand this to Elon f...' },
  { id: 'maya', name: 'maya', label: 'community', color: '#f7b447', shape: 'hex', group: 'Unassigned', preview: 'What do you mainly want me f...' },
  { id: 'penny', name: 'penny', label: 'sourcing', color: '#5ac0ae', shape: 'round', group: 'Unassigned', preview: 'What do you mainly want me f...' },
  { id: 'dex', name: 'dex', label: 'designer', color: '#e95568', shape: 'hex', group: 'Unassigned', preview: 'What should I focus on first?' },
  { id: 'grok', name: 'Grok Bot', label: '', color: '#080808', shape: 'round', group: 'Unassigned', preview: 'Sent 1 text file' },
  { id: 'teal', name: 'New Bot', label: '', color: '#62c9b7', shape: 'drop', group: 'Unassigned', preview: 'Want me to lock any as print-r...' },
  { id: 'pink', name: 'New Bot', label: '', color: '#e96aa7', shape: 'round', group: 'Unassigned', preview: 'The sticker file is open on my ...' },
];

function initialState(reference: boolean): PreviewState {
  if (reference) return {
    bots: initialBots.map(bot => ({ ...bot })), activeId: 'new',
    messages: { new: [{ id: 'welcome', role: 'bot', text: 'Hey Martin — good to meet you. What do you want me helping with most right now?', createdAt: new Date().toISOString() }] },
    showOnboarding: { new: true },
  };
  const starter = { ...initialBots[0], id: 'starter', name: 'New Bot', preview: 'Ready for a conversation' };
  return { bots: [starter], activeId: starter.id, messages: {}, showOnboarding: {} };
}

function safeStoredState(storageKey: string): PreviewState | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw || raw.length > 1_000_000) return null;
    const value = JSON.parse(raw) as PreviewState;
    if (!Array.isArray(value.bots) || !value.bots.length || typeof value.activeId !== 'string' || !value.messages || !value.showOnboarding) return null;
    if (!value.bots.every(bot => typeof bot.id === 'string' && typeof bot.name === 'string' && typeof bot.color === 'string' && typeof bot.preview === 'string')) return null;
    return value;
  } catch { return null; }
}

function Icon({ name }: { name: IconName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<IconName, React.ReactNode> = {
    search: <><circle cx="10.5" cy="10.5" r="6.3" /><path d="m15.5 15.5 4.2 4.2" /></>,
    plus: <><path d="M12 4v16M4 12h16" /></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v3M9 20h6" /></>,
    sound: <><path d="M4 10v4M7 8v8M10 5v14M13 8v8M16 6v12M19 9v6" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>,
    share: <><path d="M12 15V3M8 7l4-4 4 4M5 12v7h14v-7" /></>,
    screen: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M12 17v3M8 20h8" /></>,
    arrow: <><path d="M12 19V5M6 11l6-6 6 6" /></>,
    smile: <><circle cx="12" cy="12" r="8" /><path d="M8.5 14.5c1.8 2 5.2 2 7 0M9 9.5h.01M15 9.5h.01" /></>,
    reply: <><path d="M8 8 4 12l4 4M4 12h10c3 0 5 2 5 5" /></>,
    more: <><circle cx="5" cy="12" r=".8" fill="currentColor" /><circle cx="12" cy="12" r=".8" fill="currentColor" /><circle cx="19" cy="12" r=".8" fill="currentColor" /></>,
    gear: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>{paths[name]}</svg>;
}

function Avatar({ bot, size = 44 }: { bot: Pick<Bot, 'color' | 'shape'>; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 54 54" className="avatar" aria-hidden="true">
    <path fill={bot.color} d={avatarPaths[bot.shape] || avatarPaths.round} />
    {bot.shape==='star' && size>=100
      ? <g fill="#fff"><rect x="20" y="30" width="5" height="10" rx="2.5" /><rect x="32" y="30" width="5" height="10" rx="2.5" /></g>
      : <g fill="#fff" transform="rotate(-24 33 21)"><rect x="25" y="16" width="4" height="10" rx="2" /><rect x="37" y="16" width="4" height="10" rx="2" /></g>}
  </svg>;
}

function GroupAvatar({members,size=44}:{members:Pick<Bot,'id'|'color'|'shape'>[];size?:number}){
  const shown=members.slice(0,3),small=size*.59,offset=size*.29;
  return <span className="group-avatar" aria-hidden="true" style={{width:size,height:size}}>{shown.map((bot,index)=><span key={bot.id} style={{left:index===0?0:index===1?offset:offset/2,top:index===0?0:index===1?offset:offset/2,zIndex:index+1}}><Avatar bot={bot} size={small}/></span>)}</span>;
}

function formatBotTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const today = new Date();
  if (date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()) {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate()) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date);
}

function runPreview(run: AgentRun): string {
  if (run.status === 'running') return 'Working…';
  if (run.status === 'queued') return 'Queued';
  if (run.status === 'unknown' && runFailureHeadline(run)) return runFailureHeadline(run)!;
  if (run.status === 'unknown') return 'Outcome unknown';
  return (run.result || (run.status === 'completed' ? 'Done.' : 'Failed')).replace(/\s+/g, ' ').trim().slice(0, 180);
}

type BotTimelineEntry =
  | { key:string;at:number;priority:number;order:number;kind:'message';message:Message }
  | { key:string;at:number;priority:number;order:number;kind:'run-prompt'|'computer'|'run-result';run:AgentRun };
function timelineTime(value?:string|null):number {
  if(!value)return 0;
  const timestamp=Date.parse(value);
  return Number.isFinite(timestamp)?timestamp:0;
}
function buildBotTimeline(messages:Message[],runs:AgentRun[],latestSubmittedItemId?:string):BotTimelineEntry[] {
  const entries:BotTimelineEntry[]=[];
  messages.forEach((message,index)=>entries.push({key:`message:${message.id}`,at:timelineTime(message.createdAt),priority:1,order:index,kind:'message',message}));
  runs.forEach((run,index)=>{
    const createdAt=timelineTime(run.createdAt)||timelineTime(run.updatedAt),updatedAt=timelineTime(run.updatedAt)||createdAt;
    const outputFiles=(run.files||[]).filter(file=>file.kind==='output');
    const genericDone=Boolean(run.computerUsed&&/^(done|done\.)$/i.test(run.result?.trim()||''));
    const showRecovery=run.status==='unknown'&&run.recoveryState==='pending';
    const showRetryNote=run.status==='unknown'&&run.recoveryState==='retried'&&Boolean(run.replacementRunId);
    const showFollowup=!run.computerUsed||Boolean((run.result&&!genericDone)||outputFiles.length||showRecovery||showRetryNote||run.status==='unknown');
    if(run.computerUsed)entries.push({key:`computer:${run.id}`,at:createdAt,priority:1,order:index,kind:'computer',run});
    else entries.push({key:`prompt:${run.id}`,at:createdAt,priority:0,order:index,kind:'run-prompt',run});
    if(showFollowup)entries.push({key:`result:${run.id}`,at:updatedAt,priority:2,order:index,kind:'run-result',run});
  });
  return entries.sort((a,b)=>{
    const aLatest=(a.kind==='message'?a.message.id:a.run.id)===latestSubmittedItemId;
    const bLatest=(b.kind==='message'?b.message.id:b.run.id)===latestSubmittedItemId;
    if(aLatest!==bLatest)return aLatest?1:-1;
    if(aLatest&&bLatest)return a.priority-b.priority||a.order-b.order;
    return a.at-b.at||a.priority-b.priority||a.order-b.order;
  });
}

function groupRunStatusLabel(message: GroupMessage): string {
  if (message.status === 'unknown' && runFailureHeadline(message)) return 'Failed · diagnosis shown below';
  if (message.status === 'unknown' && message.recoveryState === 'auto_resumed') return 'Outcome unknown · not retried';
  if (message.status === 'unknown' && message.recoveryState === 'acknowledged') return 'Reviewed · outcome unknown';
  if (message.status === 'unknown' && message.recoveryState === 'retried') {
    if (message.replacementRun?.status === 'completed') return 'Original outcome unknown · retry completed';
    if (message.replacementRun?.status === 'failed') return 'Original outcome unknown · retry failed';
    if (message.replacementRun?.status === 'running') return 'Original outcome unknown · retry working';
    if (message.replacementRun?.status === 'unknown') return 'Original outcome unknown · retry needs review';
    return 'Retry queued · outcome unknown';
  }
  if (message.status === 'completed') return 'Done';
  if (message.status === 'running') return 'Working';
  if (message.status === 'failed') return 'Failed';
  if (message.status === 'unknown') return 'Outcome unknown';
  return 'Queued';
}

function groupRunFallback(message: GroupMessage): string {
  if (message.status === 'queued') return 'Waiting for this Bot’s computer…';
  if (message.status === 'running') return 'Working on this Bot’s computer…';
  if (message.status === 'unknown' && message.recoveryState === 'auto_resumed') return 'The result could not be confirmed. The original task was not replayed, and the queue can continue.';
  if (message.status === 'unknown' && message.recoveryState === 'pending') return 'The result could not be confirmed. The task was not replayed.';
  if (message.status === 'unknown' && message.recoveryState === 'acknowledged') return 'You checked this Bot’s computer. The task result remains unknown; the queue has resumed.';
  if (message.status === 'unknown' && message.recoveryState === 'retried') return 'The original task outcome remains unknown. The separate retry is shown below.';
  if (message.status === 'unknown') return 'The task outcome could not be confirmed.';
  return 'This Bot did not return a response.';
}

function replacementRunLabel(status:AgentRun['status']):string {
  return ({queued:'Queued · waiting for this Bot’s computer',running:'Working on this Bot’s computer',completed:'Completed',failed:'Failed',unknown:'Outcome unknown'})[status];
}

function replacementRunFallback(status:AgentRun['status']):string {
  return ({queued:'Waiting for this Bot’s computer…',running:'Working on this Bot’s computer…',completed:'The retry completed without a saved response.',failed:'The retry failed without a saved response.',unknown:'The retry outcome could not be confirmed.'})[status];
}

const agentFailureReasonLabels:Record<string,string>={
  agent_transport_failed:'The request did not reach or receive a response from the Agent runtime.',
  runtime_setup_failed:'The Agent could not initialize the task runtime.',
  runtime_error:'The Agent runtime exited unexpectedly.',
  agent_timeout:'The Agent runtime exceeded its execution limit.',
  model_request_failed:'The model request failed inside the Agent runtime.',
  model_request_rejected:'The model provider rejected the request as invalid.',
  model_endpoint_not_found:'The configured model endpoint or model was not found.',
  model_rate_limited:'The model provider rate-limited the request.',
  model_auth_rejected:'The model provider rejected authentication.',
  model_provider_unavailable:'The model provider returned a server error.',
  model_response_missing:'The model did not return an assistant response.',
  tool_execution_failed:'An Agent tool failed during execution.',
  result_missing:'The Agent did not return a structured task result.',
  result_invalid:'The Agent returned an invalid structured task result.',
  agent_output_limit:'The Agent response reached its output limit before returning a result.',
};
const agentRuntimeDiagnosticLabels:Record<string,string>={
  AGENT_RUNTIME_ABORT_ERROR:'Agent runtime aborted before returning a result.',
  AGENT_RUNTIME_API_ERROR:'Agent runtime received an API error.',
  AGENT_RUNTIME_FETCH_ERROR:'Agent runtime could not complete a network fetch.',
  AGENT_RUNTIME_NETWORK_ERROR:'Agent runtime encountered a network error.',
  AGENT_RUNTIME_RANGE_ERROR:'Agent runtime encountered an invalid range or size.',
  AGENT_RUNTIME_REFERENCE_ERROR:'Agent runtime referenced a missing value.',
  AGENT_RUNTIME_SYNTAX_ERROR:'Agent runtime encountered invalid syntax.',
  AGENT_RUNTIME_TIMEOUT_ERROR:'Agent runtime timed out.',
  AGENT_RUNTIME_TYPE_ERROR:'Agent runtime encountered a type error.',
  AGENT_RUNTIME_UNCLASSIFIED_ERROR:'Agent runtime stopped with an unclassified error.',
};
const agentFailureStageLabels:Record<string,string>={'agent-setup':'Agent setup','agent-execution':'Agent execution','model-request':'Model request','model-response':'Model response','tool-execution':'Tool execution','result-validation':'Result validation'};
const failureStageLabels:Record<string,string>={...agentFailureStageLabels,'request-validation':'Validate model gateway request','request-auth':'Check model gateway capability','provider-request':'Send request to model provider','provider-response':'Receive model provider response','response-stream':'Transfer model response','scheduler-execution':'Run scheduler outcome handling','lease-renewal':'Renew task lease','result-persistence':'Save task result','trace-persistence':'Persist run diagnostics','trace-read':'Read run diagnostics','queue-wait':'Wait for Agent runtime capacity','computer-control':'Check computer control state','adapter-start':'Start Agent adapter process','adapter-exit':'Observe Agent adapter exit',route:'Worker route','screen-scope':'Resolve Bot screen','screen-owner':'Check computer owner','action-body':'Validate action request','action-navigate':'Run browser navigation','action-execute':'Run browser or desktop action'};
const providerErrorKindLabels:Record<string,string>={request_invalid:'Provider classified the request as invalid',authentication_rejected:'Provider rejected authentication',model_not_found:'Provider could not find the configured model',context_limit:'Provider context or token limit was exceeded',rate_limited:'Provider rate limit was reached',quota_exhausted:'Provider quota or billing limit was reached',permission_denied:'Provider denied this request',provider_server_error:'Provider returned a server error',provider_unavailable:'Provider service was unavailable',content_filtered:'Provider content filter rejected the request',unknown:'Provider error category was not recognized'};
const providerErrorCodeLabels:Record<string,string>={invalid_request_error:'Provider marked the request invalid',invalid_api_key:'Provider rejected the API key',model_not_found:'Provider could not find the model',context_length_exceeded:'Provider context limit was exceeded',rate_limit_exceeded:'Provider rate limit was reached',insufficient_quota:'Provider quota was exhausted',permission_denied:'Provider denied the request',unsupported_parameter:'Provider rejected an unsupported parameter',unsupported_value:'Provider rejected an unsupported value',missing_required_parameter:'Provider reported a missing required parameter',invalid_type:'Provider rejected a parameter type',unknown_parameter:'Provider reported an unknown parameter',request_too_large:'Provider request was too large',content_filter:'Provider content filter rejected the request'};
const failureComponentLabels:Record<string,string>={'agent-runtime':'Pi / DeepSeek Harness','model-gateway':'Model gateway','computer-worker':'Cloud computer operation','scheduler':'Task scheduler','control-plane':'Control plane','mysql':'Database'};
function runFailureHeadline(run:Pick<AgentRun,'diagnosticCode'|'failureTraceDiagnosticCode'|'failureComponent'|'failureHttpStatus'|'failureReasonCode'|'failureStage'|'failureUpstreamHttpStatus'|'failureUpstreamErrorKind'|'failureUpstreamErrorCode'|'failureAdapterExitCode'|'failureAdapterExitSignal'|'failureTransportCode'|'failureDatabaseCode'>):string|null {
  const diagnosticCode=run.failureTraceDiagnosticCode||run.diagnosticCode;
  if(!diagnosticCode&&!run.failureReasonCode&&!run.failureComponent)return null;
  if(run.failureComponent==='model-gateway'){
    const upstreamStatus=run.failureUpstreamHttpStatus||null;
    const status=upstreamStatus||run.failureHttpStatus;
    const reason=run.failureUpstreamErrorKind?providerErrorKindLabels[run.failureUpstreamErrorKind]:null;
    const providerCode=run.failureUpstreamErrorCode?providerErrorCodeLabels[run.failureUpstreamErrorCode]||run.failureUpstreamErrorCode:null;
    if(run.failureReasonCode==='request_body_too_large')return `Model request body exceeded gateway limit${status?` · gateway HTTP ${status}`:''} · request_body_too_large`;
    const requestReason=run.failureReasonCode?modelGatewayReasonLabels[run.failureReasonCode]:null;
    if(requestReason)return `${requestReason}${status?` · gateway HTTP ${status}`:''} · ${run.failureReasonCode}`;
    if(reason||providerCode)return `${reason||providerCode}${status?` · provider HTTP ${status}`:''}${providerCode&&reason?` · ${run.failureUpstreamErrorCode}`:''}`;
    return `Model gateway request failed${run.failureHttpStatus?` · gateway HTTP ${run.failureHttpStatus}`:''}${upstreamStatus?` · provider HTTP ${upstreamStatus}`:''}`;
  }
  if(run.failureComponent==='agent-runtime'){
    const diagnosis=diagnosticCode?agentRuntimeDiagnosticLabels[diagnosticCode]||runDiagnosticSummary(diagnosticCode):null;
    const reason=run.failureReasonCode?agentFailureReasonLabels[run.failureReasonCode]:null;
    const lead=run.failureReasonCode==='runtime_error'&&diagnosis?diagnosis:reason||diagnosis||'Agent runtime request failed';
    const providerKind=run.failureUpstreamErrorKind?providerErrorKindLabels[run.failureUpstreamErrorKind]:null;
    const providerCode=run.failureUpstreamErrorCode?providerErrorCodeLabels[run.failureUpstreamErrorCode]||run.failureUpstreamErrorCode:null;
    return `${lead}${run.failureHttpStatus?` · Agent HTTP ${run.failureHttpStatus}`:''}${run.failureUpstreamHttpStatus?` · model endpoint HTTP ${run.failureUpstreamHttpStatus}`:''}${providerKind?` · ${providerKind}`:''}${providerCode?` · ${providerCode}`:''}${diagnosticCode?` · ${diagnosticCode}`:''}${run.failureAdapterExitCode?` · adapter exit ${run.failureAdapterExitCode}`:''}${run.failureAdapterExitSignal?` · signal ${run.failureAdapterExitSignal}`:''}${run.failureTransportCode?` · transport ${run.failureTransportCode}`:''}${run.failureDatabaseCode?` · database ${run.failureDatabaseCode}`:''}`;
  }
  if(run.failureComponent==='scheduler'){
    if(diagnosticCode==='RUN_RESULT_PERSIST_FAILED'||diagnosticCode==='result_persist_failed')return `Task result could not be saved${run.failureDatabaseCode?` · database ${run.failureDatabaseCode}`:''}`;
    if(diagnosticCode==='RUN_RESULT_NOT_PERSISTED')return 'Task result was not saved';
    if(diagnosticCode==='lease_lost'||diagnosticCode==='lease_expired')return 'Task lease ended before completion was recorded';
    return run.failureReasonCode?`Task scheduler failed · ${run.failureReasonCode}${run.failureDatabaseCode?` · database ${run.failureDatabaseCode}`:''}`:'Task scheduler could not confirm the result';
  }
  if(run.failureComponent==='computer-worker'){
    const detail=diagnosticCode?computerFailureReasonLabels[diagnosticCode]:null;
    return `${detail||'Cloud computer action failed'}${run.failureHttpStatus?` · HTTP ${run.failureHttpStatus}`:''}`;
  }
  if(run.failureComponent==='control-plane')return `${runDiagnosticSummary(run.diagnosticCode)||'Cloud computer connection failed'}${run.failureHttpStatus?` · HTTP ${run.failureHttpStatus}`:''}`;
  if(run.failureComponent==='mysql')return `${diagnosticCode==='RUN_TRACE_WRITE_FAILED'?'Run diagnostics could not be saved':'Database operation failed'}${run.failureDatabaseCode?` · database ${run.failureDatabaseCode}`:''}${run.failureHttpStatus?` · HTTP ${run.failureHttpStatus}`:''}`;
  const component=run.failureComponent?failureComponentLabels[run.failureComponent]||'Task operation':diagnosticCode==='agent_adapter_failed'?'Pi / DeepSeek Harness':'Task operation';
  const status=run.failureHttpStatus?` · HTTP ${run.failureHttpStatus}${run.failureUpstreamHttpStatus?` · upstream HTTP ${run.failureUpstreamHttpStatus}`:''}`:'';
  if(run.failureReasonCode)return `${component} failed${status}`;
  if(diagnosticCode==='agent_adapter_failed')return `Pi / DeepSeek Harness failed${status}`;
  if(run.failureComponent)return `${component} failed${status}`;
  return runDiagnosticSummary(diagnosticCode);
}
const computerFailureReasonLabels:Record<string,string>={COMPUTER_BROWSER_ACTION_FAILED:'The browser action failed without a more specific classification',COMPUTER_BROWSER_ACTION_TIMEOUT:'The browser action timed out; inspect the current page before retrying',COMPUTER_BROWSER_NAVIGATION_ABORTED:'The browser navigation was interrupted',COMPUTER_BROWSER_NAVIGATION_NETWORK_FAILED:'Chromium reported a network failure while loading the page',COMPUTER_BROWSER_NAVIGATION_FAILED:'The page navigation did not complete',COMPUTER_BROWSER_CONTROL_ACTION_FAILED:'The browser control action failed',COMPUTER_BROWSER_CONTEXT_CLOSED:'The browser page or context closed during the action',COMPUTER_BROWSER_PAGE_INSPECTION_FAILED:'The page inspection failed',COMPUTER_BROWSER_ARTIFACT_OPEN_FAILED:'The task artifact could not be opened',COMPUTER_BROWSER_TARGET_NOT_FOUND:'No visible target matched the requested action',COMPUTER_BROWSER_TARGET_AMBIGUOUS:'More than one visible target matched the requested action',COMPUTER_STATE_CHANGED:'The computer ownership or page state changed during the action',COMPUTER_OWNER_USER:'The computer is currently controlled by the user',COMPUTER_RENDERER_UNRESPONSIVE:'The browser renderer stopped responding'};
function runFailureDescription(run:Pick<AgentRun,'diagnosticCode'|'failureTraceDiagnosticCode'|'failureComponent'|'failureReasonCode'|'failureStage'|'failureHttpStatus'|'failureUpstreamHttpStatus'|'failureUpstreamErrorKind'|'failureUpstreamErrorCode'|'failureAdapterExitCode'|'failureAdapterExitSignal'|'failureDatabaseCode'|'failureTransportCode'|'failureOperation'|'failureAttemptNumber'|'failureDurationMs'|'failureRequestBytes'|'failureRequestLimitBytes'>):string|null {
  const diagnosticCode=run.failureTraceDiagnosticCode||run.diagnosticCode;
  const stage=run.failureStage?failureStageLabels[run.failureStage]||run.failureStage:null;
  const codes=[diagnosticCode,run.failureReasonCode,run.diagnosticCode!==diagnosticCode?run.diagnosticCode:null].filter(Boolean).join(' / ');
  const statuses=[run.failureHttpStatus?`${run.failureComponent==='model-gateway'?'Model gateway':run.failureComponent==='agent-runtime'?'Agent runtime':run.failureComponent==='computer-worker'?'Computer worker':run.failureComponent==='control-plane'?'Control plane':'Task'} HTTP ${run.failureHttpStatus}`:null,run.failureUpstreamHttpStatus?`${run.failureComponent==='model-gateway'?'Provider upstream':run.failureComponent==='agent-runtime'?'Model endpoint upstream':'Upstream'} HTTP ${run.failureUpstreamHttpStatus}`:null].filter(Boolean).join(' · ');
  const providerKind=run.failureUpstreamErrorKind?providerErrorKindLabels[run.failureUpstreamErrorKind]||'Provider returned a classified error':null;
  const providerCode=run.failureUpstreamErrorCode?providerErrorCodeLabels[run.failureUpstreamErrorCode]||run.failureUpstreamErrorCode:null;
  const operation=run.failureOperation?`Operation ${run.failureOperation}`:null;
  const attempt=run.failureAttemptNumber?`Model call ${run.failureAttemptNumber}`:null;
  const duration=run.failureDurationMs!==null&&run.failureDurationMs!==undefined?`Failed after ${run.failureDurationMs} ms`:null;
  const requestSize=run.failureRequestBytes!==null&&run.failureRequestBytes!==undefined&&run.failureRequestLimitBytes!==null&&run.failureRequestLimitBytes!==undefined?`Bytes read before rejection ${new Intl.NumberFormat('en-US').format(run.failureRequestBytes)} B; gateway limit ${new Intl.NumberFormat('en-US').format(run.failureRequestLimitBytes)} B`:null;
  if(run.failureComponent==='model-gateway'){
    const reason=run.failureReasonCode?modelGatewayReasonLabels[run.failureReasonCode]:null;
    const notForwarded=run.failureStage==='request-validation'&&!run.failureUpstreamHttpStatus?'Request was rejected before calling the model provider':null;
    return [stage,reason||runDiagnosticSummary(diagnosticCode)||'Model gateway request failed',operation,attempt,duration,requestSize,notForwarded,providerCode,providerKind,statuses,codes?`[${codes}]`:null,run.failureAdapterExitCode!==null&&run.failureAdapterExitCode!==undefined?`Agent adapter exit ${run.failureAdapterExitCode}`:null,run.failureAdapterExitSignal?`signal ${run.failureAdapterExitSignal}`:null,run.failureTransportCode?`transport ${run.failureTransportCode}`:null].filter(Boolean).join(' · ');
  }
  if(run.failureComponent==='agent-runtime'){
    const diagnosis=diagnosticCode?agentRuntimeDiagnosticLabels[diagnosticCode]||runDiagnosticSummary(diagnosticCode):null;
    const reason=run.failureReasonCode?agentFailureReasonLabels[run.failureReasonCode]:null;
    const lead=run.failureReasonCode==='runtime_error'&&diagnosis?diagnosis:reason||diagnosis||'Agent runtime request failed';
    return [stage,lead,operation,attempt,duration,statuses,providerCode,providerKind,codes?`[${codes}]`:null,run.failureAdapterExitCode!==null&&run.failureAdapterExitCode!==undefined?`adapter exit ${run.failureAdapterExitCode}`:null,run.failureAdapterExitSignal?`signal ${run.failureAdapterExitSignal}`:null,run.failureDatabaseCode?`database ${run.failureDatabaseCode}`:null,run.failureTransportCode?`transport ${run.failureTransportCode}`:null].filter(Boolean).join(' · ');
  }
  if(run.failureComponent==='scheduler'){
    const reason=run.failureReasonCode? schedulerFailureReasonLabels[run.failureReasonCode]:null;
    const diagnosis=diagnosticCode==='RUN_RESULT_PERSIST_FAILED'||diagnosticCode==='result_persist_failed'?'The executor returned a result, but persistence failed':diagnosticCode==='RUN_RESULT_NOT_PERSISTED'?'The database transaction did not update this active run':diagnosticCode?runDiagnosticSummary(diagnosticCode):null;
    return [stage,reason||diagnosis||'The scheduler could not confirm the task result',codes?`[${codes}]`:null,run.failureDatabaseCode?`database ${run.failureDatabaseCode}`:null].filter(Boolean).join(' · ');
  }
  if(run.failureComponent==='computer-worker')return [stage,diagnosticCode?computerFailureReasonLabels[diagnosticCode]||'Cloud computer action failed':null,statuses,codes?`[${codes}]`:null,run.failureTransportCode?`transport ${run.failureTransportCode}`:null].filter(Boolean).join(' · ')||null;
  if(run.failureReasonCode){
    return `${stage?`${stage}: `:''}${agentFailureReasonLabels[run.failureReasonCode]||'The task failed with a classified reason.'} [${codes}]${run.failureUpstreamHttpStatus?` · upstream HTTP ${run.failureUpstreamHttpStatus}`:''}${providerKind?` · ${providerKind}`:''}${run.failureAdapterExitCode!==null&&run.failureAdapterExitCode!==undefined?` · adapter exit ${run.failureAdapterExitCode}`:''}${run.failureTransportCode?` · transport ${run.failureTransportCode}`:''}`;
  }
  if(diagnosticCode==='agent_adapter_failed')return `The Agent adapter exited before returning a task result [agent_adapter_failed]${run.failureHttpStatus?` · Agent HTTP ${run.failureHttpStatus}`:''}${run.failureAdapterExitCode!==null&&run.failureAdapterExitCode!==undefined?` · exit ${run.failureAdapterExitCode}`:''}${run.failureAdapterExitSignal?` · signal ${run.failureAdapterExitSignal}`:''}${run.failureTransportCode?` · transport ${run.failureTransportCode}`:''}. No classified cause was recorded by this runtime.`;
  const summary=runDiagnosticSummary(diagnosticCode);
  return summary&&diagnosticCode?`${summary} [${diagnosticCode}]${statuses?` · ${statuses}`:''}${run.failureTransportCode?` · transport ${run.failureTransportCode}`:''}`:summary;
}
const modelGatewayReasonLabels:Record<string,string>={request_content_type_invalid:'The Agent sent a request with a non-JSON content type',request_body_too_large:'The model request body exceeded the configured gateway size limit',request_json_invalid:'The model request body was not valid JSON',request_shape_invalid:'The model request JSON had an invalid top-level shape',model_name_mismatch:'The request model did not match the configured model',messages_invalid:'The request had no valid messages or exceeded the message limit',max_tokens_invalid:'The requested max_tokens value was outside the supported range',stream_flag_invalid:'The stream option was not a boolean',capability_invalid:'The Agent capability was missing, expired, or invalid',call_budget_exhausted:'The task exhausted its model call budget',provider_http_rejected:'The provider rejected the model request',provider_rate_limited:'The provider rate-limited the request',provider_cooldown_active:'The gateway cooldown prevented another provider request',provider_transport_failed:'The gateway could not connect to the provider',provider_request_failed:'The provider request failed without a classified transport error',provider_response_stream_interrupted:'The provider response stream ended early',provider_response_missing_body:'The provider returned success without a response body'};
const schedulerFailureReasonLabels:Record<string,string>={database_deadlock:'The database reported a transaction deadlock',database_lock_timeout:'The database lock wait timed out',database_connection:'The database connection failed while saving the result',database_error:'The result write failed with an unclassified database error',lease_lost:'The scheduler no longer held the run lease',executor_failed:'The task executor threw before returning a confirmed result',execution_aborted:'The task was interrupted before completion was recorded',result_persistence_failed:'The result could not be persisted',finish_not_applied:'The result-save transaction did not update the active run'};

const runDiagnosticSummaries:Record<string,string>={
  executor_error:'The Agent stopped before it could confirm a result.',
  agent_reported_failure:'The Agent returned a failed task result.',
  desktop_connect_failed:'The Bot could not connect to its computer.',
  model_upstream_429:'The model service was rate-limited before a result was confirmed.',
  model_gateway_call_limit:'The task used its model-call budget before it could confirm a result.',
  bot_memory_preload_failed:'The Bot could not load its saved memory.',
  bot_memory_scope_invalid:'The Bot could not access its saved memory for this run.',
  bot_skill_preload_failed:'The Bot could not load one of its enabled skills.',
  bot_skill_scope_invalid:'The Bot could not access an enabled skill for this run.',
  bot_handoff_scope_invalid:'The Bot could not complete its handoff to another Bot.',
  capability_issue_failed:'The Agent could not initialize a required capability.',
  agent_transport_failed:'The Agent connection ended before the result was confirmed.',
  agent_http_400:'The Agent rejected the request as invalid.',
  agent_http_401:'The Agent request was not authenticated.',
  agent_http_403:'The Agent service denied the request.',
  agent_http_404:'The Agent service could not find the requested resource.',
  agent_http_408:'The Agent service timed out waiting for the request.',
  agent_http_409:'The Agent service reported a request conflict.',
  agent_http_413:'The Agent request exceeded the service size limit.',
  agent_http_415:'The Agent service rejected the request format.',
  agent_http_422:'The Agent service could not process the request.',
  agent_http_429:'The Agent service rate-limited the request.',
  agent_http_5xx:'The Agent service failed while processing the request.',
  agent_http_other:'The Agent service returned an unexpected error.',
  agent_adapter_failed:'The Agent adapter exited before returning a task result.',
  agent_adapter_output_invalid:'The Agent returned a result it could not verify.',
  AGENT_RUNTIME_ABORT_ERROR:'Agent runtime aborted before returning a result.',
  AGENT_RUNTIME_API_ERROR:'Agent runtime received an API error.',
  AGENT_RUNTIME_FETCH_ERROR:'Agent runtime could not complete a network fetch.',
  AGENT_RUNTIME_NETWORK_ERROR:'Agent runtime encountered a network error.',
  AGENT_RUNTIME_RANGE_ERROR:'Agent runtime encountered an invalid range or size.',
  AGENT_RUNTIME_REFERENCE_ERROR:'Agent runtime referenced a missing value.',
  AGENT_RUNTIME_SYNTAX_ERROR:'Agent runtime encountered invalid syntax.',
  AGENT_RUNTIME_TIMEOUT_ERROR:'Agent runtime timed out.',
  AGENT_RUNTIME_TYPE_ERROR:'Agent runtime encountered a type error.',
  AGENT_RUNTIME_UNCLASSIFIED_ERROR:'Agent runtime stopped with an unclassified error.',
  AGENT_ADAPTER_SPAWN_FAILED:'The Agent adapter executable could not be started.',
  AGENT_ADAPTER_NONZERO_EXIT:'The Agent adapter exited with a nonzero code.',
  AGENT_ADAPTER_SIGNAL_EXIT:'The operating system stopped the Agent adapter process.',
  AGENT_ADAPTER_TIMEOUT:'The Agent adapter exceeded its execution time limit.',
  AGENT_ADAPTER_OUTPUT_INVALID:'The Agent adapter output was not valid task-result JSON.',
  COMPUTER_CONTROL_CHECK_FAILED:'The Agent could not read the cloud computer control state.',
  bot_bridge_invalid:'A required Bot capability could not be initialized.',
  computer_control_unavailable:'The computer control channel was unavailable.',
  group_context_invalid:'The group task context could not be loaded.',
  kernel_unavailable:'The Agent runtime kernel was unavailable.',
  model_config_invalid:'The model configuration could not be applied.',
  task_attachments_invalid:'One or more task attachments could not be loaded.',
  task_cancelled:'The Agent task was cancelled before its result was confirmed.',
  task_workspace_invalid:'The task workspace could not be initialized.',
  unknown_agent_rejection:'The Agent rejected the task; its safe error category is unavailable.',
  agent_response_invalid:'The Agent returned a response the Bot could not use.',
  agent_result_unconfirmed:'The Agent did not confirm whether the task completed.',
  agent_paused_for_control:'The Agent paused while computer control was unavailable.',
  computer_control_state_unknown:'The Bot could not determine the current computer control state.',
  agent_result_status_unconfirmed:'The Agent response did not confirm a final task status.',
  agent_result_message_missing:'The Agent did not return a final message.',
  execution_aborted:'Execution stopped before a result was confirmed.',
  lease_lost:'The run lease ended before completion was recorded.',
  result_persist_failed:'The result was returned, but saving it failed.',
  lease_expired:'The task timed out before its result was confirmed.',
};

function runDiagnosticSummary(code:string|null|undefined):string|null {
  return code?runDiagnosticSummaries[code]||null:null;
}

function renderGroupUserText(message: GroupMessage, members: GroupMember[]): React.ReactNode {
  const text=message.text||'',targeted=new Set(message.targetBotIds||[]);
  const mentions=[...(members.length>0&&members.every(member=>targeted.has(member.id))?[{label:'@everyone',id:'everyone'}]:[]),...members.filter(member=>targeted.has(member.id)).map(member=>({label:`@${member.name}`,id:member.id}))].sort((a,b)=>b.label.length-a.label.length);
  if(!mentions.length)return text;
  const parts:React.ReactNode[]=[];let cursor=0;
  while(cursor<text.length){
    const match=mentions.find(item=>text.startsWith(item.label,cursor)&&(cursor===0||/[\s([{>]/.test(text[cursor-1])));
    if(!match){const next=text.indexOf('@',cursor+1);if(next<0){parts.push(text.slice(cursor));break}parts.push(text.slice(cursor,next));cursor=next;continue}
    parts.push(<span className="group-mention-token" key={`${match.id}:${cursor}`}>{match.label}</span>);cursor+=match.label.length;
  }
  return parts;
}

function IconButton({ name, label, onClick, className = '', buttonRef, disabled = false }: { name: IconName; label: string; onClick?: () => void; className?: string; buttonRef?: React.Ref<HTMLButtonElement>; disabled?: boolean }) {
  return <button ref={buttonRef} type="button" className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}><Icon name={name} /></button>;
}

function BotMenuIcon({name}:{name:'pin'|'folder'|'unread'|'rename'|'copy'|'hide'|'delete'}) {
  const paths:Record<typeof name,React.ReactNode>={
    pin:<><path d="m9 4 2-2 8 8-2 2-2-1-3 4-1 3-4-4-4 5-1-1 5-4-4-4 3-1 4-3z" /></>,
    folder:<><path d="M3 18V5a2 2 0 0 1 2-2h5l2 2h6a2 2 0 0 1 2 2v4M3 18h8M17 14v7M13.5 17.5h7" /></>,
    unread:<><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 20h4" /><circle cx="19" cy="5" r="2" fill="currentColor" stroke="none" /></>,
    rename:<><path d="M19 13v6H4V4h7M11 15l-3 1 1-3 8-8 2 2zM16 6l2 2" /></>,
    copy:<><rect x="8" y="3" width="12" height="14" rx="1" /><path d="M5 7H4v13h12v-1" /></>,
    hide:<><path d="M3 3l18 18M4 7a15 15 0 0 0-2 5s3 6 10 6a11 11 0 0 0 4-1M8 5a12 12 0 0 1 4-1c7 0 10 8 10 8a13 13 0 0 1-3 4M10 10a3 3 0 0 0 4 4" /></>,
    delete:<><path d="M4 6h16M9 3h6M7 6l1 14h8l1-14M10 10v7M14 10v7" /></>,
  };
  return <svg className="sidebar-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

type Account = { userId: string; tenantId: string; email: string; name: string; role: string };
type WorkspaceInfo={tenantId:string;name:string;tenantType:'personal'|'team';role:string;memberCount:number};
type TeamInvitationInfo={id:string;email:string;createdAt:string;expiresAt:string;status:'pending'|'expired'|'accepted'|'revoked'};

function TeamWorkspaceDialog({account,onClose,onWorkspaceChanged}:{account:Account;onClose:()=>void;onWorkspaceChanged:()=>void}){
  const [workspaces,setWorkspaces]=useState<WorkspaceInfo[]>([]),[invitations,setInvitations]=useState<TeamInvitationInfo[]>([]),[status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
  const [email,setEmail]=useState(''),[inviteLink,setInviteLink]=useState(''),[teamName,setTeamName]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const dialog=useRef<HTMLElement>(null),closeButton=useRef<HTMLButtonElement>(null);
  const currentWorkspace=workspaces.find(workspace=>workspace.tenantId===account.tenantId);
  const canInvite=currentWorkspace?.tenantType==='team'&&(account.role==='owner'||account.role==='admin');
  async function refresh(signal?:AbortSignal){
    setStatus('loading');
    try{
      const response=await fetch(`${import.meta.env.BASE_URL}api/auth/workspaces`,{credentials:'same-origin',cache:'no-store',signal});
      if(!response.ok)throw new Error('Workspaces are unavailable.');
      const value=await response.json() as {workspaces?:WorkspaceInfo[]};if(!Array.isArray(value.workspaces))throw new Error('Workspaces are unavailable.');setWorkspaces(value.workspaces);
      const current=value.workspaces.find(workspace=>workspace.tenantId===account.tenantId),mayManageInvitations=current?.tenantType==='team'&&(account.role==='owner'||account.role==='admin');
      if(mayManageInvitations){const invitesResponse=await fetch(`${import.meta.env.BASE_URL}api/team/invitations`,{credentials:'same-origin',cache:'no-store',signal});if(!invitesResponse.ok)throw new Error('Team invitations are unavailable.');const inviteValue=await invitesResponse.json() as {invitations?:TeamInvitationInfo[]};setInvitations(Array.isArray(inviteValue.invitations)?inviteValue.invitations:[])}else setInvitations([]);
      setStatus('ready');
    }catch(cause){if(!signal?.aborted){setStatus('error');setError(cause instanceof Error?cause.message:'Workspaces are unavailable.')}}
  }
  useEffect(()=>{const controller=new AbortController();void refresh(controller.signal);requestAnimationFrame(()=>closeButton.current?.focus());return()=>controller.abort()},[]);
  async function createInvite(event:React.FormEvent){
    event.preventDefault();if(busy)return;setBusy('invite');setError('');setNotice('');setInviteLink('');
    try{
      const response=await fetch(`${import.meta.env.BASE_URL}api/team/invitations`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({email})});
      const value=await response.json() as {id?:string;token?:string;email?:string;error?:string};if(!response.ok||!value.token)throw new Error(value.error||'Could not create invitation.');
      const link=new URL(import.meta.env.BASE_URL,window.location.origin);link.hash=`invite=${value.token}`;setInviteLink(link.toString());setEmail('');setNotice(`Invitation created for ${value.email||'your teammate'}.`);await refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not create invitation.')}finally{setBusy('')}
  }
  async function createTeamWorkspace(event:React.FormEvent){
    event.preventDefault();if(busy)return;setBusy('workspace');setError('');setNotice('');
    try{const response=await fetch(`${import.meta.env.BASE_URL}api/auth/workspaces/create`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({name:teamName})});const value=await response.json() as {tenantId?:string;error?:string};if(!response.ok||!value.tenantId)throw new Error(value.error||'Could not create team workspace.');onWorkspaceChanged()}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not create team workspace.')}finally{setBusy('')}
  }
  async function copyInvite(){try{await navigator.clipboard.writeText(inviteLink);setNotice('Invitation link copied.')}catch{setError('Could not copy the invitation link.')}}
  async function revokeInvitation(invitation:TeamInvitationInfo){
    if(busy)return;setBusy(invitation.id);setError('');setNotice('');
    try{const response=await fetch(`${import.meta.env.BASE_URL}api/team/invitations/${encodeURIComponent(invitation.id)}`,{method:'DELETE',credentials:'same-origin'});if(!response.ok)throw new Error('Could not revoke invitation.');setInvitations(items=>items.map(item=>item.id===invitation.id?{...item,status:'revoked'}:item));setNotice('Invitation revoked.')}catch(cause){setError(cause instanceof Error?cause.message:'Could not revoke invitation.')}finally{setBusy('')}
  }
  async function switchWorkspace(workspace:WorkspaceInfo){
    if(workspace.tenantId===account.tenantId||busy)return;setBusy(workspace.tenantId);setError('');
    try{const response=await fetch(`${import.meta.env.BASE_URL}api/auth/workspaces`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({tenantId:workspace.tenantId})});if(!response.ok)throw new Error('Could not switch workspace.');onWorkspaceChanged()}catch(cause){setError(cause instanceof Error?cause.message:'Could not switch workspace.')}finally{setBusy('')}
  }
  return <div className="connect-apps-overlay" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}><section ref={dialog} className="connect-apps-dialog team-workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="team-workspace-title" tabIndex={-1} onKeyDown={event=>{if(event.key==='Escape'&&!busy)onClose()}}>
    <header><div><strong id="team-workspace-title">Workspaces & team</strong><small>{account.email}</small></div><button ref={closeButton} type="button" aria-label="Close workspaces" onClick={onClose}>×</button></header>
    <div className="connect-apps-skills team-workspace-content">
      <div className="connect-apps-section-heading"><h2>Workspaces</h2><span>{workspaces.length}</span></div>
      <p>Choose which workspace this Bot uses. Bot conversations remain private to their owner.</p>
      {status==='loading'?<div className="connect-apps-empty">Loading workspaces…</div>:status==='error'?<div className="connect-apps-empty" role="alert">Workspaces are unavailable.</div>:<div className="team-workspace-list">{workspaces.map(workspace=><article className="team-workspace-row" key={workspace.tenantId}><div><strong>{workspace.name}</strong><small>{workspace.tenantType==='team'?'Team workspace':'Personal workspace'} · {workspace.role} · {workspace.memberCount} {workspace.memberCount===1?'member':'members'}</small></div>{workspace.tenantId===account.tenantId?<span className="team-workspace-current">Current</span>:<button type="button" disabled={Boolean(busy)} onClick={()=>void switchWorkspace(workspace)}>Switch</button>}</article>)}</div>}
      {status==='ready'&&currentWorkspace?.tenantType==='personal'&&account.role==='owner'&&<>
        <div className="connect-apps-section-heading connect-apps-subheading"><h2>Create a team workspace</h2></div>
        <p>Keep your personal workspace private and create a separate shared space for teammates and published Skills.</p>
        <form className="team-invite-form" onSubmit={event=>void createTeamWorkspace(event)}><label htmlFor="team-workspace-name">Team workspace name</label><div><input id="team-workspace-name" type="text" value={teamName} maxLength={120} required onChange={event=>setTeamName(event.target.value)} placeholder="Product team"/><button type="submit" disabled={Boolean(busy)||!teamName.trim()}>{busy==='workspace'?'Creating…':'Create workspace'}</button></div></form>
      </>}
      {canInvite&&<>
        <div className="connect-apps-section-heading connect-apps-subheading"><h2>Invite a teammate</h2></div>
        <p>Invite links are tied to the email address and expire after seven days. The invited person must sign in with that Google account.</p>
        <form className="team-invite-form" onSubmit={event=>void createInvite(event)}><label htmlFor="team-invite-email">Email address</label><div><input id="team-invite-email" type="email" value={email} maxLength={320} required autoComplete="email" onChange={event=>setEmail(event.target.value)} placeholder="teammate@example.com"/><button type="submit" disabled={Boolean(busy)||!email.trim()}>{busy==='invite'?'Creating…':'Create invite'}</button></div></form>
        {inviteLink&&<div className="team-invite-link"><input aria-label="Invitation link" readOnly value={inviteLink}/><button type="button" onClick={()=>void copyInvite()}>Copy link</button></div>}
        <div className="connect-apps-section-heading connect-apps-subheading"><h2>Invitations</h2><span>{invitations.filter(item=>item.status==='pending').length} pending</span></div>
        {invitations.length?<div className="team-invitation-list">{invitations.map(invitation=><article className="team-workspace-row" key={invitation.id}><div><strong>{invitation.email}</strong><small>{invitation.status} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</small></div>{invitation.status==='pending'&&<button type="button" disabled={Boolean(busy)} onClick={()=>void revokeInvitation(invitation)}>Revoke</button>}</article>)}</div>:<div className="connect-apps-empty">No invitations yet.</div>}
      </>}
      {error&&<p className="connect-apps-error" role="alert">{error}</p>}{notice&&<p className="connect-apps-notice" role="status">{notice}</p>}
    </div>
  </section></div>;
}

function ConnectAppsDialog({botId,botName,focusSkillId,onClose}:{botId:string;botName:string;focusSkillId:string;onClose:()=>void}){
  const [skills,setSkills]=useState<PrivateSkill[]>([]),[state,setState]=useState<'loading'|'ready'|'error'>('loading'),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[publishTargets,setPublishTargets]=useState<SkillPublishTarget[]>([]),[currentTenantId,setCurrentTenantId]=useState(''),[selectedTargetId,setSelectedTargetId]=useState('');
  const dialog=useRef<HTMLElement>(null),closeButton=useRef<HTMLButtonElement>(null);
  const url=`${import.meta.env.BASE_URL}api/bots/${encodeURIComponent(botId)}/skills`;
  useEffect(()=>{
    const controller=new AbortController();setState('loading');setSkills([]);setError('');setNotice('');
    void fetch(url,{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error();const value=await response.json() as {skills?:unknown;currentTenantId?:unknown;publishTargets?:unknown};if(!Array.isArray(value.skills)||!Array.isArray(value.publishTargets)||typeof value.currentTenantId!=='string')throw new Error();const targets=value.publishTargets.filter((item):item is SkillPublishTarget=>Boolean(item&&typeof item==='object'&&typeof (item as SkillPublishTarget).tenantId==='string'&&typeof (item as SkillPublishTarget).name==='string'&&typeof (item as SkillPublishTarget).memberCount==='number'));setSkills(value.skills as PrivateSkill[]);setPublishTargets(targets);setCurrentTenantId(value.currentTenantId);setSelectedTargetId(current=>current&&targets.some(target=>target.tenantId===current)?current:targets.find(target=>target.tenantId===value.currentTenantId)?.tenantId||targets[0]?.tenantId||'');setState('ready')}).catch(()=>{if(!controller.signal.aborted)setState('error')});
    requestAnimationFrame(()=>closeButton.current?.focus());return()=>controller.abort();
  },[url]);
  useEffect(()=>{if(state!=='ready'||!focusSkillId)return;const target=dialog.current?.querySelector<HTMLElement>(`[data-skill-id="${focusSkillId}"]`);if(target)target.scrollIntoView({block:'center',behavior:'smooth'});else setNotice('This Skill is not published to the current workspace.')},[state,focusSkillId]);
  const onKeyDown=(event:React.KeyboardEvent<HTMLElement>)=>{
    if(event.key==='Escape'){event.stopPropagation();onClose();return}
    if(event.key!=='Tab')return;
    const choices=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),[role="switch"]:not(:disabled)'));
    const first=choices[0],last=choices.at(-1);
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===event.currentTarget)){event.preventDefault();last?.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
  };
  const toggle=async(skill:PrivateSkill)=>{
    if(busy)return;setBusy(skill.id);setError('');
    try{
      const response=await fetch(`${url}/${encodeURIComponent(skill.id)}`,{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!skill.enabled})});
      if(!response.ok)throw new Error();const value=await response.json() as {enabled?:unknown};if(typeof value.enabled!=='boolean')throw new Error();setSkills(current=>current.map(item=>item.id===skill.id?{...item,enabled:value.enabled as boolean}:item));
    }catch{setError('Could not update this Skill for the current Bot.')}finally{setBusy('')}
  };
  const publication=async(skill:PrivateSkill,action:'publish'|'sync'|'unpublish')=>{
    if(busy||!selectedTargetId)return;setBusy(skill.id);setError('');setNotice('');
    try{
      const response=await fetch(`${url}/${encodeURIComponent(skill.id)}/publication`,{method:action==='unpublish'?'DELETE':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='unpublish'?{targetTenantId:selectedTargetId}:{action,targetTenantId:selectedTargetId})});
      const value=await response.json().catch(()=>({})) as {error?:unknown};if(!response.ok)throw new Error(typeof value.error==='string'?value.error:'Could not update team sharing.');
      setSkills(current=>current.map(item=>{if(item.id!==skill.id)return item;const publishedTenantIds=new Set(item.publishedTenantIds||[]),outOfSyncTenantIds=new Set(item.outOfSyncTenantIds||[]);if(action==='unpublish')publishedTenantIds.delete(selectedTargetId);else publishedTenantIds.add(selectedTargetId);outOfSyncTenantIds.delete(selectedTargetId);return {...item,publishedTenantIds:[...publishedTenantIds],outOfSyncTenantIds:[...outOfSyncTenantIds],published:selectedTargetId===currentTenantId?action!=='unpublish':item.published,outOfSync:selectedTargetId===currentTenantId?false:item.outOfSync}}));
      const teamName=publishTargets.find(target=>target.tenantId===selectedTargetId)?.name||'team';setNotice(action==='publish'?`Skill published to ${teamName}.`:action==='sync'?`Skill synced to ${teamName}.`:`Skill unpublished from ${teamName}.`);
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not update team sharing.')}finally{setBusy('')}
  };
  const copyLink=async(skill:PrivateSkill)=>{
    if(busy)return;setBusy(skill.id);setError('');setNotice('');
    try{const link=new URL(`${window.location.origin}${window.location.pathname}`);link.searchParams.set('skill',skill.id);await navigator.clipboard.writeText(link.toString());setNotice('Skill link copied. Team members can open it and enable the Skill for a Bot.')}catch{setError('Could not copy the Skill link.')}finally{setBusy('')}
  };
  const privateSkills=skills.filter(skill=>skill.isOwner!==false&&skill.visibility==='private');
  const botOnlySkills=skills.filter(skill=>skill.isOwner!==false&&skill.visibility==='bot');
  const teamSkills=skills.filter(skill=>skill.isOwner===false);
  const selectedTarget=publishTargets.find(target=>target.tenantId===selectedTargetId);
  const skillCard=(skill:PrivateSkill,scope:'private'|'bot'|'team')=>{const publishedToSelected=(skill.publishedTenantIds||[]).includes(selectedTargetId)||(skill.published&&selectedTargetId===currentTenantId),outOfSyncForSelected=(skill.outOfSyncTenantIds||[]).includes(selectedTargetId)||(skill.outOfSync&&selectedTargetId===currentTenantId);return <article className="connect-apps-skill" key={skill.id} data-skill-id={skill.id}>
    <div className="connect-apps-skill-icon" aria-hidden="true">✦</div><div className="connect-apps-skill-copy"><strong>{skill.name}</strong><p>{scope==='team'&&skill.sharedBy?`Shared by ${skill.sharedBy} · `:''}{skill.description}</p>
      {scope==='private'&&publishedToSelected&&<small className={outOfSyncForSelected?'out-of-sync':''}>{outOfSyncForSelected?`Changes not synced to ${selectedTarget?.name||'team'}`:`Published to ${selectedTarget?.name||'team'}`}</small>}
      {scope==='bot'&&<small>Only available to {botName}</small>}
    </div>
    <div className="connect-apps-skill-actions">
      <button type="button" role="switch" aria-checked={skill.enabled} aria-label={`${skill.enabled?'Disable':'Enable'} ${skill.name} for ${botName}`} disabled={Boolean(busy)} onClick={()=>void toggle(skill)}><span /></button>
      {scope==='private'&&!publishedToSelected&&<button type="button" className="connect-apps-action" disabled={Boolean(busy)||!selectedTarget} title={!selectedTarget?'Join a team workspace to publish Skills.':undefined} onClick={()=>void publication(skill,'publish')}>Publish</button>}
      {scope==='private'&&publishedToSelected&&<>
        {outOfSyncForSelected&&<button type="button" className="connect-apps-action" disabled={Boolean(busy)} onClick={()=>void publication(skill,'sync')}>Sync</button>}
        <button type="button" className="connect-apps-action" disabled={Boolean(busy)} onClick={()=>void publication(skill,'unpublish')}>Unpublish</button>
      </>}
      {scope==='private'&&publishedToSelected&&<button type="button" className="connect-apps-action" disabled={Boolean(busy)} onClick={()=>void copyLink(skill)}>Copy link</button>}
    </div>
  </article>};
  return <div className="connect-apps-overlay" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}><section ref={dialog} className="connect-apps-dialog" role="dialog" aria-modal="true" aria-labelledby="connect-apps-title" tabIndex={-1} onKeyDown={onKeyDown}>
    <header><div><strong id="connect-apps-title">Connect apps</strong><small>{botName}</small></div><button ref={closeButton} type="button" aria-label="Close Connect apps" onClick={onClose}>×</button></header>
    <section className="connect-apps-skills" aria-labelledby="private-skills-title">
      <div className="connect-apps-section-heading"><h2 id="private-skills-title">Private skills</h2><span>{privateSkills.filter(skill=>skill.enabled).length} enabled</span></div>
      <p>Enable a Skill for this Bot. Your private Skills are shared across your Bots and can be enabled separately.</p>
      {state==='ready'&&publishTargets.length>0&&<label className="connect-apps-publish-target">Publish to <select aria-label="Publish to team" value={selectedTargetId} onChange={event=>setSelectedTargetId(event.target.value)}>{publishTargets.map(target=><option key={target.tenantId} value={target.tenantId}>{target.name} · {target.memberCount} members</option>)}</select></label>}
      {state==='ready'&&publishTargets.length===0&&<p className="connect-apps-share-note">Join a team workspace to publish Skills.</p>}
      {state==='loading'?<div className="connect-apps-empty">Loading Skills…</div>:state==='error'?<div className="connect-apps-empty" role="alert">Skills are unavailable right now.</div>:privateSkills.length? <div className="connect-apps-skill-list">{privateSkills.map(skill=>skillCard(skill,'private'))}</div>:<div className="connect-apps-empty">No Skills in your library yet. Ask a Bot to save a completed process as a Skill.</div>}
      {state==='ready'&&botOnlySkills.length>0&&<><div className="connect-apps-section-heading connect-apps-subheading"><h2>Bot-only skills</h2><span>{botOnlySkills.length}</span></div><div className="connect-apps-skill-list">{botOnlySkills.map(skill=>skillCard(skill,'bot'))}</div></>}
      {state==='ready'&&<><div className="connect-apps-section-heading connect-apps-subheading"><h2>Team skills</h2><span>{teamSkills.filter(skill=>skill.enabled).length} enabled</span></div><p>Published Skills from your team. Enable one to make it available to this Bot.</p>{teamSkills.length?<div className="connect-apps-skill-list">{teamSkills.map(skill=>skillCard(skill,'team'))}</div>:<div className="connect-apps-empty">No Skills have been published to this workspace.</div>}</>}
      {error&&<p className="connect-apps-error" role="alert">{error}</p>}{notice&&<p className="connect-apps-notice" role="status">{notice}</p>}
    </section>
  </section></div>;
}

function ComputerPanel({name,botId,official=false,bot,onClose,onRename,onSaveName,onLabelChange,onSaveLabel,onChangeAvatar,onEditRoutine}:{name:string;botId:string;official?:boolean;bot?:Bot;onClose?:()=>void;onRename?:(value:string)=>void;onSaveName?:()=>void;onLabelChange?:(value:string)=>void;onSaveLabel?:()=>void;onChangeAvatar?:()=>void;onEditRoutine?:(name:string)=>void}) {
  const [owner,setOwner]=useState<'agent'|'user'|null>(null),[image,setImage]=useState(''),[error,setError]=useState(''),[diagnostic,setDiagnostic]=useState(''),[busy,setBusy]=useState(false),[text,setText]=useState('');
  const [screenStale,setScreenStale]=useState(false);
  const [screenOpen,setScreenOpen]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [routines,setRoutines]=useState<Routine[]>([]),[routineState,setRoutineState]=useState<'loading'|'ready'|'error'>('loading');
  const [routineDetailId,setRoutineDetailId]=useState(''),[routineDeleteConfirm,setRoutineDeleteConfirm]=useState(false);
  const [routineBusy,setRoutineBusy]=useState(false),[routineError,setRoutineError]=useState('');
  const [routineWebhook,setRoutineWebhook]=useState<RoutineWebhook|null>(null),[routineWebhookState,setRoutineWebhookState]=useState<'idle'|'loading'|'ready'|'error'>('idle'),[routineWebhookNotice,setRoutineWebhookNotice]=useState('');
  const previewButton=useRef<HTMLButtonElement>(null);
  const closeScreenButton=useRef<HTMLButtonElement>(null);
  const screenDialog=useRef<HTMLElement>(null);
  const screenControlButton=useRef<HTMLButtonElement>(null);
  const screenFrame=useRef<HTMLIFrameElement>(null);
  const lastScreenOwner=useRef<'agent'|'user'|null>(owner);
  const [screenFullscreen,setScreenFullscreen]=useState(false);
  const imageUrl=useRef(''),inFlight=useRef(false),mounted=useRef(true);
  const computerUrl=`${import.meta.env.BASE_URL}api/bots/${encodeURIComponent(botId)}/computer`;
  const noVncViewer=`${computerUrl}/vnc/viewer.html`;
  const routinesUrl=`${import.meta.env.BASE_URL}api/bots/${encodeURIComponent(botId)}/routines`;
  const selectedRoutine=routines.find(routine=>routine.id===routineDetailId);
  const webhookUrl=routineWebhook?new URL(`${import.meta.env.BASE_URL.replace(/\/$/,'')}${routineWebhook.endpointPath}`,window.location.origin).toString():'';
  const loadRoutines=async(signal?:AbortSignal)=>{
    const response=await fetch(routinesUrl,{credentials:'same-origin',cache:'no-store',signal});
    if(!response.ok)throw new Error('Could not load routines');
    const value=await response.json() as {routines?:unknown};
    if(!Array.isArray(value.routines))throw new Error('Invalid routine response');
    setRoutines(value.routines as Routine[]);setRoutineState('ready');
  };
  useEffect(()=>{
    mounted.current=true;let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,consecutiveFailures=0;const controller=new AbortController();
    setOwner(null);setImage('');setScreenStale(false);setDiagnostic('');
    if(imageUrl.current)URL.revokeObjectURL(imageUrl.current);imageUrl.current='';
    const responseDiagnostic=async(response:Response,phase:string)=>{
      let code='',upstreamStatus:number|undefined;
      try{const body=await response.clone().json() as {diagnostic?:{code?:unknown;status?:unknown}}|null;const metadata=body?.diagnostic;const reportedStatus=metadata?.status;if(typeof metadata?.code==='string'&&/^(?:COMPUTER_[A-Z0-9_]+|INTERNAL_FAILURE)$/.test(metadata.code))code=metadata.code;if(typeof reportedStatus==='number'&&Number.isInteger(reportedStatus)&&reportedStatus>=100&&reportedStatus<=599)upstreamStatus=reportedStatus}catch{/* Keep the diagnostic limited to the HTTP status. */}
      return `${phase}: HTTP ${response.status}${code?` · ${code}`:''}${upstreamStatus!==undefined?` · upstream ${upstreamStatus}`:''}`;
    };
    const refresh=async()=>{let phase='Computer status request',failure='';try{
      const status=await fetch(computerUrl,{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!status.ok){failure=await responseDiagnostic(status,phase);throw new Error()}
      phase='Computer status response';const state=await status.json() as {owner?:unknown};if(state.owner!=='agent'&&state.owner!=='user'){failure=`${phase}: invalid response`;throw new Error()}
      setOwner(state.owner);
      phase='Computer screenshot request';const screen=await fetch(`${computerUrl}/screenshot`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!screen.ok){failure=await responseDiagnostic(screen,phase);throw new Error()}
      if(screen.headers.get('content-type')?.split(';')[0]!=='image/png'){failure='Computer screenshot response: invalid image type';throw new Error()}
      phase='Computer screenshot image';const blob=await screen.blob();if(stopped)return;const next=URL.createObjectURL(blob),previous=imageUrl.current;imageUrl.current=next;setImage(next);setOwner(state.owner);setScreenStale(false);setDiagnostic('');consecutiveFailures=0;if(previous)URL.revokeObjectURL(previous);
    }catch{if(!stopped&&!controller.signal.aborted){consecutiveFailures+=1;if(phase==='Computer status request'||phase==='Computer status response')setOwner(null);setScreenStale(Boolean(imageUrl.current));setDiagnostic(failure||`${phase}: request failed`)}}finally{if(!stopped)timer=setTimeout(refresh,computerScreenRetryDelay(consecutiveFailures))}};
    void refresh();return ()=>{stopped=true;mounted.current=false;controller.abort();if(timer)clearTimeout(timer);if(imageUrl.current)URL.revokeObjectURL(imageUrl.current);imageUrl.current=''};
  },[computerUrl]);
  useEffect(()=>{
    if(!official)return;
    let stopped=false;const controller=new AbortController();let timer:ReturnType<typeof setInterval>|undefined;
    setRoutineState('loading');setRoutines([]);setRoutineDetailId('');
    const refresh=async()=>{try{await loadRoutines(controller.signal);if(!stopped)setRoutineError('')}catch{if(!stopped&&!(controller.signal.aborted)){setRoutineState('error');setRoutineError('Could not load routines.')}}};
    void refresh();timer=setInterval(()=>void refresh(),15000);
    return()=>{stopped=true;controller.abort();if(timer)clearInterval(timer)};
  },[official,routinesUrl]);
  useEffect(()=>{
    if(!selectedRoutine||selectedRoutine.schedule.kind!=='webhook'){setRoutineWebhook(null);setRoutineWebhookState('idle');setRoutineWebhookNotice('');return}
    const controller=new AbortController();let stopped=false;
    setRoutineWebhook(null);setRoutineWebhookState('loading');setRoutineWebhookNotice('');
    void fetch(`${routinesUrl}/${encodeURIComponent(selectedRoutine.id)}/webhook`,{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error('Webhook configuration is unavailable.');
      const value=await response.json() as {webhook?:RoutineWebhook};
      if(!value.webhook||typeof value.webhook.endpointPath!=='string'||typeof value.webhook.key!=='string'||typeof value.webhook.authorizationHeader!=='string')throw new Error('Webhook configuration is invalid.');
      if(!stopped){setRoutineWebhook(value.webhook);setRoutineWebhookState('ready')}
    }).catch(()=>{if(!stopped&&!controller.signal.aborted)setRoutineWebhookState('error')});
    return()=>{stopped=true;controller.abort()};
  },[routinesUrl,selectedRoutine?.id,selectedRoutine?.schedule.kind]);
  useEffect(()=>{
    if(!screenOpen)return;
    const dialog=screenDialog.current;
    const inerted:Array<{element:HTMLElement;wasInert:boolean}>=[];
    let branch=dialog?.closest<HTMLElement>('.computer-screen-overlay')||null;
    while(branch?.parentElement&&branch.parentElement!==document.body){
      const parent=branch.parentElement;
      for(const sibling of Array.from(parent.children)){
        if(sibling===branch||!(sibling instanceof HTMLElement))continue;
        inerted.push({element:sibling,wasInert:sibling.inert});
        sibling.inert=true;
      }
      branch=parent;
    }
    closeScreenButton.current?.focus();
    const onFocusIn=(event:FocusEvent)=>{if(dialog&&event.target instanceof Node&&!dialog.contains(event.target))closeScreenButton.current?.focus()};
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setScreenOpen(false);return}
      if(event.key!=='Tab'||!dialog)return;
      const focusable=Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),iframe,[tabindex]:not([tabindex="-1"])')).filter(element=>element.getClientRects().length>0&&!element.closest('[inert]'));
      const first=focusable[0],last=focusable.at(-1),active=document.activeElement;
      if(!first||!last){event.preventDefault();dialog.focus();return}
      if(event.shiftKey&&(active===first||!dialog.contains(active))){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&(active===last||!dialog.contains(active))){event.preventDefault();first.focus()}
    };
    const onFullscreenChange=()=>setScreenFullscreen(document.fullscreenElement===screenDialog.current);
    onFullscreenChange();document.addEventListener('fullscreenchange',onFullscreenChange);
    document.addEventListener('focusin',onFocusIn,true);
    document.addEventListener('keydown',onKeyDown,true);
    return()=>{
      document.removeEventListener('keydown',onKeyDown,true);document.removeEventListener('fullscreenchange',onFullscreenChange);document.removeEventListener('focusin',onFocusIn,true);
      for(const {element,wasInert} of inerted)element.inert=wasInert;
      requestAnimationFrame(()=>previewButton.current?.focus());
    };
  },[screenOpen]);
  useEffect(()=>{
    if(lastScreenOwner.current===owner)return;
    lastScreenOwner.current=owner;
    if(!screenOpen)return;
    requestAnimationFrame(()=>{if(owner==='user')screenFrame.current?.focus();else screenControlButton.current?.focus()});
  },[owner,screenOpen]);
  const send=async(path:'control'|'action',body:unknown)=>{
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');
    try{const response=await fetch(`${computerUrl}/${path}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error();
      if(path==='control'){const result=await response.json() as {owner:'agent'|'user'};if(mounted.current)setOwner(result.owner)}
    }catch{if(mounted.current)setError('The operation could not be confirmed. Check the screen before trying again.')}finally{inFlight.current=false;if(mounted.current)setBusy(false)}
  };
  const toggleRoutine=async(routine:Routine)=>{
    if(routineBusy)return;setRoutineBusy(true);setRoutineError('');
    try{
      const response=await fetch(`${routinesUrl}/${encodeURIComponent(routine.id)}`,{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({paused:!routine.paused})});
      if(!response.ok)throw new Error();
      const value=await response.json() as {routine:Routine};setRoutines(current=>current.map(item=>item.id===routine.id?value.routine:item));
    }catch{setRoutineError('Could not update this routine.')}finally{setRoutineBusy(false)}
  };
  const testRoutine=async(routine:Routine)=>{
    if(routineBusy)return;setRoutineBusy(true);setRoutineError('');
    try{
      const response=await fetch(`${routinesUrl}/${encodeURIComponent(routine.id)}/test`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
      if(!response.ok)throw new Error();
      await loadRoutines();
    }catch{setRoutineError('Could not start a test run.')}finally{setRoutineBusy(false)}
  };
  const deleteRoutine=async(routine:Routine)=>{
    if(!routineDeleteConfirm){setRoutineDeleteConfirm(true);return}
    if(routineBusy)return;setRoutineBusy(true);setRoutineError('');
    try{
      const response=await fetch(`${routinesUrl}/${encodeURIComponent(routine.id)}`,{method:'DELETE',credentials:'same-origin'});
      if(!response.ok)throw new Error();
      setRoutineDetailId('');setRoutineDeleteConfirm(false);await loadRoutines();
    }catch{setRoutineError('Could not delete this routine.')}finally{setRoutineBusy(false)}
  };
  const copyRoutineWebhook=async(label:string,value:string)=>{
    try{await navigator.clipboard.writeText(value);setRoutineWebhookNotice(`${label} copied.`)}catch{setRoutineWebhookNotice(`Could not copy ${label.toLowerCase()}.`)}
  };
  const click=(event:React.MouseEvent<HTMLImageElement>)=>{if(owner!=='user'||busy)return;const rect=event.currentTarget.getBoundingClientRect();const x=Math.min(1439,Math.max(0,Math.floor((event.clientX-rect.left)*1440/rect.width))),y=Math.min(899,Math.max(0,Math.floor((event.clientY-rect.top)*900/rect.height)));void send('action',{action:'click',x,y})};
  const toggleScreenFullscreen=async()=>{const element=screenDialog.current;if(!element)return;try{if(document.fullscreenElement===element)await document.exitFullscreen();else await element.requestFullscreen()}catch{setError('Full-screen view is unavailable in this browser.')}};
  const controlLabel=owner==='user'?'You are in control':owner==='agent'?'Bot is in control':'Waiting for computer';
  if(!official)return <><div className="computer-preview" title={diagnostic||undefined}>{image ? <img src={image} alt="Current computer screen" onClick={click} /> : <><Icon name="screen" /><span>Computer not connected</span></>}</div>
    {screenStale&&image&&<p className="computer-screen-stale" role="status">Screen update delayed · showing the last received screen.</p>}
    <div className="screen-label" title={diagnostic||undefined}>{name || 'Bot'}'s screen · {controlLabel}</div><span className="sr-only" role="status" aria-live="polite">{diagnostic}</span>
    {owner && <div className="computer-controls"><button type="button" disabled={busy} onClick={()=>void send('control',{owner:owner==='agent'?'user':'agent'})}>{owner==='agent'?'Take control':'Return to Bot'}</button>
      {owner==='user' && <><form onSubmit={event=>{event.preventDefault();if(text){void send('action',{action:'type',text});setText('')}}}><input aria-label="Type on computer" value={text} maxLength={2000} onChange={event=>setText(event.target.value)} /><button disabled={busy||!text}>Type</button></form><button type="button" disabled={busy} onClick={()=>void send('action',{action:'press',key:'Enter'})}>Enter</button><p>Click the screen to interact. The image refreshes every few seconds.</p></>}</div>}
    {error && <p role="alert">{error}</p>}
  </>;
  return <div className="computer-panel-live">
    <header className="computer-panel-header">
      {settingsOpen||selectedRoutine ? <><button type="button" aria-label={settingsOpen?'Back to computer':'Back to routines'} onClick={()=>{if(settingsOpen)setSettingsOpen(false);else{setRoutineDetailId('');setRoutineDeleteConfirm(false)}}}><Icon name="back" /></button><strong>{settingsOpen?'Settings':selectedRoutine?.name}</strong></> : <span />}
      <div>
        {!settingsOpen&&!selectedRoutine && <button type="button" aria-label="Agent settings" onClick={()=>setSettingsOpen(true)}><Icon name="gear" /></button>}
        <button type="button" aria-label="Close computer" onClick={onClose}><Icon name="close" /></button>
      </div>
    </header>
    {settingsOpen ? <div className="computer-settings">
      {bot && <button type="button" className="avatar-edit" aria-label="Change Bot picture" onClick={onChangeAvatar}><Avatar bot={bot} size={72} /></button>}
      <label>Name<input aria-label="Name" value={bot?.name||name} onChange={event=>onRename?.(event.currentTarget.value)} onBlur={onSaveName} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}} /></label>
      <label>Title (optional)<input aria-label="Title (optional)" placeholder="Add a label" value={bot?.label||''} onChange={event=>onLabelChange?.(event.currentTarget.value)} onBlur={onSaveLabel} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}} /></label>
    </div> : selectedRoutine ? <section className="computer-routine-detail" aria-label={`Routine ${selectedRoutine.name}`}>
      <div className="routine-detail-schedule"><span>When to run</span><strong>{selectedRoutine.paused?'Paused':selectedRoutine.when}</strong>{selectedRoutine.schedule.kind!=='webhook'&&<small>{selectedRoutine.timezone}</small>}</div>
      <div className="routine-detail-instruction"><span>Instruction</span><p>{selectedRoutine.instruction}</p></div>
      {!selectedRoutine.paused&&selectedRoutine.nextRunAt&&<p className="routine-next-run">Next run · {new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:selectedRoutine.timezone}).format(new Date(selectedRoutine.nextRunAt))}</p>}
      {selectedRoutine.schedule.kind==='webhook'&&<section className="routine-webhook" aria-label="Webhook"><h2>Webhook</h2>
        {routineWebhookState==='loading'?<p>Loading webhook details…</p>:routineWebhookState==='error'?<p role="alert">Webhook configuration is unavailable.</p>:routineWebhook&&<>
          <div className="routine-webhook-field"><span>POST to</span><code>{webhookUrl}</code><button type="button" onClick={()=>void copyRoutineWebhook('URL',webhookUrl)}>Copy</button></div>
          <div className="routine-webhook-field"><span>key</span><code>{routineWebhook.key}</code><button type="button" onClick={()=>void copyRoutineWebhook('Key',routineWebhook.key)}>Copy</button></div>
          <div className="routine-webhook-field"><span>header</span><code>Authorization: {routineWebhook.authorizationHeader}</code><button type="button" onClick={()=>void copyRoutineWebhook('Header',`Authorization: ${routineWebhook.authorizationHeader}`)}>Copy</button></div>
          {routineWebhookNotice&&<p role="status">{routineWebhookNotice}</p>}
        </>}
      </section>}
      <section className="routine-history" aria-label="Run history"><h2>Run history</h2>{selectedRoutine.runs.length?selectedRoutine.runs.map(run=><div className="routine-history-row" key={run.id}><strong>{run.status==='queued'?'Queued':run.status==='running'?'Running':run.status==='completed'?'Succeeded':'Failed'}</strong><time dateTime={run.scheduledFor}>{new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:selectedRoutine.timezone}).format(new Date(run.scheduledFor))}</time>{run.result&&<p>{run.result}</p>}</div>):<p>No runs yet.</p>}</section>
      {routineDeleteConfirm?<div className="routine-delete-confirm" role="group" aria-label="Confirm delete routine"><p>Delete this routine? Future runs will stop.</p><button type="button" disabled={routineBusy} onClick={()=>setRoutineDeleteConfirm(false)}>Keep routine</button><button type="button" disabled={routineBusy} onClick={()=>void deleteRoutine(selectedRoutine)}>Delete routine</button></div>:<footer className="routine-actions"><button type="button" disabled={routineBusy} onClick={()=>{setRoutineDetailId('');onEditRoutine?.(selectedRoutine.name)}}>Edit</button><button type="button" disabled={routineBusy} onClick={()=>void toggleRoutine(selectedRoutine)}>{selectedRoutine.paused?'Resume':'Pause'}</button><button type="button" disabled={routineBusy} onClick={()=>void testRoutine(selectedRoutine)}>Test</button><button type="button" disabled={routineBusy} onClick={()=>void deleteRoutine(selectedRoutine)} aria-label="Delete routine">Delete</button></footer>}
      {routineError&&<p role="alert">{routineError}</p>}
    </section> : <>
      <button ref={previewButton} type="button" className="computer-preview-button" aria-label="Open screen" title={diagnostic||undefined} onClick={()=>setScreenOpen(true)}>
        {image ? <img src={image} alt="Current computer screen" /> : <span className="computer-preview-empty"><Icon name="screen" /><span>Computer not connected</span></span>}
        <span className="computer-open-screen"><Icon name="screen" /><span>Open screen</span></span>
      </button>
      {screenStale&&image&&<p className="computer-screen-stale" role="status">Screen update delayed · showing the last received screen.</p>}
      <div className="screen-label" title={diagnostic||undefined}>{name || 'Bot'}’s screen</div>
      <section className="computer-routines" aria-label="Routines">
        <header><h2>Routines</h2></header>
        {routineState==='loading'?<p>Loading routines…</p>:routineState==='error'?<p>Routines are unavailable right now.</p>:routines.length?<div className="computer-routine-list">{routines.map(routine=><div className="computer-routine-row" key={routine.id}>
          <button type="button" className="computer-routine-open" aria-label={`${routine.name}, ${routine.paused?'Paused':routine.when}`} onClick={()=>setRoutineDetailId(routine.id)}><Icon name="clock" /><span><strong>{routine.name}</strong><small>{routine.paused?'Paused':routine.when}</small></span></button>
          <button type="button" role="switch" aria-checked={!routine.paused} aria-label={`${routine.paused?'Resume':'Pause'} ${routine.name}`} disabled={routineBusy} onClick={()=>void toggleRoutine(routine)}><span /></button>
        </div>)}</div>:<p>Ask in chat to set a routine.</p>}
        {routineError&&<p className="routine-error" role="alert">{routineError}</p>}
      </section>
      <span className="sr-only" role="status" aria-live="polite">{diagnostic}</span>
      {error && <p role="alert">{error}</p>}
    </>}
    {screenOpen && <div className="computer-screen-overlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setScreenOpen(false)}}>
      <section ref={screenDialog} className="computer-screen-dialog" role="dialog" aria-modal="true" aria-label={name + "'s computer screen"}>
        <header>
          <span className={`computer-screen-status${owner?' connected':''}`}><i aria-hidden="true" />{controlLabel}</span>
          <div className="computer-screen-actions">
            {owner && <button ref={screenControlButton} type="button" disabled={busy} onClick={()=>void send('control',{owner:owner==='agent'?'user':'agent'})}>{owner==='agent'?'Take control':'Return to Bot'}</button>}
            <button type="button" aria-label={screenFullscreen?'Exit computer full screen':'Enter computer full screen'} onClick={()=>void toggleScreenFullscreen()}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={screenFullscreen?'M8 3v5H3M16 3v5h5M8 21v-5H3m13 5v-5h5':'M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5'} /></svg>
            </button>
            <button ref={closeScreenButton} type="button" aria-label="Close screen" onClick={()=>setScreenOpen(false)}><Icon name="close" /></button>
          </div>
        </header>
        <div className="computer-large-screen">{owner==='user'
          ? <iframe ref={screenFrame} key={`${botId}-user-control`} title={`${name || 'Bot'} cloud computer`} src={noVncViewer} allow="clipboard-read; clipboard-write" />
          : image ? <img src={image} alt="Current computer screen" onClick={click} /> : <span>Computer not connected</span>}</div>
        {screenStale&&image&&<p className="computer-screen-stale" role="status">Screen update delayed · showing the last received screen.</p>}
        {error&&<span className="sr-only" role="status">{error}</span>}
      </section>
    </div>}
  </div>;
}

function ComputerActivityCard({run,botId,showScreen,onOpenComputer,children}:{run:AgentRun;botId:string;showScreen:boolean;onOpenComputer:()=>void;children?:React.ReactNode}) {
  const [image,setImage]=useState('');
  const [unavailable,setUnavailable]=useState(false);
  const [screenStale,setScreenStale]=useState(false);
  const imageUrl=useRef('');
  const imageOwnerKey=useRef('');
  const cardElement=useRef<HTMLElement|null>(null);
  const [cardVisible,setCardVisible]=useState(false);
  const failureHeadline=(run.status==='unknown'||run.status==='failed')?runFailureHeadline(run):null;
  const status=failureHeadline?(run.failureComponent==='model-gateway'?'Model error':run.failureComponent==='agent-runtime'?'Agent error':run.failureComponent==='scheduler'?'Task handling error':run.failureComponent==='computer-worker'?'Computer error':'Failed'):run.status==='running'?'Working':run.status==='queued'?'Queued':run.status==='completed'?'Done':run.status==='failed'?'Failed':'Not confirmed';
  const diagnostic=(run.status==='unknown'||run.status==='failed')?runFailureDescription(run):null;
  useEffect(()=>{
    const element=cardElement.current;
    if(!element||typeof IntersectionObserver==='undefined'){setCardVisible(true);return}
    const observer=new IntersectionObserver(entries=>setCardVisible(Boolean(entries[0]?.isIntersecting)),{rootMargin:'240px 0px'});
    observer.observe(element);
    return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!showScreen||run.status==='queued'||!cardVisible)return;
    const ownerKey=`${botId}:${run.id}`;
    if(imageOwnerKey.current!==ownerKey){if(imageUrl.current)URL.revokeObjectURL(imageUrl.current);imageUrl.current='';imageOwnerKey.current=ownerKey;setImage('');setUnavailable(false);setScreenStale(false)}
    let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,consecutiveFailures=0;
    const controller=new AbortController();
    const refresh=async()=>{
      try{
        const response=await fetch(`${import.meta.env.BASE_URL}api/bots/${encodeURIComponent(botId)}/computer/screenshot`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
        if(!response.ok||response.headers.get('content-type')?.split(';')[0]!=='image/png')throw new Error();
        const next=URL.createObjectURL(await response.blob());if(stopped){URL.revokeObjectURL(next);return}
        const previous=imageUrl.current;imageUrl.current=next;setImage(next);setUnavailable(false);setScreenStale(false);consecutiveFailures=0;if(previous)URL.revokeObjectURL(previous);
      }catch(error){if(!stopped&&error instanceof Error&&error.name!=='AbortError'){consecutiveFailures+=1;setScreenStale(Boolean(imageUrl.current));if(!imageUrl.current)setUnavailable(true)}}
      finally{if(!stopped&&run.status==='running')timer=setTimeout(refresh,computerScreenRetryDelay(consecutiveFailures))}
    };
    void refresh();
    return()=>{stopped=true;controller.abort();if(timer)clearTimeout(timer)};
  },[botId,cardVisible,run.id,run.status,showScreen]);
  useEffect(()=>()=>{if(imageUrl.current)URL.revokeObjectURL(imageUrl.current);imageUrl.current='';imageOwnerKey.current=''},[]);
  const toolLabel=(tool:string)=>tool==='computer_browser'?'Browser User':tool==='computer_desktop'?'Computer User':tool==='computer_files'?'Computer files':tool==='computer_terminal'?'Computer terminal':tool==='open_public_page'?'Public page':tool==='bot_handoff'?'Bot handoff':tool==='bot_memory'?'Bot memory':tool==='bot_routines'?'Bot routines':tool;
  return <section ref={cardElement} className="computer-activity-card" aria-label={`Computer activity · ${status}`}>
    <header><strong>Computer</strong><span className={`computer-activity-status ${failureHeadline?'failed':run.status}`}><i />{status}</span></header>
    {run.prompt.trim()&&<p className="computer-activity-prompt">{run.prompt}</p>}
    {children}
    {failureHeadline&&<div className="computer-activity-failure"><strong>{failureHeadline}</strong>{diagnostic&&<span>{diagnostic}</span>}</div>}
    {showScreen&&image?<button type="button" className="computer-activity-screen" onClick={onOpenComputer} aria-label="Open this Bot's computer"><img src={image} alt="Current cloud computer screen" /></button>:<button type="button" className="computer-activity-open" onClick={onOpenComputer}>{unavailable?'Open computer to inspect the screen':'View computer screen'}</button>}
    {screenStale&&image&&<p className="computer-screen-stale" role="status">Screen update delayed · showing the last received screen.</p>}
    {run.executionAudit&&<details className="computer-activity-audit"><summary>Execution details</summary><div className="computer-activity-audit-body"><span>{run.executionAudit.engine==='dsh'?'DeepSeek Harness':'Pi'} · {run.executionAudit.model} · {run.executionAudit.modelCompleted?'response received':'response not confirmed'}</span>{run.executionAudit.calls.map((call,index)=><span key={`${call.tool}-${call.action||''}-${index}`}>{toolLabel(call.tool)}{call.action?` · ${call.action}`:''} · {call.outcome}</span>)}{run.executionAudit.truncated&&<span>Additional tool calls omitted</span>}</div></details>}
    <RunTraceButton runId={run.id}/>
  </section>;
}

function RunTraceButton({runId,compact=false}:{runId:string;compact?:boolean}) {
  const [open,setOpen]=useState(false);
  const [state,setState]=useState<{status:'loading'|'ready'|'error';events:RunTraceEntry[];error?:string;storage?:{read:'ok'|'failed';databaseCode?:string}}>({status:'loading',events:[]});
  const load=async()=>{
    setOpen(true);setState({status:'loading',events:[]});
    try{
      const response=await fetch(`${import.meta.env.BASE_URL}api/runs/${encodeURIComponent(runId)}/trace`,{credentials:'same-origin',cache:'no-store'});
      if(!response.ok){
        const value=await response.json().catch(()=>null) as {error?:unknown;databaseCode?:unknown}|null;
        const databaseCode=typeof value?.databaseCode==='string'&&/^[A-Z0-9_]{1,64}$/.test(value.databaseCode)?value.databaseCode:null;
        setState({status:'error',events:[],error:`Task call-chain query failed · HTTP ${response.status}${databaseCode?` · MySQL ${databaseCode}`:''}${value?.error==='RUN_TRACE_READ_FAILED'?' · run trace read failed':''}.`});return;
      }
      const value=await response.json() as {events?:RunTraceEntry[];storage?:{read?:unknown;databaseCode?:unknown}};
      if(!Array.isArray(value.events)){setState({status:'error',events:[],error:'The trace response did not contain an event list.'});return;}
      const storage={read:value.storage?.read==='failed'?'failed' as const:'ok' as const,...(typeof value.storage?.databaseCode==='string'&&/^[A-Z0-9_]{1,64}$/.test(value.storage.databaseCode)?{databaseCode:value.storage.databaseCode}:{})};
      setState({status:'ready',events:value.events,storage});
    }catch{setState({status:'error',events:[],error:'The browser could not reach the trace API. Check the public app connection.'})}
  };
  const releaseIds=[...new Set(state.events.map(event=>event.releaseId).filter((value):value is string=>Boolean(value)))];
  const componentLabels:Record<RunTraceEntry['component'],string>={'control-plane':'Auth / control plane',scheduler:'Task scheduler','agent-runtime':'Pi / DeepSeek Harness','model-gateway':'Model gateway','computer-worker':'Cloud computer worker',mysql:'MySQL'};
  const eventLabels:Record<string,string>={'run.queued':'Task queued','run.claimed':'Task claimed','run.execution':'Task execution result','run.lease_lost':'Task lease renewal','run.persist':'Save task result','run.persist.attempt':'Result save attempt','desktop.connect':'Cloud computer connection','agent.dispatch':'Agent runtime request','agent.result':'Agent response','agent.queue':'Agent queue wait','agent.computer.control':'Agent computer-control check','agent.adapter.start':'Start Agent adapter process','agent.adapter.exit':'Agent adapter process exit','agent.result.parse':'Validate Agent adapter result','model.request':'Model request','computer.control':'Computer control check','computer.inspect':'Computer page inspection','computer.screenshot':'Computer screen read','computer.status':'Computer status check','computer.propose':'Computer action prepared','computer.execute':'Computer action executed','mysql.trace.write':'Persist call-chain event','mysql.trace.read':'Read call-chain history','mysql.trace.validation':'Validate call-chain event','run.persisted':'Result saved','run.outcome_unknown':'Outcome marked unknown'};
  const diagnosticLabels:Record<string,string>={
    MODEL_UPSTREAM_REJECTED:'The model provider returned an HTTP error.',MODEL_GATEWAY_UPSTREAM_FAILURE:'The model gateway could not complete its provider request.',MODEL_UPSTREAM_RATE_LIMITED:'The model provider rate-limited the request.',MODEL_GATEWAY_CALL_LIMIT:'The task reached its model call limit.',RUN_TRACE_READ_FAILED:'The saved task call chain could not be read.',RUN_TRACE_WRITE_FAILED:'This diagnostic event could not be saved to MySQL.',RUN_TRACE_EVENT_REJECTED:'The trace validator rejected an event before saving it.',COMPUTER_CONTROL_CHECK_FAILED:'The Agent runtime could not read the cloud computer control state.',COMPUTER_OWNER_USER:'The cloud computer was under user control, so the Agent paused.',COMPUTER_OWNER_UNKNOWN:'The Agent could not confirm computer ownership.',AGENT_ADAPTER_SPAWN_FAILED:'The Agent adapter process could not start.',AGENT_ADAPTER_NONZERO_EXIT:'The Agent adapter process exited with a nonzero code.',AGENT_ADAPTER_SIGNAL_EXIT:'The Agent adapter process was stopped by an operating-system signal.',AGENT_ADAPTER_TIMEOUT:'The Agent adapter exceeded its execution time limit.',AGENT_ADAPTER_OUTPUT_INVALID:'The Agent adapter output was not valid task-result JSON.',
    MODEL_GATEWAY_REQUEST_REJECTED:'The model gateway rejected the request before calling the provider.',MODEL_GATEWAY_CAPABILITY_REJECTED:'The model gateway rejected the Agent capability.',MODEL_UPSTREAM_MISSING_BODY:'The provider returned success without a response body.',MODEL_GATEWAY_STREAM_INTERRUPTED:'The provider accepted the request, but its response stream ended early.',
    agent_adapter_failed:'The Agent adapter exited before returning a task result.',agent_adapter_output_invalid:'The Agent returned a result that failed validation.',agent_transport_failed:'The connection to the Agent runtime failed.',agent_reported_failure:'The Agent returned a failed task result.',
    RUN_RESULT_PERSIST_FAILED:'The task finished, but saving the result failed.',RUN_RESULT_NOT_PERSISTED:'The save transaction did not update the active run.',run_persist_failed:'The task result could not be saved to the database.',lease_expired:'The task lease expired before completion was recorded.',lease_lost:'The task lease was lost before completion was recorded.',
    COMPUTER_BROWSER_ACTION_FAILED:'Unclassified browser action failure',COMPUTER_BROWSER_ACTION_TIMEOUT:'Browser action timed out; outcome needs inspection',COMPUTER_BROWSER_NAVIGATION_ABORTED:'Navigation was interrupted',COMPUTER_BROWSER_NAVIGATION_NETWORK_FAILED:'Chromium could not load the destination',COMPUTER_BROWSER_NAVIGATION_FAILED:'Navigation failed before completion',COMPUTER_BROWSER_CONTROL_ACTION_FAILED:'Browser control action failed',COMPUTER_BROWSER_CONTEXT_CLOSED:'Browser page or context closed during the action',COMPUTER_BROWSER_PAGE_INSPECTION_FAILED:'Page inspection failed',COMPUTER_BROWSER_ARTIFACT_OPEN_FAILED:'Task artifact could not be opened',COMPUTER_BROWSER_TARGET_NOT_FOUND:'No visible control matched',COMPUTER_BROWSER_TARGET_AMBIGUOUS:'More than one visible control matched',COMPUTER_STATE_CHANGED:'Page or computer owner changed during the action',COMPUTER_RENDERER_UNRESPONSIVE:'Chromium did not respond'};
  const reasonLabels:Record<string,string>={
    request_content_type_invalid:'Request content-type was not JSON',request_body_too_large:'Request body exceeded the gateway limit',request_json_invalid:'Request body was not valid JSON',request_shape_invalid:'Request JSON had the wrong top-level shape',model_name_mismatch:'Requested model did not match gateway configuration',messages_invalid:'Messages were missing, empty, or over the limit',max_tokens_invalid:'max_tokens was outside the supported range',stream_flag_invalid:'stream was not a boolean',capability_invalid:'Agent capability was missing, expired, or no longer valid',call_budget_exhausted:'The run exhausted its model-call budget',provider_http_rejected:'Provider returned a non-success HTTP response',provider_rate_limited:'Provider returned HTTP 429',provider_cooldown_active:'Gateway cooldown blocked a new provider request',provider_transport_failed:'The provider connection failed',provider_request_failed:'The provider request failed without a classified transport code',provider_response_stream_interrupted:'Provider response streaming ended before completion',provider_response_missing_body:'Provider response did not include a body',database_deadlock:'Database transaction hit a deadlock',database_lock_timeout:'Database lock wait timed out',database_connection:'Database connection failed',database_error:'Database write failed with an unclassified database error',trace_write_failed:'Run trace write failed',lease_lost:'Task lease could not be renewed',execution_aborted:'Task execution was interrupted',executor_failed:'Executor failed before it returned a result',result_persistence_failed:'Task result persistence failed',finish_not_applied:'The result-save transaction did not update the active task',agent_timeout:'The Agent exceeded its execution limit'};
  const upstreamErrorLabels:Record<string,string>={request_invalid:'Provider classified the request as invalid',authentication_rejected:'Provider rejected authentication',model_not_found:'Provider could not find the configured model',context_limit:'Provider context or token limit was exceeded',rate_limited:'Provider rate limit was reached',quota_exhausted:'Provider quota or billing limit was reached',permission_denied:'Provider denied this request',provider_server_error:'Provider returned a server error',provider_unavailable:'Provider service was unavailable',content_filtered:'Provider content filter rejected the request',unknown:'Provider error category was not recognized'};
  const httpStatusLabel=(component:RunTraceEntry['component'])=>component==='agent-runtime'?'Agent HTTP':component==='model-gateway'?'Model gateway HTTP':component==='computer-worker'?'Computer worker HTTP':component==='control-plane'?'Control plane HTTP':'HTTP';
  const upstreamHttpStatusLabel=(component:RunTraceEntry['component'])=>component==='agent-runtime'?'Model endpoint HTTP':component==='model-gateway'?'Provider upstream HTTP':'Upstream HTTP';
  const actionLabels:Record<string,string>={inspect:'page inspection',navigate:'navigation',open_artifact:'artifact open',upload_file:'file upload',click:'click',fill:'text entry',select:'selection',check:'checkbox check',uncheck:'checkbox clear',press:'key press',open:'desktop open',type:'desktop text entry',unknown:'unknown action'};
  const traceEventLabel=(event:string)=>{
    const match=event.match(/^computer\.(propose|execute)\.(browser|desktop)\.([a-z_-]+)$/);
    if(!match)return eventLabels[event]||event;
    const action=actionLabels[match[3]]||'action';
    const channel=match[2]==='browser'?'Browser':'Desktop';
    return `${channel} ${action} ${match[1]==='propose'?'prepared':'executed'}`;
  };
  const outcomeLabels:Record<RunTraceEntry['outcome'],string>={started:'In progress',succeeded:'Succeeded',failed:'Failed',info:'Info'};
  const stageLabels=failureStageLabels;
  const failurePriority:Record<RunTraceEntry['component'],number>={'computer-worker':0,'model-gateway':0,'agent-runtime':1,'control-plane':2,scheduler:3,mysql:4};
  const wrapperFailureEvents=['agent.dispatch','agent.result','agent.adapter.exit'];
  const primaryFailure=[...state.events].filter(event=>event.outcome==='failed').sort((a,b)=>failurePriority[a.component]-failurePriority[b.component]||Number(wrapperFailureEvents.includes(a.event))-Number(wrapperFailureEvents.includes(b.event))||b.sequence-a.sequence)[0];
  const unfinishedEvents=state.events.filter(event=>event.outcome==='started'&&!state.events.some(later=>later.sequence>event.sequence&&later.component===event.component&&later.event===event.event&&later.attemptNumber===event.attemptNumber&&(later.outcome==='succeeded'||later.outcome==='failed')));
  const lastUnfinished=unfinishedEvents.at(-1);
  const primaryFailureTitle=primaryFailure?`${componentLabels[primaryFailure.component]} · ${eventLabels[primaryFailure.event]||traceEventLabel(primaryFailure.event)}`:null;
  const primaryFailureDetails=primaryFailure?[primaryFailure.stage?`Stage: ${stageLabels[primaryFailure.stage]||primaryFailure.stage}`:null,primaryFailure.operation?`${primaryFailure.component==='agent-runtime'?'Agent':primaryFailure.component==='model-gateway'?'Gateway':primaryFailure.component==='mysql'?'Trace store':'Worker'} operation: ${primaryFailure.operation}`:null,primaryFailure.attemptNumber!==null?`Attempt ${primaryFailure.attemptNumber}`:null,primaryFailure.durationMs!==null?`Duration ${primaryFailure.durationMs} ms`:null,primaryFailure.httpStatus?`${httpStatusLabel(primaryFailure.component)} ${primaryFailure.httpStatus}`:null,primaryFailure.upstreamHttpStatus?`${upstreamHttpStatusLabel(primaryFailure.component)} ${primaryFailure.upstreamHttpStatus}`:null,primaryFailure.requestBytes!==null&&primaryFailure.requestLimitBytes!==null?`Bytes read before rejection ${new Intl.NumberFormat('en-US').format(primaryFailure.requestBytes)} B · limit ${new Intl.NumberFormat('en-US').format(primaryFailure.requestLimitBytes)} B`:null,primaryFailure.upstreamErrorKind?upstreamErrorLabels[primaryFailure.upstreamErrorKind]||`Provider error category ${primaryFailure.upstreamErrorKind}`:null,primaryFailure.upstreamErrorCode?providerErrorCodeLabels[primaryFailure.upstreamErrorCode]||`Provider error code ${primaryFailure.upstreamErrorCode}`:null,primaryFailure.diagnosticCode?diagnosticLabels[primaryFailure.diagnosticCode]||agentRuntimeDiagnosticLabels[primaryFailure.diagnosticCode]||primaryFailure.diagnosticCode:null,primaryFailure.reasonCode?reasonLabels[primaryFailure.reasonCode]||agentFailureReasonLabels[primaryFailure.reasonCode]||primaryFailure.reasonCode:null,primaryFailure.adapterExitCode!==null?`Adapter exit ${primaryFailure.adapterExitCode}`:null,primaryFailure.adapterExitSignal?`Signal ${primaryFailure.adapterExitSignal}`:null,primaryFailure.databaseCode?`MySQL ${primaryFailure.databaseCode}`:null,primaryFailure.transportCode?`Transport ${primaryFailure.transportCode}`:null].filter(Boolean).join(' · '):null;
  const unfinishedDetails=lastUnfinished?[`${componentLabels[lastUnfinished.component]} · ${eventLabels[lastUnfinished.event]||traceEventLabel(lastUnfinished.event)}`,lastUnfinished.stage?`Stage: ${stageLabels[lastUnfinished.stage]||lastUnfinished.stage}`:null,lastUnfinished.operation?`Operation: ${lastUnfinished.operation}`:null,['agent-runtime','model-gateway','computer-worker','control-plane'].includes(lastUnfinished.component)?`${httpStatusLabel(lastUnfinished.component)} response was not recorded`:'No completion record was saved'].filter(Boolean).join(' · '):null;
  const traceIcon=<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h3l2 4.5 2-4.5h5M2 12.5h3l2-4.5 2 4.5h5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"/></svg>;
  return <>
    <button type="button" className={`run-trace-open${compact?' compact':''}`} aria-label={compact?'View task call chain':undefined} title="View task call chain" onClick={()=>void load()}>{compact?traceIcon:'View task call chain'}</button>
    {open&&<div className="run-trace-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setOpen(false)}}>
      <section className="run-trace-dialog" role="dialog" aria-modal="true" aria-labelledby={`run-trace-title-${runId}`}>
        <header><div><h2 id={`run-trace-title-${runId}`}>Task call chain</h2><p>Run {runId}</p></div><button type="button" aria-label="Close call chain" onClick={()=>setOpen(false)}>×</button></header>
        {releaseIds.length>0&&<p className={`run-trace-release ${releaseIds.length>1?'mismatch':''}`}>{releaseIds.length===1?`Release ${releaseIds[0]}`:`Mixed releases: ${releaseIds.join(', ')}`}</p>}
        {state.status==='loading'&&<p role="status">Loading run trace…</p>}
        {state.status==='error'&&<p role="alert">{state.error||'Could not load this run trace.'}</p>}
        {state.status==='ready'&&state.storage?.read==='failed'&&<section className="run-trace-primary-failure"><strong>Trace history read failed{state.storage.databaseCode?` · MySQL ${state.storage.databaseCode}`:''}</strong><span>The list below includes only diagnostic events retained in this service process. Persisted history may be incomplete.</span></section>}
        {state.status==='ready'&&!state.events.length&&<p>No persisted trace exists for this run. It may predate trace instrumentation, or trace writes may not have succeeded; the exact reason was not recorded.</p>}
        {state.status==='ready'&&state.events.length>0&&<p className="run-trace-summary">{state.events.length} recorded steps · {state.events.filter(event=>event.outcome==='failed').length} failed · {unfinishedEvents.length} unfinished</p>}
        {state.status==='ready'&&primaryFailure&&<section className="run-trace-primary-failure"><strong>Primary failure point · {primaryFailureTitle}</strong><span>{primaryFailureDetails}</span></section>}
        {state.status==='ready'&&lastUnfinished&&!(primaryFailure?.component===lastUnfinished.component&&primaryFailure.event===lastUnfinished.event)&&<section className="run-trace-primary-failure"><strong>Last unfinished step · {componentLabels[lastUnfinished.component]} · {traceEventLabel(lastUnfinished.event)}</strong><span>{unfinishedDetails}. This identifies where the trace stopped; it does not prove the underlying cause.</span></section>}
        {state.status==='ready'&&state.events.length>0&&<ol className="run-trace-list">{state.events.map(event=><li key={event.sequence} className={`run-trace-event ${event.outcome}`}>
          <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>
          <strong>#{event.sequence} · {componentLabels[event.component]} · {traceEventLabel(event.event)}</strong>
          <span>{outcomeLabels[event.outcome]}{event.attemptNumber!==null?` · call ${event.attemptNumber}`:''}{event.httpStatus?` · ${httpStatusLabel(event.component)} ${event.httpStatus}`:''}{event.upstreamHttpStatus?` · ${upstreamHttpStatusLabel(event.component)} ${event.upstreamHttpStatus}`:''}{event.durationMs!==null?` · ${event.durationMs} ms`:''}{event.retryAfterSeconds!==null?` · retry after ${event.retryAfterSeconds}s`:''}</span>
          {event.diagnosticCode&&<div className="run-trace-diagnostic"><span>{diagnosticLabels[event.diagnosticCode]||agentRuntimeDiagnosticLabels[event.diagnosticCode]||'A backend diagnostic was recorded'}</span><code>{event.diagnosticCode}</code></div>}
          {event.reasonCode&&<div className="run-trace-diagnostic"><span>{reasonLabels[event.reasonCode]||agentFailureReasonLabels[event.reasonCode]||'Recorded failure category'}</span><code>{event.reasonCode}</code></div>}
          {event.upstreamErrorKind&&<div className="run-trace-diagnostic"><span>{upstreamErrorLabels[event.upstreamErrorKind]||'Provider error category'}</span><code>{event.upstreamErrorKind}</code></div>}
          {event.upstreamErrorCode&&<div className="run-trace-diagnostic"><span>{providerErrorCodeLabels[event.upstreamErrorCode]||'Provider error code'}</span><code>{event.upstreamErrorCode}</code></div>}
          {(event.stage||event.operation||event.requestBytes!==null||event.transportCode||event.adapterExitCode!==null||event.adapterExitSignal||event.databaseCode||event.relatedEvent)&&<div className="run-trace-metadata">{event.stage&&<span>Stage: {stageLabels[event.stage]||event.stage}</span>}{event.operation&&<span>{event.component==='agent-runtime'?'Agent':event.component==='model-gateway'?'Gateway':event.component==='mysql'?'Trace store':'Worker'} operation: {event.operation}</span>}{event.requestBytes!==null&&event.requestLimitBytes!==null&&<span>Bytes read before rejection: <code>{new Intl.NumberFormat('en-US').format(event.requestBytes)} B</code> · limit <code>{new Intl.NumberFormat('en-US').format(event.requestLimitBytes)} B</code></span>}{event.adapterExitCode!==null&&<span>Adapter exit code: <code>{event.adapterExitCode}</code></span>}{event.adapterExitSignal&&<span>Exit signal: <code>{event.adapterExitSignal}</code></span>}{event.databaseCode&&<span>MySQL error code: <code>{event.databaseCode}</code></span>}{event.relatedEvent&&<span>Failed to record: {event.relatedComponent?`${componentLabels[event.relatedComponent]} · `:''}{traceEventLabel(event.relatedEvent)}</span>}{event.transportCode&&<span>Transport: <code>{event.transportCode}</code></span>}</div>}
          {event.source==='memory'&&<small>Diagnostic retained in memory only; it is not durable and will be lost when this service process restarts.</small>}
          {event.releaseId&&<small>Release {event.releaseId}</small>}
        </li>)}</ol>}
        <p className="run-trace-footnote">Operational metadata only. Prompts, page contents, provider messages, request bodies, and credentials are never included. A forced process kill can only report the last event that was persisted before it stopped.</p>
      </section>
    </div>}
  </>;
}

function PreviewApp({ account, onLogout }: { account?: Account; onLogout?: () => void }) {
  const reference = new URLSearchParams(window.location.search).get('reference') === '101-new-bot';
  const linkedSkillId = new URLSearchParams(window.location.search).get('skill') || '';
  const remote = Boolean(account) && !reference;
  const storageKey = account ? `${STORAGE_KEY}:${account.tenantId}:${account.userId}${remote ? ':server-chat-v1' : ''}` : STORAGE_KEY;
  const sidebarPreferenceKey = account ? `coke-grok-bot:sidebar-width:v1:${account.tenantId}:${account.userId}` : '';
  const [sidebarWidth, setSidebarWidth] = useState(() => initialProductSidebarWidth(sidebarPreferenceKey));
  const sidebarResizeStart = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const computerPanelPreferenceKey = account ? `coke-grok-bot:computer-panel-width:v2:${account.tenantId}:${account.userId}` : '';
  const computerPanelLegacyPreferenceKey = account ? `coke-grok-bot:computer-panel-width:v1:${account.tenantId}:${account.userId}` : '';
  const [computerPanelWidth, setComputerPanelWidth] = useState(() => initialProductPanelWidth(computerPanelPreferenceKey, sidebarWidth, computerPanelLegacyPreferenceKey));
  const computerPanelResizeStart = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [state, setState] = useState<PreviewState>(() => reference ? initialState(true) : safeStoredState(storageKey) || initialState(false));
  const [botStatus, setBotStatus] = useState<'loading' | 'ready' | 'error'>(remote ? 'loading' : 'ready');
  const [botError, setBotError] = useState('');
  const [savingBot, setSavingBot] = useState(false);
  const savingBotRef=useRef(false);
  const [createUncertain,setCreateUncertain]=useState(false);
  const [groupCreateDialog,setGroupCreateDialog]=useState<{name:string;botIds:string[];requestId:string}|null>(null);
  const [groupSaving,setGroupSaving]=useState(false);
  const [groupError,setGroupError]=useState('');
  const [groups,setGroups]=useState<GroupChat[]>([]);
  const [groupsStatus,setGroupsStatus]=useState<'loading'|'ready'|'error'>(remote?'loading':'ready');
  const [selectedGroupId,setSelectedGroupId]=useState('');
  const [groupChat,setGroupChat]=useState<{id:string;status:'loading'|'ready'|'error';view:GroupChatView|null}>({id:'',status:'loading',view:null});
  const [groupSending,setGroupSending]=useState(false);
  const [botMentionTokens,setBotMentionTokens]=useState<GroupMentionToken[]>([]);
  const [botMentionQuery,setBotMentionQuery]=useState<GroupMentionQuery|null>(null);
  const [botMentionActiveIndex,setBotMentionActiveIndex]=useState(0);
  const [groupRefresh,setGroupRefresh]=useState(0);
  const [groupComputerBotId,setGroupComputerBotId]=useState('');
  const groupSendingRef=useRef(false);
  const botMentionTokensRef=useRef<GroupMentionToken[]>([]);
  const botMentionCaretRef=useRef<number|null>(null);
  const groupComposer=useRef<HTMLTextAreaElement>(null);
  const [createDialog,setCreateDialog]=useState<{name:string;shape:Shape;color:string}|null>(null);
  const createName=useRef<HTMLInputElement>(null);
  const createDialogOpenRef=useRef(false);
  const createReturnFocus=useRef<HTMLElement|null>(null);
  const createTrigger=useRef<HTMLButtonElement|null>(null);
  createDialogOpenRef.current=Boolean(createDialog);
  const [newChat, setNewChat] = useState(false);
  const [recipientQuery, setRecipientQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState(false);
  const [panelSidebarExpanded, setPanelSidebarExpanded] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [connectAppsOpen,setConnectAppsOpen]=useState(false);
  const [teamDialogOpen,setTeamDialogOpen]=useState(false);
  const [hiddenOpen,setHiddenOpen]=useState(false);
  const sidebarQueue=useRef<Record<string,Promise<void>>>({});
  const sidebarSequence=useRef<Record<string,number>>({});
  const [sidebarMenu,setSidebarMenu]=useState<{id:string;x:number;y:number}|null>(null);
  const [sidebarRename,setSidebarRename]=useState<{id:string;value:string}|null>(null);
  const sidebarRenameRef=useRef<{id:string;value:string}|null>(null);
  const sidebarInput=useRef<HTMLInputElement>(null);
  const sidebarMenuElement=useRef<HTMLDivElement>(null);
  const sidebarRows=useRef<Record<string,HTMLButtonElement|null>>({});
  const [avatarEditor,setAvatarEditor]=useState<{id:string;shape:Shape;color:string}|null>(null);
  const avatarEditorRef=useRef<{id:string;shape:Shape;color:string}|null>(null);
  const avatarQueue=useRef<Record<string,Promise<void>>>({});
  const avatarSequence=useRef<Record<string,number>>({});
  const avatarButton=useRef<HTMLButtonElement>(null);
  const avatarDialog=useRef<HTMLElement>(null);
  const [tab, setTab] = useState<'Details' | 'Library' | 'Computer'>('Computer');
  const [draft, setDraft] = useState('');
  const composerInput=useRef<HTMLTextAreaElement>(null);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File[]>>({});
  const [pendingRunFiles, setPendingRunFiles] = useState<Record<string, RunFile[]>>({});
  const [pendingGroupFiles, setPendingGroupFiles] = useState<Record<string, Array<{key:string;file:File;uploadedId?:string}>>>({});
  const [pendingGroupRunFiles, setPendingGroupRunFiles] = useState<Record<string, RunFile[]>>({});
  const [previewFile, setPreviewFile] = useState<RunFile | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const [customAnswer, setCustomAnswer] = useState('');
  const [notice, setNotice] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [voiceTranscriptRefresh,setVoiceTranscriptRefresh]=useState(0);
  const [speechMessageId,setSpeechMessageId]=useState('');
  const speechRequestId=useRef(0);
  const speechAudioRef=useRef<HTMLAudioElement|null>(null);
  const speechObjectUrlRef=useRef('');
  const [dictationState, setDictationState] = useState<'idle'|'recording'|'transcribing'>('idle');
  const [dictationSeconds, setDictationSeconds] = useState(0);
  const [dictationNotice, setDictationNotice] = useState('');
  const dictationRecorder = useRef<MediaRecorder|null>(null);
  const dictationStream = useRef<MediaStream|null>(null);
  const dictationChunks = useRef<Blob[]>([]);
  const dictationBotId = useRef('');
  const dictationConversationKey = useRef('');
  const [voiceChatBotId,setVoiceChatBotId]=useState<string|null>(null);
  const [agentFeature, setAgentFeature] = useState<'loading' | 'enabled' | 'disabled' | 'error'>(remote ? 'loading' : 'disabled');
  const [agentEngine, setAgentEngine] = useState<'pi' | 'dsh' | null>(null);
  const [runHistory, setRunHistory] = useState<{ id: string; status: 'loading' | 'ready' | 'error'; runs: AgentRun[] }>({ id: '', status: 'loading', runs: [] });
  const [runRefresh, setRunRefresh] = useState(0);
  const uncertainMutation = useRef(false);
  const [history, setHistory] = useState<{ id: string; status: 'loading' | 'ready' | 'error' }>({ id: '', status: 'loading' });
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [scrollRequest, setScrollRequest] = useState(0);
  const latestSubmittedTimelineItemByBot = useRef<Record<string,string>>({});
  const submittedRunsByBot = useRef<Record<string,Record<string,AgentRun>>>({});
  const messageScroll = useRef<HTMLDivElement>(null);
  const messageContent = useRef<HTMLDivElement>(null);
  const stickToLatestMessage = useRef(false);
  const followMessageGrowth = useRef(false);
  const previousConversationKey = useRef('');
  const previousConversationLength = useRef(0);
  const previousConversationTailKey = useRef('');
  const previousScrollViewport = useRef<HTMLDivElement | null>(null);
  const previousScrollRequest = useRef(0);
  const recipientInput = useRef<HTMLInputElement>(null);
  const savedNames = useRef<Record<string, string>>({});
  const renameQueue = useRef<Record<string, Promise<void>>>({});
  const savedLabels = useRef<Record<string, string>>({});
  const labelQueue = useRef<Record<string, Promise<void>>>({});
  const active = state.bots.find(bot => bot.id === state.activeId) || state.bots[0];
  useEffect(()=>{if(remote&&botStatus==='ready'&&account&&active&&/^[0-9a-f-]{36}$/i.test(linkedSkillId))setConnectAppsOpen(true)},[remote,botStatus,account?.userId,active?.id,linkedSkillId]);
  function closeConnectApps(){setConnectAppsOpen(false);if(linkedSkillId){const url=new URL(window.location.href);url.searchParams.delete('skill');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash)}}
  const activeGroup=groups.find(group=>group.id===selectedGroupId);
  const activeConversationKeyRef=useRef('');
  activeConversationKeyRef.current=activeGroup?`group:${activeGroup.id}`:`bot:${active?.id||''}`;
  const layoutSidebarWidth = account && panel && !panelSidebarExpanded ? PRODUCT_SIDEBAR_MIN : sidebarWidth;
  const botMentionCandidates:BotMentionCandidate[]=botMentionQuery?(()=>{
    const query=botMentionQuery.query.trim().toLowerCase();
    const bots=(activeGroup?activeGroup.members:state.bots.filter(bot=>bot.id!==active?.id))
      .filter(bot=>`${bot.name} ${bot.label}`.toLowerCase().includes(query))
      .map(bot=>({kind:'bot' as const,id:bot.id,bot}));
    const everyone=activeGroup&&'everyone'.includes(query)?[{kind:'everyone' as const,id:'everyone' as const}]:[];
    return [...everyone,...bots].slice(0,activeGroup?7:6);
  })():[];
  useEffect(()=>{botMentionTokensRef.current=[];setBotMentionTokens([]);setBotMentionQuery(null);setBotMentionActiveIndex(0)},[selectedGroupId,active?.id]);
  useLayoutEffect(()=>{
    const caret=botMentionCaretRef.current;
    if(caret===null)return;
    const field=(activeGroup?groupComposer:composerInput).current;
    if(!field)return;
    botMentionCaretRef.current=null;
    field.focus();
    field.setSelectionRange(caret,caret);
  },[draft,selectedGroupId,active?.id]);
  const activeIdRef = useRef(active?.id); activeIdRef.current = active?.id;
  const messages = active ? state.messages[active.id] || [] : [];
  const activeRuns=active&&runHistory.id===active.id&&agentFeature==='enabled'?runHistory.runs:[];
  const botTimeline=buildBotTimeline(messages,activeRuns,active?latestSubmittedTimelineItemByBot.current[active.id]:undefined);
  const visibleConversationLength=activeGroup?(groupChat.id===activeGroup.id?groupChat.view?.messages.length||0:0):botTimeline.length;
  const activeConversationKey=activeGroup?`group:${activeGroup.id}`:`bot:${active?.id||''}`;
  const visibleConversationTailKey=activeGroup?(groupChat.id===activeGroup.id?groupChat.view?.messages.at(-1)?.id||'':''):botTimeline.at(-1)?.key||'';
  useEffect(()=>{
    stopSpeechPlayback();
    return()=>{
      speechAudioRef.current?.pause();
      if(speechObjectUrlRef.current)URL.revokeObjectURL(speechObjectUrlRef.current);
    };
  },[activeConversationKey]);
  const filtered = state.bots.filter(bot => !(reference && newChat && bot.id === 'new') && `${bot.name} ${bot.label}`.toLowerCase().includes(query.toLowerCase()));
  const visibleBots = filtered.filter(bot=>!bot.hidden).sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned)));
  const hiddenBots = filtered.filter(bot=>bot.hidden);
  const filteredGroups=groups.filter(group=>`${group.name} ${group.members.map(member=>member.name).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const menuBot = sidebarMenu ? state.bots.find(bot=>bot.id===sidebarMenu.id) : undefined;

  useEffect(() => {
    if (reference) return;
    try { localStorage.setItem(storageKey, JSON.stringify(remote ? { ...state, messages: {}, showOnboarding: {} } : state)); } catch { /* The preview still works in memory. */ }
  }, [state, reference, remote, storageKey]);
  useEffect(() => {
    if (!sidebarPreferenceKey || panel) return;
    try { localStorage.setItem(sidebarPreferenceKey, String(Math.round(sidebarWidth))); } catch { /* Keep the current width for this session. */ }
  }, [sidebarPreferenceKey, sidebarWidth, panel]);
  useEffect(() => {
    if (!computerPanelPreferenceKey) return;
    try { localStorage.setItem(computerPanelPreferenceKey, String(Math.round(computerPanelWidth))); } catch { /* Keep the current width for this session. */ }
  }, [computerPanelPreferenceKey, computerPanelWidth]);
  useEffect(() => {
    const clampPanel = () => setComputerPanelWidth(width => clampProductPanelWidth(width, layoutSidebarWidth));
    window.addEventListener('resize', clampPanel);
    return () => window.removeEventListener('resize', clampPanel);
  }, [layoutSidebarWidth]);
  useEffect(() => {
    if (!remote) return;
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}api/bots`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('bots unavailable'); return response.json() as Promise<{ bots: Bot[] }>; })
      .then(({ bots }) => {
        if (!Array.isArray(bots)) throw new Error('invalid bots');
        const mapped = bots.map(bot => ({ ...bot, preview: bot.preview || 'Start a conversation' }));
        savedNames.current = Object.fromEntries(mapped.map(bot => [bot.id, bot.name]));
        savedLabels.current = Object.fromEntries(mapped.map(bot => [bot.id, bot.label]));
        setState(current => ({ ...current, bots: mapped, activeId: mapped.some(bot => bot.id === current.activeId) ? current.activeId : mapped[0]?.id || '' }));
        setBotStatus('ready');
      }).catch(error => { if (error.name !== 'AbortError') setBotStatus('error'); });
    return () => controller.abort();
  }, [remote]);
  useEffect(()=>{
    if(!remote||agentFeature!=='enabled'||botStatus!=='ready')return;
    const controller=new AbortController();
    fetch(`${import.meta.env.BASE_URL}api/groups`,{credentials:'same-origin',cache:'no-store',signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error('groups unavailable');return response.json() as Promise<{groups:GroupChat[]}>})
      .then(value=>{
        if(!Array.isArray(value.groups))throw new Error('invalid groups');
        setGroups(value.groups);setGroupsStatus('ready');
        try{const saved=localStorage.getItem(`${storageKey}:selected-group`);if(saved&&value.groups.some(group=>group.id===saved))setSelectedGroupId(saved)}catch{/* Selection persistence is optional. */}
      }).catch(error=>{if(error.name!=='AbortError')setGroupsStatus('error')});
    return()=>controller.abort();
  },[remote,agentFeature,botStatus,storageKey]);
  useEffect(()=>{
    if(!remote||agentFeature!=='enabled'||groupsStatus!=='ready'||!selectedGroupId)return;
    const id=selectedGroupId,controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    setGroupChat({id,status:'loading',view:null});
    const load=async()=>{
      try{
        const response=await fetch(`${import.meta.env.BASE_URL}api/groups/${encodeURIComponent(id)}`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
        if(!response.ok)throw new Error('group unavailable');
        const view=await response.json() as GroupChatView;
        if(!view.group||!Array.isArray(view.messages))throw new Error('invalid group response');
        if(controller.signal.aborted)return;
        setGroupChat({id,status:'ready',view});
        setGroups(current=>current.map(group=>group.id===id?{...group,...view.group}:group));
        timer=setTimeout(()=>void load(),2000);
      }catch(error){if(!controller.signal.aborted){
        setGroupChat(current=>({id,status:'error',view:current.id===id?current.view:null}));
        timer=setTimeout(()=>void load(),2000);
      }}
    };
    void load();return()=>{controller.abort();if(timer)clearTimeout(timer)};
  },[remote,agentFeature,groupsStatus,selectedGroupId,groupRefresh]);
  useEffect(() => {
    if (!remote) return;
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}api/auth/features`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => { if (response.status === 404) return { agent: false, engine: null, voice: false }; if (!response.ok) throw new Error('features unavailable'); return response.json() as Promise<{ agent: boolean; engine: unknown; voice?: boolean }>; })
      .then(value => {
        if (typeof value.agent !== 'boolean' || (value.agent && value.engine !== 'pi' && value.engine !== 'dsh') || (!value.agent && value.engine !== null)) throw new Error('invalid features');
        setVoiceAvailable(value.voice === true);
        setAgentEngine(value.agent ? value.engine as 'pi' | 'dsh' : null);
        setAgentFeature(value.agent ? 'enabled' : 'disabled');
      })
      .catch(error => { if (error.name !== 'AbortError') setAgentFeature('error'); });
    return () => controller.abort();
  }, [remote]);
  useEffect(() => {
    if (!remote || agentFeature !== 'enabled' || botStatus !== 'ready' || !active?.id || activeGroup) return;
    const id = active.id, controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setRunHistory(current => ({ id, status: 'loading', runs: current.id === id ? current.runs : [] }));
    const load = async () => {
      if (uncertainMutation.current) return;
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}api/bots/${id}/runs`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('runs unavailable');
        const value = await response.json() as { runs: AgentRun[] };
        if (!Array.isArray(value.runs)) throw new Error('invalid runs');
        if (controller.signal.aborted || uncertainMutation.current) return;
        // A history poll can have started before a successful POST /runs and
        // return a snapshot that does not contain the accepted task. Keep each
        // submitted run until the canonical history confirms its ID so the new
        // prompt cannot disappear and send the conversation back to old items.
        const submitted=submittedRunsByBot.current[id]||{};
        const confirmedRunIds=new Set(value.runs.map(run=>run.id));
        for(const runId of confirmedRunIds)delete submitted[runId];
        const confirmedRuns=Object.values(submitted).filter(run=>!confirmedRunIds.has(run.id));
        if(Object.keys(submitted).length===0)delete submittedRunsByBot.current[id];
        const runs=[...value.runs,...confirmedRuns];
        setRunHistory({ id, status: 'ready', runs });
        const latest=runs.at(-1);
        if(latest)setState(current=>({...current,bots:current.bots.map(bot=>bot.id===id?{...bot,preview:runPreview(latest),lastActivityAt:latest.updatedAt||bot.lastActivityAt}:bot)}));
        timer = setTimeout(() => void load(), 2000);
      } catch (error) {
        if (!controller.signal.aborted) {
          setRunHistory(current => ({ id, status: 'error', runs: current.id === id ? current.runs : [] }));
          timer = setTimeout(() => void load(), 2000);
        }
      }
    };
    void load();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [remote, agentFeature, botStatus, active?.id, activeGroup?.id, runRefresh]);
  useEffect(() => {
    if (!remote || !active?.id || activeGroup) return;
    const id = active.id, controller = new AbortController();
    setHistory({ id, status: 'loading' });
    fetch(`${import.meta.env.BASE_URL}api/bots/${id}/messages`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('history unavailable'); return response.json() as Promise<{ messages: Message[] }>; })
      .then(({ messages }) => {
        if (!Array.isArray(messages)) throw new Error('invalid history');
        setState(current => ({ ...current, messages: { ...current.messages, [id]: messages } }));
        setHistory({ id, status: 'ready' });
      }).catch(error => { if (error.name !== 'AbortError') setHistory({ id, status: 'error' }); });
    return () => controller.abort();
  }, [remote, active?.id, activeGroup?.id, voiceTranscriptRefresh]);
  useEffect(() => { setDraft(''); setCustomAnswer(''); setNotice(false);setGroupError('');setDictationNotice('');if(dictationRecorder.current?.state==='recording'){dictationRecorder.current.ondataavailable=null;dictationRecorder.current.onstop=null;dictationRecorder.current.stop()}dictationStream.current?.getTracks().forEach(track=>track.stop());dictationStream.current=null;dictationRecorder.current=null;dictationChunks.current=[];setDictationState('idle');setDictationSeconds(0); }, [state.activeId,selectedGroupId]);
  useEffect(() => {
    if(dictationState!=='recording')return;
    const started=Date.now();
    const timer=setInterval(()=>{
      const elapsed=Math.floor((Date.now()-started)/1000);setDictationSeconds(elapsed);
      if(elapsed>=290&&dictationRecorder.current?.state==='recording'){setDictationNotice('Five minute limit reached. Transcribing your recording…');setDictationState('transcribing');dictationRecorder.current.stop()}
    },1000);
    return()=>clearInterval(timer);
  },[dictationState]);
  useEffect(()=>()=>{if(dictationRecorder.current?.state==='recording')dictationRecorder.current.stop();dictationStream.current?.getTracks().forEach(track=>track.stop());},[]);
  useEffect(() => { avatarEditorRef.current=null; setAvatarEditor(null); }, [state.activeId]);
  useEffect(() => { if (avatarEditor) avatarDialog.current?.focus(); }, [avatarEditor?.id]);
  useEffect(() => { if(newChat) recipientInput.current?.focus(); }, [newChat]);
  useEffect(() => {
    if(createDialog){createName.current?.focus();return}
    const target=createReturnFocus.current;createReturnFocus.current=null;
    if(target?.isConnected)target.focus();
  }, [Boolean(createDialog)]);
  useEffect(() => { if(sidebarRename){ sidebarInput.current?.focus(); sidebarInput.current?.select(); } }, [sidebarRename?.id]);
  useEffect(() => {
    if(!sidebarMenu)return;
    sidebarMenuElement.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const onPointer=(event:PointerEvent)=>{if(!sidebarMenuElement.current?.contains(event.target as Node))setSidebarMenu(null)};
    document.addEventListener('pointerdown',onPointer);return()=>document.removeEventListener('pointerdown',onPointer);
  },[sidebarMenu]);
  useEffect(() => {
    const onKeyDown = (event:KeyboardEvent) => {
      if((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase()==='n' && !sendingRef.current && !createDialogOpenRef.current) {
        event.preventDefault();if(reference||remote&&agentFeature==='enabled'){setRecipientQuery('');setNewChat(true);setPanel(false)}else beginCreate();
      }
    };
    window.addEventListener('keydown',onKeyDown);return ()=>window.removeEventListener('keydown',onKeyDown);
  },[reference,remote,agentFeature]);
  useLayoutEffect(() => {
    const viewport=messageScroll.current;
    const content=messageContent.current;
    if(!viewport||!content)return;
    const scrollToLatest=()=>{viewport.scrollTop=viewport.scrollHeight;};
    const conversationChanged=previousConversationKey.current!==activeConversationKey;
    const viewportChanged=previousScrollViewport.current!==viewport;
    const messageCountChanged=previousConversationLength.current!==visibleConversationLength;
    const conversationTailChanged=previousConversationTailKey.current!==visibleConversationTailKey;
    const scrollRequested=previousScrollRequest.current!==scrollRequest;
    previousScrollRequest.current=scrollRequest;
    if(conversationChanged||viewportChanged){
      previousConversationKey.current=activeConversationKey;
      previousScrollViewport.current=viewport;
      previousConversationLength.current=0;
      previousConversationTailKey.current='';
      // A newly opened conversation starts at its latest message. The user can
      // still scroll up to history, which disables following until they return
      // to the bottom.
      stickToLatestMessage.current=!reference;
      followMessageGrowth.current=!reference;
    }
    // A submitted message is an explicit request to see the new item even if
    // the reader had been browsing history. Do not let a stale scroll-follow
    // flag cancel that request during the same React commit.
    if(scrollRequested){
      stickToLatestMessage.current=true;
      followMessageGrowth.current=true;
    }
    // Position only within this conversation viewport, including when switching
    // between conversations with the same number of messages. Reapply a send
    // scroll after the browser's next layout frame: task cards and history
    // refreshes can otherwise restore the previous scroll anchor after commit.
    let settleFrame:number|undefined;
    if(visibleConversationLength>0&&(conversationChanged||viewportChanged||messageCountChanged||conversationTailChanged||scrollRequested)&&(scrollRequested||stickToLatestMessage.current)){
      scrollToLatest();
      if(scrollRequested)settleFrame=requestAnimationFrame(()=>{
        if(messageScroll.current===viewport&&previousScrollRequest.current===scrollRequest&&stickToLatestMessage.current)scrollToLatest();
      });
    }
    previousConversationLength.current=visibleConversationLength;
    previousConversationTailKey.current=visibleConversationTailKey;
    return()=>{if(settleFrame!==undefined)cancelAnimationFrame(settleFrame)};
  },[activeConversationKey,visibleConversationLength,visibleConversationTailKey,newChat,Boolean(account),reference,scrollRequest]);
  useLayoutEffect(() => {
    const viewport=messageScroll.current;
    const content=messageContent.current;
    if(!viewport||!content)return;
    const scrollToLatest=()=>{viewport.scrollTop=viewport.scrollHeight;};
    // Scroll only the conversation viewport. scrollIntoView() can also move
    // outer page ancestors, which makes the history appear to jump to its top.
    let previousViewportWidth=viewport.clientWidth;
    const resizeObserver=typeof ResizeObserver==='undefined'?null:new ResizeObserver(()=>{
      const currentViewportWidth=viewport.clientWidth;
      if(Math.abs(currentViewportWidth-previousViewportWidth)>24){
        previousViewportWidth=currentViewportWidth;
        return;
      }
      previousViewportWidth=currentViewportWidth;
      // Content growth follows the latest item only when the user was already
      // following it; a panel-width reflow must not steal history position.
      if(followMessageGrowth.current&&stickToLatestMessage.current)scrollToLatest();
    });
    resizeObserver?.observe(content);
    const distanceFromLatest=()=>viewport.scrollHeight-viewport.clientHeight-viewport.scrollTop;
    let touchScrolling=false,scrollbarDragging=false;
    const onWheel=(event:WheelEvent)=>{
      if(event.deltaY<0)stickToLatestMessage.current=false;
      else if(event.deltaY>0)requestAnimationFrame(()=>{stickToLatestMessage.current=distanceFromLatest()<=48;});
    };
    const onTouchStart=()=>{touchScrolling=true;};
    const onTouchEnd=()=>{touchScrolling=false;stickToLatestMessage.current=distanceFromLatest()<=48;};
    const onPointerDown=(event:PointerEvent)=>{
      const rect=viewport.getBoundingClientRect(),scrollbarWidth=viewport.offsetWidth-viewport.clientWidth;
      if(scrollbarWidth>0&&event.clientX>=rect.right-scrollbarWidth){scrollbarDragging=true;}
    };
    const onPointerUp=()=>{if(scrollbarDragging){scrollbarDragging=false;stickToLatestMessage.current=distanceFromLatest()<=48;}};
    const onScroll=()=>{if(touchScrolling||scrollbarDragging)stickToLatestMessage.current=distanceFromLatest()<=48;};
    viewport.addEventListener('wheel',onWheel,{passive:true});
    viewport.addEventListener('touchstart',onTouchStart,{passive:true});
    viewport.addEventListener('touchend',onTouchEnd,{passive:true});
    viewport.addEventListener('touchcancel',onTouchEnd,{passive:true});
    viewport.addEventListener('pointerdown',onPointerDown,{passive:true});
    viewport.addEventListener('pointerup',onPointerUp,{passive:true});
    viewport.addEventListener('pointercancel',onPointerUp,{passive:true});
    viewport.addEventListener('scroll',onScroll,{passive:true});
    return()=>{
      viewport.removeEventListener('wheel',onWheel);
      viewport.removeEventListener('touchstart',onTouchStart);
      viewport.removeEventListener('touchend',onTouchEnd);
      viewport.removeEventListener('touchcancel',onTouchEnd);
      viewport.removeEventListener('pointerdown',onPointerDown);
      viewport.removeEventListener('pointerup',onPointerUp);
      viewport.removeEventListener('pointercancel',onPointerUp);
      viewport.removeEventListener('scroll',onScroll);
      resizeObserver?.disconnect();
    };
  },[activeConversationKey,newChat,Boolean(account),visibleConversationLength>0]);

  function selectBot(id: string) {
    if (sendingRef.current) return;
    followMessageGrowth.current=false;
    setSelectedGroupId('');
    try{localStorage.removeItem(`${storageKey}:selected-group`)}catch{/* Selection persistence is optional. */}
    setState(current => ({ ...current, activeId: id }));
    setNewChat(false);
    setRecipientQuery('');
    setPanel(false);
  }
  function selectGroup(id:string){
    if(sendingRef.current||groupSendingRef.current)return;
    followMessageGrowth.current=false;
    setSelectedGroupId(id);setNewChat(false);setRecipientQuery('');setPanel(false);setGroupComputerBotId('');
    try{localStorage.setItem(`${storageKey}:selected-group`,id)}catch{/* Selection persistence is optional. */}
  }
  function beginGroupCreate(){
    if(!remote||agentFeature!=='enabled'||state.bots.length<2||sendingRef.current||groupSendingRef.current)return;
    setNewChat(false);setRecipientQuery('');setGroupError('');setGroupCreateDialog({name:'',botIds:[],requestId:crypto.randomUUID()});
  }
  async function createGroup(){
    if(!groupCreateDialog||groupSaving||groupCreateDialog.botIds.length<2||groupCreateDialog.botIds.length>6)return;
    const name=groupCreateDialog.name.trim();if(!name||name.length>60)return;
    setGroupSaving(true);setGroupError('');
    try{
      const response=await fetch(`${import.meta.env.BASE_URL}api/groups`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:groupCreateDialog.requestId,name,botIds:groupCreateDialog.botIds})});
      if(!response.ok)throw new Error('group creation failed');
      const value=await response.json() as {group:GroupChat};
      if(!value.group||typeof value.group.id!=='string'||!Array.isArray(value.group.members))throw new Error('invalid group response');
      setGroups(current=>[value.group,...current.filter(group=>group.id!==value.group.id)]);setGroupsStatus('ready');setGroupCreateDialog(null);selectGroup(value.group.id);
    }catch{setGroupError('Could not confirm the group was created. Retry uses the same request, or refresh to check the sidebar.');}
    finally{setGroupSaving(false)}
  }
  function beginCreate() {
    if(sendingRef.current||savingBotRef.current)return;
    const focused=document.activeElement;
    createReturnFocus.current=focused instanceof HTMLElement&&focused!==document.body?focused:createTrigger.current;
    setCreateDialog({name:'',shape:'star',color:'#fb2b3e'});
  }
  function handleCreateDialogKey(event:React.KeyboardEvent<HTMLFormElement>) {
    if(event.key==='Escape'&&!savingBot){event.preventDefault();setCreateDialog(null);return}
    if(event.key!=='Tab')return;
    const focusable=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)'));
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
  }
  async function createBot(selection?:{name:string;shape:Shape;color:string}) {
    if (sendingRef.current || savingBotRef.current || createUncertain) return;
    const chosen=selection || {name:'New Bot',shape:'drop' as Shape,color:'#a382ef'};
    const name=chosen.name.trim();if(!name||name.length>60)return;
    if (remote) {
      savingBotRef.current=true;setSavingBot(true);setBotError('');
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}api/bots`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color: chosen.color, shape: chosen.shape }) });
        if (!response.ok) throw new Error('create failed');
        const { bot } = await response.json() as { bot: Omit<Bot, 'preview'> };
        if(!bot || typeof bot.id!=='string')throw new Error('invalid bot response');
        savedNames.current[bot.id] = bot.name;
        savedLabels.current[bot.id] = bot.label;
        setState(current => ({ ...current, bots: [{ ...bot, preview: 'Start a conversation' }, ...current.bots], activeId: bot.id }));
        setSelectedGroupId('');try{localStorage.removeItem(`${storageKey}:selected-group`)}catch{/* Selection persistence is optional. */}
        setCreateDialog(null);setNewChat(false);setPanel(false);
      } catch { setCreateUncertain(true);setBotError('Could not confirm the Bot was created. Refresh and check the sidebar before trying again.'); }
      finally { savingBotRef.current=false;setSavingBot(false); }
      return;
    }
    const id = crypto.randomUUID();
    const bot: Bot = { id, name, label: '', color: chosen.color, shape: chosen.shape, group: 'Unassigned', preview: 'Start a conversation' };
    if(reference){
      const welcome: Message = { id: 'welcome', role: 'bot', text: 'Hello — what would you like help with?' };
      setState(current => ({ ...current, bots: [bot, ...current.bots], activeId: id, messages: { ...current.messages, [id]: [welcome] }, showOnboarding: { ...current.showOnboarding, [id]: true } }));
    }else setState(current => ({ ...current, bots: [bot, ...current.bots], activeId: id }));
    setSelectedGroupId('');
    try{localStorage.removeItem(`${storageKey}:selected-group`)}catch{/* Selection persistence is optional. */}
    setCreateDialog(null);setNewChat(false);setPanel(false);
  }
  function renderBotTimelineEntry(entry:BotTimelineEntry):React.ReactNode {
    if(entry.kind==='message'){
      const message=entry.message;
      if(message.role==='system')return <div key={entry.key} className="system-event-line" role="status">{message.text}</div>;
      if(message.role==='voice'&&message.voiceCall)return <div key={entry.key} className="message-line voice-call-line"><VoiceCallCard botName={active?.name||'Bot'} messageId={message.id} call={message.voiceCall} onFeedback={(callId,value)=>saveVoiceCallFeedback(active?.id||'',callId,value)}/></div>;
      return <div key={entry.key} className={`message-line ${message.role}`}><div className="message-bubble">{message.text}</div>{message.role==='bot'&&<div className="message-actions">{voiceAvailable&&remote&&active&&<button type="button" className="message-speech-button" aria-label={speechMessageId===message.id?'Stop reading aloud':'Read aloud'} title={speechMessageId===message.id?'Stop reading aloud':'Read aloud'} onClick={()=>void speakMessageAloud(active.id,message.id,message.text)}><Icon name="sound"/></button>}<Icon name="smile"/><Icon name="reply"/><Icon name="more"/></div>}</div>;
    }
    if(!active)return null;
    const run=entry.run;
    const inputFiles=(run.files||[]).filter(file=>file.kind==='input'),outputFiles=(run.files||[]).filter(file=>file.kind==='output');
    const genericDone=Boolean(run.computerUsed&&/^(done|done\.)$/i.test(run.result?.trim()||''));
    const showRetryNote=run.status==='unknown'&&run.recoveryState==='retried'&&Boolean(run.replacementRunId);
    const failureHeadline=(run.status==='unknown'||run.status==='failed')?runFailureHeadline(run):null;
    const failureDescription=(run.status==='unknown'||run.status==='failed')?runFailureDescription(run):null;
    if(entry.kind==='run-prompt')return <div key={entry.key} className="message-line user"><div className="message-bubble">{run.prompt}<RunFileCards files={inputFiles} onPreview={setPreviewFile}/></div></div>;
    if(entry.kind==='computer')return <div key={entry.key} className="computer-activity-line"><ComputerActivityCard run={run} botId={active.id} showScreen={run.id===latestComputerRunId} onOpenComputer={()=>openProductPanel('Computer')}><RunFileCards files={inputFiles} onPreview={setPreviewFile}/></ComputerActivityCard></div>;
    return <div key={entry.key} className={`message-line bot${run.computerUsed?' computer-followup':''}`}><div className="message-bubble">
      {(run.status==='unknown'||(!run.computerUsed&&run.status!=='completed'))&&<span className={`run-status${failureHeadline?' run-status-error':''}`}>{failureHeadline|| (run.status==='unknown'&&run.recoveryState==='auto_resumed'?'Outcome unknown · not retried':run.status==='unknown'&&run.recoveryState==='acknowledged'?'Outcome unknown · queue resumed':run.status==='unknown'&&run.recoveryState==='retried'?'Outcome unknown · explicit retry recorded':({queued:'Queued · waiting for your computer',running:'Working on your computer',failed:'Failed',unknown:'Outcome unknown'} as const)[run.status])}</span>}
      {run.result&&!genericDone&&<p>{run.result}</p>}
      {run.status==='unknown'&&<><p className="run-recovery-note">{failureHeadline?'The Agent stopped before returning a final result. Earlier computer actions may already have completed. This run was not replayed; inspect the computer before a separate retry.':'The task result was not confirmed and the task was not replayed. Inspect the computer before retrying.'}</p>{failureDescription&&<p className="run-recovery-diagnostic">{failureDescription}</p>}</>}
      {run.status==='failed'&&failureDescription&&<p className="run-recovery-diagnostic">{failureDescription}</p>}
      {run.status==='completed'&&Boolean(run.result?.trim())&&!genericDone&&voiceAvailable&&remote&&active&&<div className="message-actions"><button type="button" className="message-speech-button" aria-label={speechMessageId===run.id?'Stop reading aloud':'Read aloud'} title={speechMessageId===run.id?'Stop reading aloud':'Read aloud'} onClick={()=>void speakMessageAloud(active.id,run.id,run.result||'')}><Icon name="sound"/></button></div>}
      <RunFileCards files={outputFiles} onPreview={setPreviewFile} onReuse={reuseRunFile}/>
      {showRetryNote&&<p className="run-recovery-note">A separate queued task was created; the original outcome remains in history.</p>}
      {!run.computerUsed&&remote&&<div className="message-actions"><RunTraceButton runId={run.id} compact/></div>}
    </div></div>;
  }
  function renderGroupChatMessage(message:GroupMessage,index:number,messages:GroupMessage[],group:GroupChat):React.ReactNode {
    const at=timelineTime(message.createdAt),previousAt=index>0?timelineTime(messages[index-1].createdAt):null;
    return <React.Fragment key={message.id}>
      {shouldShowChatTimestamp(at,previousAt)&&<div className="date-line"><time dateTime={new Date(at).toISOString()}>{formatChatTimestamp(at)}</time></div>}
      {message.role==='user'
        ? <div className="message-line user group-user-message"><div className="message-bubble">{renderGroupUserText(message,group.members)}<RunFileCards files={(message.files||[]).filter(file=>file.kind==='input')} onPreview={setPreviewFile}/></div></div>
        : <div className="message-line bot group-bot-message">
          <Avatar bot={group.members.find(member=>member.id===message.botId)||group.members[0]} size={27}/>
          <div className="message-bubble">
            <header className="group-message-heading"><strong>{message.botName||'Bot'}</strong><span className={`group-run-status ${message.status||'queued'}`} title={groupRunStatusLabel(message)}>{groupRunStatusLabel(message)}</span></header>
            <p>{message.text||(runFailureHeadline(message)?`${runFailureHeadline(message)}. ${runFailureDescription(message)||''}`:groupRunFallback(message))}</p>
            <RunFileCards files={(message.files||[]).filter(file=>file.kind==='output')} onPreview={setPreviewFile} onReuse={reuseGroupRunFile}/>
            {message.computerUsed&&message.botId&&<ComputerActivityCard run={{id:message.runId||message.id,prompt:'',status:message.status||'queued',result:message.text,recoveryState:message.recoveryState||'none',replacementRunId:message.replacementRunId,files:message.files||[],computerUsed:true,diagnosticCode:message.diagnosticCode,failureTraceDiagnosticCode:message.failureTraceDiagnosticCode,failureComponent:message.failureComponent,failureReasonCode:message.failureReasonCode,failureStage:message.failureStage,failureHttpStatus:message.failureHttpStatus,failureUpstreamHttpStatus:message.failureUpstreamHttpStatus,failureUpstreamErrorKind:message.failureUpstreamErrorKind,failureUpstreamErrorCode:message.failureUpstreamErrorCode,failureAdapterExitCode:message.failureAdapterExitCode,failureAdapterExitSignal:message.failureAdapterExitSignal,failureDatabaseCode:message.failureDatabaseCode,failureTransportCode:message.failureTransportCode,failureOperation:message.failureOperation,failureAttemptNumber:message.failureAttemptNumber,failureDurationMs:message.failureDurationMs,failureRequestBytes:message.failureRequestBytes,failureRequestLimitBytes:message.failureRequestLimitBytes,executionAudit:message.executionAudit}} botId={message.botId} showScreen={message.status==='running'||message.status==='completed'} onOpenComputer={()=>{setGroupComputerBotId(message.botId!);openProductPanel('Computer')}} />}
            {!message.computerUsed&&remote&&message.runId&&<div className="message-actions"><RunTraceButton runId={message.runId} compact/></div>}
            {message.status==='unknown'&&<><p className="run-recovery-note">{runFailureHeadline(message)?'The Agent stopped before returning a final result. Earlier computer actions may already have completed. This run was not replayed; inspect the computer before a separate retry.':'The task result was not confirmed and the task was not replayed. Inspect the computer before retrying.'}</p>{runFailureDescription(message)&&<p className="run-recovery-diagnostic">{runFailureDescription(message)}</p>}</>}
            {message.status==='unknown'&&message.recoveryState==='retried'&&message.replacementRunId&&<p className="run-recovery-note">The original task outcome remains unknown. The separate retry is shown below.</p>}
            {message.replacementRun&&<section className="group-replacement-run" aria-label={`Separate retry for ${message.botName||'Bot'}`}>
              <header><strong>Separate retry</strong><span className={`group-run-status ${message.replacementRun.status}`}>{runFailureHeadline(message.replacementRun)||replacementRunLabel(message.replacementRun.status)}</span></header>
              <p>{message.replacementRun.result||(runFailureHeadline(message.replacementRun)?runFailureDescription(message.replacementRun):replacementRunFallback(message.replacementRun.status))}</p>
              <RunFileCards files={message.replacementRun.files.filter(file=>file.kind==='output')} onPreview={setPreviewFile} onReuse={reuseGroupRunFile}/>
              {message.replacementRun.computerUsed&&message.botId&&<ComputerActivityCard run={{id:message.replacementRun.id,prompt:'',status:message.replacementRun.status,result:message.replacementRun.result,recoveryState:'none',replacementRunId:null,files:message.replacementRun.files,computerUsed:true,diagnosticCode:message.replacementRun.diagnosticCode,failureTraceDiagnosticCode:message.replacementRun.failureTraceDiagnosticCode,failureComponent:message.replacementRun.failureComponent,failureReasonCode:message.replacementRun.failureReasonCode,failureStage:message.replacementRun.failureStage,failureHttpStatus:message.replacementRun.failureHttpStatus,failureUpstreamHttpStatus:message.replacementRun.failureUpstreamHttpStatus,failureUpstreamErrorKind:message.replacementRun.failureUpstreamErrorKind,failureUpstreamErrorCode:message.replacementRun.failureUpstreamErrorCode,failureAdapterExitCode:message.replacementRun.failureAdapterExitCode,failureAdapterExitSignal:message.replacementRun.failureAdapterExitSignal,failureDatabaseCode:message.replacementRun.failureDatabaseCode,failureTransportCode:message.replacementRun.failureTransportCode,failureOperation:message.replacementRun.failureOperation,failureAttemptNumber:message.replacementRun.failureAttemptNumber,failureDurationMs:message.replacementRun.failureDurationMs,failureRequestBytes:message.replacementRun.failureRequestBytes,failureRequestLimitBytes:message.replacementRun.failureRequestLimitBytes,executionAudit:message.replacementRun.executionAudit}} botId={message.botId} showScreen={message.replacementRun.status==='running'||message.replacementRun.status==='completed'} onOpenComputer={()=>{setGroupComputerBotId(message.botId!);openProductPanel('Computer')}} />}
              {!message.replacementRun.computerUsed&&remote&&<RunTraceButton runId={message.replacementRun.id} compact/>}
            </section>}
          </div>
        </div>}
    </React.Fragment>;
  }
  async function saveVoiceCallFeedback(botId:string,callId:string,feedback:'good'|'bad'){
    if(!botId)throw new Error('Bot is unavailable');
    const response=await fetch(`${import.meta.env.BASE_URL}api/bots/${encodeURIComponent(botId)}/voice/calls/${encodeURIComponent(callId)}/feedback`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({feedback})});
    if(!response.ok)throw new Error('Voice feedback could not be saved');
    setState(current=>({...current,messages:{...current.messages,[botId]:(current.messages[botId]||[]).map(message=>message.id===callId&&message.voiceCall?{...message,voiceCall:{...message.voiceCall,feedback}}:message)}}));
  }
  function updateBotMentionDraft(value:string,caret:number){
    setDraft(value);
    const tokens=rebaseGroupMentionTokens(draft,value,botMentionTokensRef.current);
    botMentionTokensRef.current=tokens;setBotMentionTokens(tokens);
    setBotMentionQuery(findGroupMentionQuery(value,caret));setBotMentionActiveIndex(0);
  }
  function selectBotMention(candidate:BotMentionCandidate){
    if(!botMentionQuery)return;
    const {start,end}=botMentionQuery,label=candidate.kind==='everyone'?'@everyone':`@${candidate.bot.name}`,next=`${draft.slice(0,start)}${label} ${draft.slice(end)}`,caret=start+label.length+1;
    const token:GroupMentionToken=candidate.kind==='everyone'
      ?{kind:'everyone',name:'everyone',start,end:start+label.length}
      :{kind:'bot',botId:candidate.bot.id,name:candidate.bot.name,start,end:start+label.length};
    const tokens=[...rebaseGroupMentionTokens(draft,next,botMentionTokensRef.current),token].sort((a,b)=>a.start-b.start);
    botMentionCaretRef.current=caret;
    botMentionTokensRef.current=tokens;setBotMentionTokens(tokens);setDraft(next);setBotMentionQuery(null);setBotMentionActiveIndex(0);
  }
  function handleComposerKeyDown(event:React.KeyboardEvent<HTMLTextAreaElement>){
    if(event.key==='Escape'&&botMentionQuery){event.preventDefault();setBotMentionQuery(null);return}
    if(botMentionQuery&&botMentionCandidates.length){
      if(event.key==='ArrowDown'){event.preventDefault();setBotMentionActiveIndex(index=>(index+1)%botMentionCandidates.length);return}
      if(event.key==='ArrowUp'){event.preventDefault();setBotMentionActiveIndex(index=>(index-1+botMentionCandidates.length)%botMentionCandidates.length);return}
      if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();selectBotMention(botMentionCandidates[botMentionActiveIndex]||botMentionCandidates[0]);return}
    }
    if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void addMessage(draft)}
  }
  function stopSpeechPlayback(){
    speechRequestId.current++;
    const audio=speechAudioRef.current;
    if(audio){audio.pause();audio.removeAttribute('src');audio.load();speechAudioRef.current=null}
    if(speechObjectUrlRef.current){URL.revokeObjectURL(speechObjectUrlRef.current);speechObjectUrlRef.current=''}
    setSpeechMessageId('');
  }
  async function speakMessageAloud(botId:string,messageId:string,text:string){
    if(speechMessageId===messageId){stopSpeechPlayback();return}
    stopSpeechPlayback();
    if(!remote||!voiceAvailable||!text.trim())return;
    const requestId=speechRequestId.current;
    const conversationKey=activeConversationKeyRef.current;
    setDictationNotice('Generating speech…');setSpeechMessageId(messageId);
    try{
      const response=await fetch(`${import.meta.env.BASE_URL}api/bots/${encodeURIComponent(botId)}/voice/speech`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
      if(speechRequestId.current!==requestId)return;
      if(!response.ok)throw new Error('Speech playback is unavailable. Try again.');
      const audioBlob=await response.blob();
      if(speechRequestId.current!==requestId)return;
      if(activeConversationKeyRef.current!==conversationKey){setSpeechMessageId('');return}
      const objectUrl=URL.createObjectURL(audioBlob);speechObjectUrlRef.current=objectUrl;
      const audio=new Audio(objectUrl);speechAudioRef.current=audio;
      const finish=()=>{if(speechAudioRef.current===audio)stopSpeechPlayback();setDictationNotice('')};
      audio.onended=finish;audio.onerror=()=>{finish();setDictationNotice('Speech playback failed. Try again.')};
      await audio.play();setDictationNotice('');
    }catch(error){stopSpeechPlayback();setDictationNotice(error instanceof Error?error.message:'Speech playback is unavailable. Try again.')}
  }
  async function toggleVoiceInput(){
    if(dictationState==='recording'){
      setDictationState('transcribing');dictationRecorder.current?.stop();return;
    }
    if(dictationState==='transcribing')return;
    if(!remote||!voiceAvailable||agentFeature!=='enabled'){
      setDictationNotice('Voice input is unavailable until the Agent runtime is connected.');return;
    }
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){
      setDictationNotice('This browser does not support microphone recording.');return;
    }
    try{
      const media=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      const types=['audio/webm;codecs=opus','audio/mp4'];
      const mimeType=types.find(type=>MediaRecorder.isTypeSupported(type));
      const recorder=new MediaRecorder(media,mimeType?{mimeType}:undefined);
      dictationBotId.current=activeGroup?.members[0]?.id||active?.id||'';
      dictationConversationKey.current=activeConversationKeyRef.current;
      dictationStream.current=media;dictationRecorder.current=recorder;dictationChunks.current=[];setDictationSeconds(0);setDictationNotice('');
      recorder.ondataavailable=event=>{if(event.data.size)dictationChunks.current.push(event.data)};
      recorder.onerror=()=>{setDictationNotice('Microphone recording failed. Try again.');setDictationState('idle')};
      recorder.onstop=()=>{
        const recorded=new Blob(dictationChunks.current,{type:recorder.mimeType||'audio/webm'});dictationChunks.current=[];
        media.getTracks().forEach(track=>track.stop());if(dictationStream.current===media)dictationStream.current=null;
        if(dictationRecorder.current===recorder)dictationRecorder.current=null;
        if(recorded.size===0){setDictationNotice('No speech was recorded. Try again.');setDictationState('idle');return}
        setDictationState('transcribing');setDictationNotice('Transcribing…');
        void (async()=>{
          try{
            const wav=await audioBlobToPcmWav16k(recorded);
            const response=await fetch(`${import.meta.env.BASE_URL}api/bots/${dictationBotId.current}/voice/dictate`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'audio/wav'},body:wav});
            if(!response.ok)throw new Error(response.status===401?'Sign in again to use voice input.':response.status===413?'Recording exceeds the 10 MB limit.':'Transcription could not be completed.');
            const value=await response.json() as {text?:unknown};
            if(typeof value.text!=='string'||!value.text.trim())throw new Error('No speech was recognized. Try again.');
            if(activeConversationKeyRef.current===dictationConversationKey.current){
              setDraft(current=>`${current}${current.trim()?' ':''}${value.text as string}`);
              botMentionTokensRef.current=[];setBotMentionTokens([]);setBotMentionQuery(null);
              requestAnimationFrame(()=>{(activeGroup?groupComposer:composerInput).current?.focus()});
              setDictationNotice('Transcript added to the message. Review and send when ready.');
            }else setDictationNotice('Transcript is ready. Reopen the original chat to continue.');
          }catch(error){setDictationNotice(error instanceof Error?error.message:'Transcription could not be completed.')}
          finally{setDictationState('idle')}
        })();
      };
      recorder.start(250);setDictationState('recording');
    }catch(error){
      const name=error instanceof DOMException?error.name:'';
      setDictationNotice(name==='NotAllowedError'?'Allow microphone access in your browser, then try again.':name==='NotFoundError'?'No microphone was found.':'Could not start voice input.');
      dictationStream.current?.getTracks().forEach(track=>track.stop());dictationStream.current=null;setDictationState('idle');
    }
  }
  async function addMessage(text: string) {
    if(remote&&selectedGroupId){
      const clean=text.trim();
      const selectedFiles=pendingGroupFiles[selectedGroupId]||[];
      const selectedRunFiles=pendingGroupRunFiles[selectedGroupId]||[];
      if((!clean&&!selectedFiles.length&&!selectedRunFiles.length)||uncertainMutation.current||groupSendingRef.current||groupChat.id!==selectedGroupId||groupChat.status!=='ready')return;
      if(clean.length>8000){setGroupError('Message is too long.');return}
      if(selectedFiles.length+selectedRunFiles.length>attachmentCountLimit){setGroupError('Attach up to 20 files per message.');return}
      groupSendingRef.current=true;setGroupSending(true);setGroupError('');
      let submissionStarted=false;
      try{
        const uploadedIds:string[]=[];
        for(const pending of selectedFiles){
          if(pending.uploadedId){uploadedIds.push(pending.uploadedId);continue}
          const upload=await fetch(`${import.meta.env.BASE_URL}api/groups/${encodeURIComponent(selectedGroupId)}/files`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':attachmentMimeType(pending.file),'X-File-Name':encodeURIComponent(pending.file.name)},body:pending.file});
          if(!upload.ok)throw new Error('group file upload failed');
          const value=await upload.json() as {file?:{id?:unknown}};
          if(typeof value.file?.id!=='string')throw new Error('invalid group file response');
          pending.uploadedId=value.file.id;uploadedIds.push(value.file.id);
          setPendingGroupFiles(current=>({...current,[selectedGroupId]:(current[selectedGroupId]||[]).map(item=>item.key===pending.key?{...item,uploadedId:value.file!.id as string}:item)}));
        }
        const targetBotIds=groupMentionRecipientBotIds(activeGroup?.members.map(member=>member.id)||[],botMentionTokensRef.current);
        submissionStarted=true;
        const messageFileIds=[...uploadedIds,...selectedRunFiles.map(file=>file.id)];
        const response=await fetch(`${import.meta.env.BASE_URL}api/groups/${encodeURIComponent(selectedGroupId)}/messages`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),text:clean,...(messageFileIds.length?{files:messageFileIds}:{}),...(targetBotIds.length?{targetBotIds}:{})})});
        if(!response.ok){if(response.status<500){setGroupError('The message was rejected. Review it and try again.');return}throw new Error('group message submission failed');}
        const view=await response.json() as GroupChatView;
        if(!view.group||!Array.isArray(view.messages)||view.group.id!==selectedGroupId)throw new Error('invalid group response');
        followMessageGrowth.current=true;
        stickToLatestMessage.current=true;
        setScrollRequest(value=>value+1);
        setGroupChat({id:selectedGroupId,status:'ready',view});
        setGroups(current=>[view.group,...current.filter(group=>group.id!==view.group.id)]);
        const recipientBotIds=new Set(groupRecipientBotIds(view.group.members.map(member=>member.id),targetBotIds));
        setState(current=>({...current,bots:current.bots.map(bot=>recipientBotIds.has(bot.id)?{...bot,preview:clean||'Attached files',lastActivityAt:new Date().toISOString()}:bot)}));
        setPendingGroupFiles(current=>({...current,[selectedGroupId]:[]}));
        setPendingGroupRunFiles(current=>({...current,[selectedGroupId]:[]}));
        if(selectedGroupId){setDraft('');botMentionTokensRef.current=[];setBotMentionTokens([]);setBotMentionQuery(null)}
      }catch{
        if(submissionStarted){uncertainMutation.current=true;setGroupChat(current=>({...current,status:'error'}));setGroupError('Group message could not be confirmed. Refresh and check the chat before sending again.');}
        else setGroupError('A file could not be uploaded. The draft is still here; retrying may leave an unused upload in this group.');
      }finally{groupSendingRef.current=false;setGroupSending(false)}
      return;
    }
    if (!active || uncertainMutation.current) return;
    const clean = text.trim();
    const selectedFiles = pendingFiles[active.id] || [];
    const selectedRunFiles = pendingRunFiles[active.id] || [];
    if (!clean && !selectedFiles.length && !selectedRunFiles.length) return;
    if (remote) {
      const id = active.id;
      if (sendingRef.current || history.id !== id || history.status !== 'ready') return;
      if (agentFeature === 'loading' || agentFeature === 'error' || (agentFeature === 'enabled' && (runHistory.id !== id || runHistory.status !== 'ready'))) return;
      if (clean.length > 10000) { setBotError('Message is too long.'); return; }
      if (selectedFiles.length + selectedRunFiles.length > attachmentCountLimit) { setBotError('Attach up to 20 files per message.'); return; }
      sendingRef.current = true; setSending(true); setBotError('');
      try {
        if (agentFeature === 'enabled') {
          const uploaded = [] as Array<{id:string}>;
          for (const file of selectedFiles) {
            const upload = await fetch(`${import.meta.env.BASE_URL}api/bots/${id}/files`, { method:'POST', credentials:'same-origin', headers:{'Content-Type':attachmentMimeType(file),'X-File-Name':encodeURIComponent(file.name)}, body:file });
            if (!upload.ok) throw new Error('file upload failed');
            const value = await upload.json() as {file?:{id?:unknown}};
            if (typeof value.file?.id !== 'string') throw new Error('invalid file upload response');
            uploaded.push({id:value.file.id});
          }
          const prompt = clean || 'Please review the attached file(s).';
          const mentionBotIds=[...new Set(botMentionTokensRef.current.flatMap(token=>token.kind==='bot'?[token.botId]:[]))];
          const response = await fetch(`${import.meta.env.BASE_URL}api/bots/${id}/runs`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), prompt, files:[...uploaded.map(file=>file.id),...selectedRunFiles.map(file=>file.id)], ...(mentionBotIds.length?{mentionBotIds}:{}) }) });
          if (!response.ok) throw new Error('run submission failed');
          const { run } = await response.json() as { run: AgentRun };
          if (!run || typeof run.id !== 'string' || typeof run.prompt !== 'string') throw new Error('invalid run response');
          // A newly submitted instruction must remain the last chat item even
          // if a subsequent history poll returns a differently normalized DB
          // timestamp. Otherwise mixed message/run sorting can move it above
          // older history while the scroll viewport correctly stays at bottom.
          latestSubmittedTimelineItemByBot.current[id]=run.id;
          (submittedRunsByBot.current[id]||=Object.create(null))[run.id]=run;
          followMessageGrowth.current=true;
          stickToLatestMessage.current=true;
          setScrollRequest(value=>value+1);
          setRunHistory(current => ({ id, status: 'ready', runs: [...current.runs.filter(item => item.id !== run.id), run] }));
          setState(current => ({ ...current, bots: current.bots.map(bot => bot.id === id ? { ...bot, preview: clean || 'Attached files', lastActivityAt:new Date().toISOString() } : bot) }));
          setPendingFiles(current => ({...current,[id]:[]}));
          setPendingRunFiles(current => ({...current,[id]:[]}));
          botMentionTokensRef.current=[];setBotMentionTokens([]);setBotMentionQuery(null);
          if (activeIdRef.current === id) { setDraft(''); setCustomAnswer(''); }
          setRunRefresh(value => value + 1);
          return;
        }
        const response = await fetch(`${import.meta.env.BASE_URL}api/bots/${id}/messages`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: clean }) });
        if (!response.ok) throw new Error('save failed');
        const { message } = await response.json() as { message: Message };
        if(!message||typeof message.id!=='string')throw new Error('invalid message response');
        latestSubmittedTimelineItemByBot.current[id]=message.id;
        followMessageGrowth.current=true;
        stickToLatestMessage.current=true;
        setScrollRequest(value=>value+1);
        setState(current => ({ ...current, messages: { ...current.messages, [id]: [...(current.messages[id] || []), message] }, bots: current.bots.map(bot => bot.id === id ? { ...bot, preview: clean, lastActivityAt:new Date().toISOString() } : bot) }));
        botMentionTokensRef.current=[];setBotMentionTokens([]);setBotMentionQuery(null);
        if (activeIdRef.current === id) { setDraft(''); setCustomAnswer(''); setNotice(true); }
      } catch {
        uncertainMutation.current = true;
        if (agentFeature === 'enabled') setRunHistory(current => ({ ...current, id, status: 'error' }));
        else setHistory({ id, status: 'error' });
        setBotError('Submission could not be confirmed. Refresh and check the history before trying again.');
      } finally { sendingRef.current = false; setSending(false); }
      return;
    }
    followMessageGrowth.current=true;
    stickToLatestMessage.current=true;
    setScrollRequest(value=>value+1);
    const createdAt=new Date().toISOString();
    const messageId=crypto.randomUUID();
    latestSubmittedTimelineItemByBot.current[active.id]=messageId;
    setState(current => ({ ...current, messages: { ...current.messages, [active.id]: [...(current.messages[active.id] || []), { id: messageId, role: 'user', text: clean, createdAt }] }, bots: current.bots.map(bot => bot.id === active.id ? { ...bot, preview: clean,lastActivityAt:createdAt } : bot), showOnboarding: { ...current.showOnboarding, [active.id]: false } }));
    botMentionTokensRef.current=[];setBotMentionTokens([]);setBotMentionQuery(null);
    setDraft(''); setCustomAnswer(''); setNotice(true);
  }
  function stageFiles(files: File[]) {
    if (!active || !files.length) return;
    const combined = [...(pendingFiles[active.id] || []), ...files];
    if (combined.length + (pendingRunFiles[active.id] || []).length > attachmentCountLimit) { setBotError('Attach up to 20 files per message.'); return; }
    for (const file of combined) {
      const mimeType = attachmentMimeType(file);
      if (!Number.isSafeInteger(file.size) || file.size < 1) { setBotError(`${file.name || 'This file'} is empty or unreadable.`); return; }
      const limit = mimeType.startsWith('image/') ? attachmentImageLimit : mimeType.startsWith('video/') ? attachmentVideoLimit : attachmentDocumentLimit;
      if (file.size > limit) { setBotError(`${file.name} is too large. The limit is ${mimeType.startsWith('image/') ? '25 MB per image' : mimeType.startsWith('video/') ? '1 GB per video' : '250 MB per file'}.`); return; }
    }
    const images = [...(pendingRunFiles[active.id] || []).filter(file=>file.mimeType.startsWith('image/')), ...combined.filter(file => attachmentMimeType(file).startsWith('image/'))];
    if (images.reduce((total, file) => total + file.size, 0) > attachmentImagesTotalLimit) { setBotError('Images exceed the 200 MB total limit per message.'); return; }
    setBotError('');
    setPendingFiles(current => ({ ...current, [active.id]: combined }));
  }
  function stageGroupFiles(files:File[]){
    if(!activeGroup||!files.length)return;
    const current=pendingGroupFiles[activeGroup.id]||[],combined=[...current,...files.map(file=>({key:crypto.randomUUID(),file}))];
    const selectedRunFiles=pendingGroupRunFiles[activeGroup.id]||[];
    if(combined.length+selectedRunFiles.length>attachmentCountLimit){setGroupError('Attach up to 20 files per message.');return}
    for(const item of combined){
      const mimeType=attachmentMimeType(item.file);
      if(!Number.isSafeInteger(item.file.size)||item.file.size<1){setGroupError(`${item.file.name||'This file'} is empty or unreadable.`);return}
      const limit=mimeType.startsWith('image/')?attachmentImageLimit:mimeType.startsWith('video/')?attachmentVideoLimit:attachmentDocumentLimit;
      if(item.file.size>limit){setGroupError(`${item.file.name} is too large. The limit is ${mimeType.startsWith('image/')?'25 MB per image':mimeType.startsWith('video/')?'1 GB per video':'250 MB per file'}.`);return}
    }
    const images=[...combined.filter(item=>attachmentMimeType(item.file).startsWith('image/')).map(item=>item.file.size),...selectedRunFiles.filter(file=>file.mimeType.startsWith('image/')).map(file=>file.size)];
    if(images.reduce((total,size)=>total+size,0)>attachmentImagesTotalLimit){setGroupError('Images exceed the 200 MB total limit per message.');return}
    setGroupError('');setPendingGroupFiles(value=>({...value,[activeGroup.id]:combined}));
  }
  function reuseGroupRunFile(file:RunFile){
    if(!activeGroup||agentFeature!=='enabled')return;
    const current=pendingGroupRunFiles[activeGroup.id]||[],localFiles=pendingGroupFiles[activeGroup.id]||[];
    if(current.some(item=>item.id===file.id))return;
    if(current.length+localFiles.length>=attachmentCountLimit){setGroupError('Attach up to 20 files per message.');return}
    const mimeType=file.mimeType,limit=mimeType.startsWith('image/')?attachmentImageLimit:mimeType.startsWith('video/')?attachmentVideoLimit:attachmentDocumentLimit;
    const imageBytes=current.filter(item=>item.mimeType.startsWith('image/')).reduce((total,item)=>total+item.size,0)+localFiles.filter(item=>attachmentMimeType(item.file).startsWith('image/')).reduce((total,item)=>total+item.file.size,0);
    if(!Number.isSafeInteger(file.size)||file.size<1||file.size>limit){setGroupError(`${file.name} is too large or unavailable for attachment.`);return}
    if(mimeType.startsWith('image/')&&imageBytes+file.size>attachmentImagesTotalLimit){setGroupError('Images exceed the 200 MB total limit per message.');return}
    setGroupError('');setPendingGroupRunFiles(value=>({...value,[activeGroup.id]:[...(value[activeGroup.id]||[]),file]}));
  }
  function reuseRunFile(file: RunFile) {
    if (!active || agentFeature !== 'enabled') return;
    const current = pendingRunFiles[active.id] || [];
    if (current.some(item => item.id === file.id)) return;
    if (current.length + (pendingFiles[active.id] || []).length >= attachmentCountLimit) { setBotError('Attach up to 20 files per message.'); return; }
    const currentImageSize=current.filter(item=>item.mimeType.startsWith('image/')).reduce((total,item)=>total+item.size,0)+(pendingFiles[active.id]||[]).filter(item=>attachmentMimeType(item).startsWith('image/')).reduce((total,item)=>total+item.size,0);
    if(file.mimeType.startsWith('image/')&&(file.size>attachmentImageLimit||currentImageSize+file.size>attachmentImagesTotalLimit)){setBotError('Images exceed the per-file or 200 MB total limit per message.');return}
    setBotError('');
    setPendingRunFiles(value => ({ ...value, [active.id]: [...(value[active.id] || []), file] }));
  }
  function renameBot(name: string) {
    if (!active) return;
    setState(current => ({ ...current, bots: current.bots.map(bot => bot.id === active.id ? { ...bot, name: name.slice(0, 60) } : bot) }));
  }
  function saveBotName(id: string, draftName: string) {
    const name = draftName.trim();
    if (!remote) { if (name) setState(current=>({...current,bots:current.bots.map(bot=>bot.id===id&&bot.name===draftName?{...bot,name}:bot)})); return; }
    const restore = () => setState(current => ({ ...current, bots: current.bots.map(bot => bot.id === id && bot.name === draftName ? { ...bot, name: savedNames.current[id] || 'New Bot' } : bot) }));
    if (!name) {
      setBotError('Bot name cannot be empty.');
      void (renameQueue.current[id] || Promise.resolve()).then(restore);
      return;
    }
    setBotError('');
    const previous = renameQueue.current[id] || Promise.resolve();
    const next = previous.then(async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}api/bots/${id}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        if (!response.ok) throw new Error('rename failed');
        const saved = await response.json() as { ok?: boolean; event?: Message };
        if (saved.ok !== true) throw new Error('rename was not confirmed');
        savedNames.current[id] = name;
        if(saved.event)latestSubmittedTimelineItemByBot.current[id]=saved.event.id;
        setState(current => ({
          ...current,
          messages: saved.event ? { ...current.messages, [id]: [...(current.messages[id] || []).filter(message => message.id !== saved.event!.id), saved.event] } : current.messages,
          bots: current.bots.map(bot => bot.id === id && bot.name === draftName ? { ...bot, name } : bot),
        }));
      } catch { setBotError('Could not confirm the Bot name was saved. Refresh to check.'); }
    });
    renameQueue.current[id] = next;
    void next.finally(() => { if (renameQueue.current[id] === next) delete renameQueue.current[id]; });
  }
  function beginSidebarRename(id:string) {
    const bot=state.bots.find(item=>item.id===id);if(!bot)return;
    const edit={id,value:bot.name};sidebarRenameRef.current=edit;setSidebarRename(edit);setSidebarMenu(null);
  }
  function finishSidebarRename(id:string,value:string) {
    if(sidebarRenameRef.current?.id!==id)return;
    sidebarRenameRef.current=null;setSidebarRename(null);
    const name=value.trim();
    if(!name){setBotError('Bot name cannot be empty.');return}
    setState(current=>({...current,bots:current.bots.map(bot=>bot.id===id?{...bot,name:value}:bot)}));
    saveBotName(id,value);
  }
  function saveBotLabel() {
    if(!active)return;
    const id=active.id,draftLabel=active.label,label=draftLabel.trim();
    if(!remote){setState(current=>({...current,bots:current.bots.map(bot=>bot.id===id&&bot.label===draftLabel?{...bot,label}:bot)}));return}
    const previous=labelQueue.current[id] || Promise.resolve();
    const next=previous.then(async()=>{
      try{
        const response=await fetch(`${import.meta.env.BASE_URL}api/bots/${id}`,{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({label})});
        if(!response.ok)throw new Error('label update failed');
        savedLabels.current[id]=label;
        setState(current=>({...current,bots:current.bots.map(bot=>bot.id===id&&bot.label===draftLabel?{...bot,label}:bot)}));
      }catch{
        setState(current=>({...current,bots:current.bots.map(bot=>bot.id===id&&bot.label===draftLabel?{...bot,label:savedLabels.current[id]||''}:bot)}));
        setBotError('Could not save the Bot label. Please try again.');
      }
    });
    labelQueue.current[id]=next;void next.finally(()=>{if(labelQueue.current[id]===next)delete labelQueue.current[id]});
  }
  function changeSidebarState(id:string,field:'pinned'|'hidden',value:boolean) {
    setSidebarMenu(null);setBotError('');
    setState(current=>({...current,bots:current.bots.map(bot=>bot.id===id?{...bot,[field]:value}:bot)}));
    if(!remote)return;
    const key=`${id}:${field}`,sequence=(sidebarSequence.current[key]||0)+1;
    sidebarSequence.current[key]=sequence;
    const next=(sidebarQueue.current[key]||Promise.resolve()).then(async()=>{
      try {
        const response=await fetch(`${import.meta.env.BASE_URL}api/bots/${id}`,{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({[field]:value})});
        if(!response.ok)throw new Error('sidebar update failed');
      }catch{if(sidebarSequence.current[key]===sequence)setBotError('Could not confirm the sidebar change was saved. Refresh to check.')}
    });
    sidebarQueue.current[key]=next;void next.finally(()=>{if(sidebarQueue.current[key]===next)delete sidebarQueue.current[key]});
  }
  function openAvatar() {
    if (!active) return;
    const selected = { id: active.id, shape: active.shape, color: active.color };
    avatarEditorRef.current = selected; setAvatarEditor(selected);
  }
  function closeAvatar() {
    avatarEditorRef.current = null; setAvatarEditor(null);
    avatarButton.current?.focus();
  }
  function chooseAvatar(change: Partial<Pick<Bot, 'shape' | 'color'>>) {
    const previous = avatarEditorRef.current;
    if (!previous) return;
    const selected = { ...previous, ...change };
    if (selected.shape === previous.shape && selected.color === previous.color) return;
    avatarEditorRef.current = selected; setAvatarEditor(selected); setBotError('');
    setState(current => ({ ...current, bots: current.bots.map(bot => bot.id === selected.id ? { ...bot, shape: selected.shape, color: selected.color } : bot) }));
    if (!remote) return;
    const sequence = (avatarSequence.current[selected.id] || 0) + 1;
    avatarSequence.current[selected.id] = sequence;
    const next = (avatarQueue.current[selected.id] || Promise.resolve()).then(async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}api/bots/${selected.id}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shape: selected.shape, color: selected.color }) });
        if (!response.ok) throw new Error('avatar update failed');
        if (avatarSequence.current[selected.id] === sequence) setBotError('');
      } catch {
        if (avatarSequence.current[selected.id] === sequence) setBotError('Could not confirm the Bot picture was saved. Refresh to check.');
      }
    });
    avatarQueue.current[selected.id] = next;
    void next.finally(() => { if (avatarQueue.current[selected.id] === next) delete avatarQueue.current[selected.id]; });
  }
  function startSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sidebarResizeStart.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: layoutSidebarWidth };
    if (panel && !panelSidebarExpanded) {
      setSidebarWidth(layoutSidebarWidth);
      setPanelSidebarExpanded(true);
    }
  }
  function moveSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    const start = sidebarResizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setSidebarWidth(clampProductSidebarWidth(start.startWidth + event.clientX - start.startX));
  }
  function finishSidebarResize(event: React.PointerEvent<HTMLDivElement>) {
    if (sidebarResizeStart.current?.pointerId !== event.pointerId) return;
    sidebarResizeStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function adjustSidebarResize(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); setPanelSidebarExpanded(true); setSidebarWidth(clampProductSidebarWidth(layoutSidebarWidth - 16)); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); setPanelSidebarExpanded(true); setSidebarWidth(clampProductSidebarWidth(layoutSidebarWidth + 16)); }
    else if (event.key === 'Home') { event.preventDefault(); setPanelSidebarExpanded(true); setSidebarWidth(PRODUCT_SIDEBAR_MIN); }
    else if (event.key === 'End') { event.preventDefault(); setPanelSidebarExpanded(true); setSidebarWidth(productSidebarMax()); }
  }
  function startComputerPanelResize(event: React.PointerEvent<HTMLDivElement>) {
    if (!account || window.innerWidth <= 760 || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    computerPanelResizeStart.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: computerPanelWidth };
  }
  function moveComputerPanelResize(event: React.PointerEvent<HTMLDivElement>) {
    const start = computerPanelResizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setComputerPanelWidth(clampProductPanelWidth(start.startWidth + start.startX - event.clientX, layoutSidebarWidth));
  }
  function finishComputerPanelResize(event: React.PointerEvent<HTMLDivElement>) {
    if (computerPanelResizeStart.current?.pointerId !== event.pointerId) return;
    computerPanelResizeStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function adjustComputerPanelResize(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); setComputerPanelWidth(width => clampProductPanelWidth(width + 16, layoutSidebarWidth)); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); setComputerPanelWidth(width => clampProductPanelWidth(width - 16, layoutSidebarWidth)); }
    else if (event.key === 'Home') { event.preventDefault(); setComputerPanelWidth(productPanelMin()); }
    else if (event.key === 'End') { event.preventDefault(); setComputerPanelWidth(productPanelMax(layoutSidebarWidth)); }
  }
  function openProductPanel(nextTab: 'Details' | 'Library' | 'Computer' = activeGroup ? 'Details' : 'Computer') {
    setPanelSidebarExpanded(false);
    setTab(nextTab);
    setPanel(true);
  }
  function closeProductPanel() {
    setPanelSidebarExpanded(false);
    setPanel(false);
  }
  function toggleProductPanel() {
    if (panel) closeProductPanel();
    else openProductPanel();
  }
  function openNewChat() {
    if (reference || remote && agentFeature === 'enabled') { setRecipientQuery(''); setNewChat(true); setPanel(false); }
    else beginCreate();
  }
  const renderBotRow=(bot:Bot)=><div className="bot-row-wrap" key={bot.id}><button ref={element=>{sidebarRows.current[bot.id]=element}} type="button" data-bot-id={bot.id} className={`bot-row ${!newChat && !activeGroup && bot.id === active?.id ? 'selected' : ''}`} aria-label={layoutSidebarWidth <= 140 ? `Open ${bot.name}` : undefined} title={layoutSidebarWidth <= 140 ? bot.name : undefined} aria-haspopup="menu" onClick={() => selectBot(bot.id)} onContextMenu={event=>{event.preventDefault();setSidebarMenu({id:bot.id,x:Math.max(0,Math.min(event.clientX,window.innerWidth-200)),y:Math.max(0,Math.min(event.clientY,window.innerHeight-265))})}}>
          <Avatar bot={bot} size={46} /><span className="bot-row-content"><span className="bot-row-title"><span onDoubleClick={event=>{event.stopPropagation();beginSidebarRename(bot.id)}}>{bot.name}</span>{bot.label && <small>{bot.label}</small>}<time dateTime={bot.lastActivityAt||undefined}>{formatBotTime(bot.lastActivityAt)}</time></span><span className="bot-preview">{bot.preview}</span></span>
        </button>{sidebarRename?.id===bot.id && <input ref={sidebarInput} className="sidebar-rename" aria-label="Rename Bot" maxLength={60} value={sidebarRename.value} onChange={event=>{const edit={id:bot.id,value:event.target.value};sidebarRenameRef.current=edit;setSidebarRename(edit)}} onBlur={event=>finishSidebarRename(bot.id,event.currentTarget.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur()}else if(event.key==='Escape'){event.preventDefault();sidebarRenameRef.current=null;setSidebarRename(null);sidebarRows.current[bot.id]?.focus()}}} />}</div>;
  const latestComputerRunId=runHistory.runs.filter(run=>run.computerUsed).at(-1)?.id;
  const groupComposerDisabled=remote&&(groupSending||groupChat.id!==selectedGroupId||groupChat.status!=='ready'||agentFeature!=='enabled'||uncertainMutation.current);
  const composerDisabled = activeGroup ? groupComposerDisabled : remote && (sending || history.id !== active?.id || history.status !== 'ready' || agentFeature === 'loading' || agentFeature === 'error' || (agentFeature === 'enabled' && (runHistory.id !== active?.id || runHistory.status !== 'ready')));
  if (botStatus === 'loading') return <main className="auth-page"><div className="auth-card">Loading your Bots…</div></main>;
  if (botStatus === 'error') return <main className="auth-page"><div className="auth-card"><p role="alert">Could not load your Bots.</p><button type="button" onClick={() => window.location.reload()}>Try again</button></div></main>;

  return <div className={`app ${reference ? 'reference-mode' : 'preview-mode'} ${account ? 'product-shell' : ''} ${account && layoutSidebarWidth <= 140 ? 'sidebar-collapsed' : ''}`} style={{ '--sidebar-width': `${layoutSidebarWidth}px`, '--computer-panel-width': `${computerPanelWidth}px` } as React.CSSProperties}>
    <aside className="sidebar" aria-label="Bots">
      <div className="sidebar-top">{!account && <IconButton name="search" label="Search bots" onClick={() => { setSearching(value => !value); setQuery(''); }} />}<IconButton buttonRef={createTrigger} name="plus" label="New chat" onClick={openNewChat} /></div>
      {account && <label className="product-search"><Icon name="search" /><input aria-label="Search bots" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} /></label>}
      {searching && <input className="search-input" aria-label="Search bots" value={query} placeholder="Search bots" onChange={event => setQuery(event.target.value)} />}
      <button className="primary-bot" type="button" onClick={() => setNotice(true)} aria-label="Primary bot preview"><Avatar bot={primary} size={80} /><span>{primary.name}</span><small>{primary.label}</small></button>
      <div className="sidebar-scroll">
        {reference && <><div className="section-line"><span>OLD</span><span>3</span></div><div className="section-line"><span>MISC</span><span>3</span></div></>}
        <div className="section-line unassigned"><span>Unassigned</span></div>
        {visibleBots.map(renderBotRow)}
        {hiddenBots.length>0 && <><button type="button" className="hidden-section" aria-expanded={hiddenOpen} onClick={()=>setHiddenOpen(value=>!value)}><span>{hiddenOpen?'⌄':'›'}&nbsp; Hidden Bots</span><span>{hiddenBots.length}</span></button>{hiddenOpen && hiddenBots.map(renderBotRow)}</>}
        {filteredGroups.length>0&&<><div className="section-line group-section-heading"><span>Groups</span></div>{filteredGroups.map(group=><button key={group.id} type="button" className={`bot-row group-row ${selectedGroupId===group.id&&!newChat?'selected':''}`} onClick={()=>selectGroup(group.id)} aria-label={`Open group ${group.name}`} title={layoutSidebarWidth<=140?group.name:undefined}><GroupAvatar members={group.members} size={38}/><span className="bot-row-content"><span className="bot-row-title"><span>{group.name}</span><time dateTime={group.lastActivityAt||undefined}>{formatBotTime(group.lastActivityAt)}</time></span><span className="bot-preview">{group.preview}</span></span></button>)}</>}
        {filtered.length === 0&&filteredGroups.length===0 && <p className="empty-list">No matching bots</p>}
      </div>
      {account && <div className="sidebar-rail-actions"><IconButton name="plus" label="New chat" onClick={openNewChat} /></div>}
      {reference && <button type="button" className="more-unreads">↓&nbsp; More unreads</button>}
      <div className="sidebar-footer">{account ? <>
        <button type="button" className="account-control" aria-label="Account menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(value => !value)}><span className="account-dot">{account.name.slice(0, 1).toUpperCase()}</span><span className="account-name">{account.name}</span></button>
        {accountMenuOpen && <div className="account-menu" role="menu" aria-label="Account"><button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setTeamDialogOpen(true); }}>Workspaces & team</button><button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); if(active)setConnectAppsOpen(true);else setNotice(true); }}>Connect apps</button><button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); onLogout?.(); }}>Sign out</button></div>}
      </> : <><div className="account-dot">M</div><button type="button" className="connect-button" onClick={() => setNotice(true)}>Connect apps <span aria-hidden="true">◈◉▣</span></button></>}</div>
    </aside>
    {account && <div className="sidebar-resize-handle" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={PRODUCT_SIDEBAR_MIN} aria-valuemax={productSidebarMax()} aria-valuenow={Math.round(layoutSidebarWidth)} tabIndex={0} onPointerDown={startSidebarResize} onPointerMove={moveSidebarResize} onPointerUp={finishSidebarResize} onPointerCancel={finishSidebarResize} onKeyDown={adjustSidebarResize} onDoubleClick={() => setSidebarWidth(clampProductSidebarWidth(Math.max(280, Math.round(window.innerWidth * 0.28))))} />}
    {sidebarMenu && <div ref={sidebarMenuElement} role="menu" aria-label="Bot actions" className="sidebar-context-menu" style={{left:sidebarMenu.x,top:sidebarMenu.y}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();const id=sidebarMenu.id;setSidebarMenu(null);sidebarRows.current[id]?.focus()}}}>
      <button type="button" role="menuitem" onClick={()=>menuBot&&changeSidebarState(menuBot.id,'pinned',!menuBot.pinned)}><BotMenuIcon name="pin" />{menuBot?.pinned?'Unpin':'Pin'}</button>
      <button type="button" role="menuitem" disabled title="Not available yet"><BotMenuIcon name="folder" />Move to new section</button>
      <button type="button" role="menuitem" disabled title="Not available yet"><BotMenuIcon name="unread" />Mark as Unread</button>
      <div className="sidebar-menu-divider" />
      <button type="button" role="menuitem" onClick={()=>beginSidebarRename(sidebarMenu.id)}><BotMenuIcon name="rename" />Rename Bot</button>
      <div className="sidebar-menu-divider" />
      <button type="button" role="menuitem" disabled title="Not available yet"><BotMenuIcon name="copy" />Copy conversation ID</button>
      <div className="sidebar-menu-divider" />
      <button type="button" role="menuitem" onClick={()=>menuBot&&changeSidebarState(menuBot.id,'hidden',!menuBot.hidden)}><BotMenuIcon name="hide" />{menuBot?.hidden?'Show in sidebar':'Hide from sidebar'}</button>
      <button type="button" role="menuitem" disabled title="Not available yet" className="danger"><BotMenuIcon name="delete" />Delete</button>
    </div>}
    <main className="main-shell">
      {!reference && <div className="preview-notice" role="status">{remote ? (agentFeature === 'enabled' ? `${agentEngine === 'dsh' ? 'DeepSeek Harness' : 'Pi'} runs tasks on your persistent user computer. Bots share files and sign-ins; each Bot has its own screen, and tasks queue per screen.` : 'Bots and messages are stored on the server; the cloud computer and Agent are not connected. Local preview data is not imported.') : 'Local UI preview: data is stored only in this browser. No cloud computer or Agent is connected.'}</div>}
      {remote && agentFeature === 'error' && <div role="alert">Could not check Agent availability. Refresh to try again.</div>}
      {botError && !createDialog && <div role="alert">{botError}</div>}
      {newChat || !active ? <div className="new-chat-view" onKeyDown={event=>{if(event.key==='Escape'&&active){setNewChat(false);setRecipientQuery('')}}}>
        <div className="new-chat-head"><label>To: <input ref={recipientInput} aria-label="Start a chat with" placeholder="Start a chat with..." value={recipientQuery} onChange={event=>setRecipientQuery(event.target.value)} /></label><IconButton name="close" label="Close new chat" onClick={() => {setNewChat(false);setRecipientQuery('')}} /></div>
        <div className="new-chat-menu" aria-label="Chat recipients"><button type="button" className="menu-option menu-primary" onClick={()=>reference?void createBot():beginCreate()}><Icon name="plus" />Create new Bot</button><button type="button" className="menu-option" disabled={remote&&agentFeature==='enabled'&&state.bots.length<2} onClick={() => remote&&agentFeature==='enabled'?beginGroupCreate():setNotice(true)}><span className="menu-symbol">♧</span>Create group chat</button>{[primary, ...state.bots.filter(bot=>!reference || bot.id!=='new')].filter(bot=>`${bot.name} ${bot.label}`.toLowerCase().includes(recipientQuery.trim().toLowerCase())).map(bot => <button key={bot.id} type="button" className="menu-option" onClick={() => bot.id === primary.id ? setNotice(true) : selectBot(bot.id)}><Avatar bot={bot} size={27} />{bot.name}</button>)}<button type="button" className="menu-option team-option" onClick={() => setNotice(true)}><span>🟣</span>Team Bots <span className="menu-arrow">›</span></button></div>
        <div className="composer new-chat-composer"><IconButton name="plus" label="Add attachment" onClick={() => setNotice(true)} /><textarea aria-label="Message Bot" placeholder="Message Bot" disabled rows={1} /><IconButton name="mic" label="Voice input" className="voice-button" onClick={() => setNotice(true)} /></div>
      </div> : <>
        <div className={`chat-header ${panel ? 'panel-open' : ''}`}><button type="button" className="chat-title" onClick={()=>openProductPanel('Details')}>{activeGroup?<GroupAvatar members={activeGroup.members} size={30}/>:<Avatar bot={active} size={30}/>}<span>{activeGroup?.name||active.name}</span></button></div>
        <div className={`header-actions ${panel ? 'panel-open' : ''}`}><IconButton name="share" label={activeGroup?'Share group':'Share bot'} onClick={() => setNotice(true)} /><IconButton name={account && !panel ? 'screen' : 'panel'} label={panel ? account ? 'Hide computer' : 'Hide bot details' : account ? `Open ${activeGroup?.name||active.name}'s computer` : 'Show bot details'} onClick={toggleProductPanel} /></div>
        <div className={`workspace ${panel ? 'with-panel' : ''}`}>
          <section className="conversation" aria-label={activeGroup?`Group chat ${activeGroup.name}`:`Chat with ${active.name}`} onDragOver={event=>{if(remote&&agentFeature==='enabled'&&Array.from(event.dataTransfer.types).includes('Files'))event.preventDefault()}} onDrop={event=>{if(!remote||agentFeature!=='enabled'||!event.dataTransfer.files.length)return;event.preventDefault();event.stopPropagation();const dropped=Array.from(event.dataTransfer.files);activeGroup?stageGroupFiles(dropped):stageFiles(dropped)}}>
            <div className="message-scroll" ref={messageScroll}>
              <div className="message-content" ref={messageContent}>
              {activeGroup ? <>
                {groupChat.id===activeGroup.id&&groupChat.status==='loading'&&<div role="status">Loading group chat…</div>}
                {groupChat.id===activeGroup.id&&groupChat.status==='error'&&<div role="alert">Could not confirm this group chat. Checking again; refresh before submitting another task.</div>}
                {groupChat.id===activeGroup.id&&groupChat.view?.messages.map((message,index,messages)=>renderGroupChatMessage(message,index,messages,activeGroup))}
                {groupChat.id===activeGroup.id&&groupChat.view?.messages.length===0&&<div className="empty-chat group-empty"><GroupAvatar members={activeGroup.members} size={56}/><p>Start a conversation with {activeGroup.name}.</p><small>{activeGroup.members.length} Bots are ready to work on their own computers.</small></div>}
                {groupError&&<div className="local-feedback" role="status">{groupError}</div>}
              </> : <>
              {remote && history.id === active.id && history.status === 'loading' && <div role="status">Loading messages…</div>}
              {remote && history.id === active.id && history.status === 'error' && <div role="alert">Could not confirm message history. Refresh to check it.</div>}
              {botTimeline.map((entry,index,entries)=>{
                const previousAt=index>0?entries[index-1].at:null;
                const showTimestamp=shouldShowChatTimestamp(entry.at,previousAt);
                return <React.Fragment key={entry.key}>
                  {showTimestamp&&<div className="date-line"><time dateTime={new Date(entry.at).toISOString()}>{formatChatTimestamp(entry.at)}</time></div>}
                  {renderBotTimelineEntry(entry)}
                </React.Fragment>;
              })}
              {remote && agentFeature === 'enabled' && runHistory.id === active.id && runHistory.status === 'error' && <div role="alert">Could not confirm task history. Checking again; refresh before submitting another task.</div>}
              {state.showOnboarding[active.id] && <div className="onboarding-card">
                <div className="onboarding-title">What do you want me helping with most right now?<IconButton name="close" label="Dismiss suggestions" onClick={() => setState(current => ({ ...current, showOnboarding: { ...current.showOnboarding, [active.id]: false } }))} /></div>
                <div className="choice-list">{['Work & projects', 'Email & Slack', 'Calendar & scheduling', 'Research & writing', 'Something else'].map((option, index) => <button key={option} type="button" onClick={() => addMessage(option)}><span className="choice-key">{String.fromCharCode(65 + index)}</span><span>{option}{index === 4 && <small>I’ll tell you in chat</small>}</span></button>)}</div>
                <form onSubmit={event => { event.preventDefault(); addMessage(customAnswer); }}><input aria-label="Type your own answer" placeholder="Type your own answer" value={customAnswer} onChange={event => setCustomAnswer(event.target.value)} /></form>
                <div className="card-actions" aria-hidden="true"><Icon name="smile" /><Icon name="reply" /><Icon name="more" /></div>
              </div>}
              {!reference && !messages.length && !(agentFeature === 'enabled' && runHistory.id === active.id && runHistory.runs.length) && <div className="empty-chat"><Avatar bot={active} size={52} /><p>Start a conversation with {active.name}.</p>{agentFeature !== 'enabled' && <small>This local preview does not connect to a model.</small>}</div>}
              {notice && <div className="local-feedback" role="status">{remote ? 'No message was sent to an Agent.' : 'This is a local preview. No message was sent to an Agent or external service.'}</div>}
              </>}
              </div>
            </div>
            {remote && agentFeature === 'enabled' && <input ref={filePicker} className="file-picker" type="file" multiple aria-label="Choose files to attach" onChange={event=>{const selected=Array.from(event.currentTarget.files||[]);activeGroup?stageGroupFiles(selected):stageFiles(selected);event.currentTarget.value=''}}/>}
            {activeGroup&&remote&&agentFeature==='enabled'&&((pendingGroupFiles[activeGroup.id]||[]).length+(pendingGroupRunFiles[activeGroup.id]||[]).length)>0&&<div className="pending-files" aria-label="Files to attach">{(pendingGroupRunFiles[activeGroup.id]||[]).map((file,index)=><span className="pending-file" key={`run:${file.id}`}><span>{file.name}</span><button type="button" aria-label={`Remove reused ${file.name}`} disabled={groupSending} onClick={()=>setPendingGroupRunFiles(current=>({...current,[activeGroup.id]:(current[activeGroup.id]||[]).filter((_,itemIndex)=>itemIndex!==index)}))}>×</button></span>)}{(pendingGroupFiles[activeGroup.id]||[]).map(item=><span className="pending-file" key={item.key}><span>{item.file.name}{item.uploadedId?' · Ready':''}</span><button type="button" aria-label={`Remove ${item.file.name}`} disabled={groupSending} onClick={()=>setPendingGroupFiles(current=>({...current,[activeGroup.id]:(current[activeGroup.id]||[]).filter(file=>file.key!==item.key)}))}>×</button></span>)}</div>}
            {remote && agentFeature === 'enabled' && ((pendingFiles[active.id]||[]).length+(pendingRunFiles[active.id]||[]).length)>0 && <div className="pending-files" aria-label="Files to attach">{(pendingRunFiles[active.id]||[]).map((file,index)=><span className="pending-file" key={`run:${file.id}`}><span>{file.name}</span><button type="button" aria-label={`Remove reused ${file.name}`} onClick={()=>setPendingRunFiles(current=>({...current,[active.id]:(current[active.id]||[]).filter((_,itemIndex)=>itemIndex!==index)}))}>×</button></span>)}{(pendingFiles[active.id]||[]).map((file,index)=><span className="pending-file" key={`local:${file.name}:${file.lastModified}:${index}`}><span>{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={()=>setPendingFiles(current=>({...current,[active.id]:(current[active.id]||[]).filter((_,itemIndex)=>itemIndex!==index)}))}>×</button></span>)}</div>}
            {botMentionQuery&&botMentionCandidates.length>0&&<div id="bot-mention-list" className="group-mention-menu" role="listbox" aria-label={activeGroup?'Mention a Bot or everyone':'Mention a Bot'}>{botMentionCandidates.map((candidate,index)=><button id={`bot-mention-option-${candidate.id}`} key={candidate.id} type="button" role="option" aria-selected={index===botMentionActiveIndex} onMouseDown={event=>event.preventDefault()} onClick={()=>selectBotMention(candidate)}>{candidate.kind==='everyone'?<span className="everyone-mention-avatar" aria-hidden="true">@</span>:<Avatar bot={candidate.bot} size={25}/>}<span><strong>{candidate.kind==='everyone'?'@everyone':candidate.bot.name}</strong>{candidate.kind==='everyone'?<small>Message every Bot in this group</small>:candidate.bot.label&&<small>{candidate.bot.label}</small>}</span><small>{candidate.kind==='everyone'?'Group':'Bot'}</small></button>)}</div>}
            {dictationNotice&&<div className="dictation-status" role="status">{dictationNotice}</div>}
            <form className={`composer ${dictationState==='recording'?'is-listening':''}`} onSubmit={event=>{event.preventDefault();void addMessage(draft)}}>
              <IconButton name="plus" label="Add attachment" onClick={()=>remote&&agentFeature==='enabled'?filePicker.current?.click():setNotice(true)}/>
              <textarea ref={activeGroup?groupComposer:composerInput} aria-label={`Message ${activeGroup?.name||active.name}`} placeholder={`Message ${activeGroup?.name||active.name}`} value={draft} rows={1} disabled={composerDisabled||dictationState!=='idle'} aria-autocomplete={botMentionQuery?'list':undefined} aria-expanded={botMentionQuery?Boolean(botMentionCandidates.length):undefined} aria-controls={botMentionQuery&&botMentionCandidates.length?'bot-mention-list':undefined} aria-activedescendant={botMentionQuery&&botMentionCandidates[botMentionActiveIndex]?`bot-mention-option-${botMentionCandidates[botMentionActiveIndex].id}`:undefined} onChange={event=>updateBotMentionDraft(event.currentTarget.value,event.currentTarget.selectionStart)} onPaste={event=>{if(!remote||agentFeature!=='enabled')return;const pasted=Array.from(event.clipboardData.files||[]);if(!pasted.length)return;event.preventDefault();activeGroup?stageGroupFiles(pasted):stageFiles(pasted)}} onKeyDown={handleComposerKeyDown}/>
              {dictationState==='recording'&&<span className="dictation-live" aria-live="polite">Listening… {String(Math.floor(dictationSeconds/60)).padStart(2,'0')}:{String(dictationSeconds%60).padStart(2,'0')}</span>}
              <button type="button" className={`icon-button dictation-button ${dictationState==='recording'?'recording':''}`} aria-label={dictationState==='recording'?'Stop voice input':'Start voice input'} title={dictationState==='recording'?'Stop voice input':'Start voice input'} disabled={dictationState==='transcribing'||(dictationState==='idle'&&composerDisabled)} onClick={()=>void toggleVoiceInput()}><Icon name="mic"/></button>
              {draft.trim()||(activeGroup?((pendingGroupFiles[activeGroup.id]||[]).length+(pendingGroupRunFiles[activeGroup.id]||[]).length)>0:((pendingFiles[active.id]||[]).length+(pendingRunFiles[active.id]||[]).length)>0)?<button type="submit" className="send-button" disabled={composerDisabled||dictationState!=='idle'} aria-label={remote?'Send task':'Save local message'}><Icon name="arrow"/></button>:<IconButton name="sound" label="Start voice chat" className="voice-button" disabled={dictationState!=='idle'||composerDisabled||Boolean(activeGroup)||!remote||agentFeature!=='enabled'||!voiceAvailable} onClick={()=>{if(active&&remote&&agentFeature==='enabled'&&voiceAvailable&&!activeGroup)setVoiceChatBotId(active.id);else setNotice(true)}}/>}
            </form>
          </section>
          {account && panel && <div className="computer-panel-resize-handle" role="separator" aria-label="Resize computer panel" aria-orientation="vertical" aria-valuemin={productPanelMin()} aria-valuemax={productPanelMax(layoutSidebarWidth)} aria-valuenow={Math.round(computerPanelWidth)} aria-valuetext={`${Math.round(computerPanelWidth)} pixels`} tabIndex={0} onPointerDown={startComputerPanelResize} onPointerMove={moveComputerPanelResize} onPointerUp={finishComputerPanelResize} onPointerCancel={finishComputerPanelResize} onKeyDown={adjustComputerPanelResize} onDoubleClick={() => setComputerPanelWidth(initialProductPanelWidth('', layoutSidebarWidth, ''))} />}
          {panel && (activeGroup?<aside className="details-panel group-details-panel" aria-label="Group details"><GroupAvatar members={activeGroup.members} size={80}/><div className="group-panel-name">{activeGroup.name}</div><div className="group-panel-count">{activeGroup.members.length} Bots</div><div className="tabs"><button type="button" className={tab==='Details'?'active':''} onClick={()=>setTab('Details')}>Details</button><button type="button" className={tab==='Computer'?'active':''} onClick={()=>setTab('Computer')}>Computer</button></div>{tab==='Computer'?remote&&agentFeature==='enabled'?<ComputerPanel name={activeGroup.members.find(member=>member.id===groupComputerBotId)?.name||activeGroup.members[0].name} botId={groupComputerBotId||activeGroup.members[0].id}/>:<div className="computer-preview"><Icon name="screen"/><span>Computer not connected</span></div>:<div className="group-member-list" aria-label="Group members">{activeGroup.members.map(member=><div className="group-member" key={member.id}><Avatar bot={member} size={30}/><span><strong>{member.name}</strong>{member.label&&<small>{member.label}</small>}</span><button type="button" onClick={()=>{setGroupComputerBotId(member.id);setTab('Computer')}}>Computer</button></div>)}</div>}</aside>:<aside className="details-panel" aria-label="Bot details"><button type="button" className="avatar-edit" ref={avatarButton} aria-label="Change Bot picture" onClick={openAvatar}><Avatar bot={active} size={86} /></button><input className="bot-name" aria-label="Bot name" value={active.name} onChange={event => renameBot(event.target.value)} onBlur={() => saveBotName(active.id,active.name)} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}} /><input className="bot-label" aria-label="Bot label" placeholder="Add a label" maxLength={60} value={active.label} onChange={event=>{const label=event.target.value;setState(current=>({...current,bots:current.bots.map(bot=>bot.id===active.id?{...bot,label}:bot)}))}} onBlur={saveBotLabel} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}} /><div className="tabs">{(['Details', 'Library', 'Computer'] as const).map(name => <button key={name} type="button" className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>)}</div>{tab === 'Computer' ? remote && agentFeature === 'enabled' ? <ComputerPanel name={active.name} botId={active.id} official bot={active} onClose={()=>setPanel(false)} onRename={renameBot} onSaveName={()=>saveBotName(active.id,active.name)} onLabelChange={label=>setState(current=>({...current,bots:current.bots.map(bot=>bot.id===active.id?{...bot,label}:bot)}))} onSaveLabel={saveBotLabel} onChangeAvatar={openAvatar} onEditRoutine={name=>{setDraft(`Edit your routine: ${name}`);setPanel(false);requestAnimationFrame(()=>composerInput.current?.focus())}} /> : <><div className="computer-preview"><Icon name="screen" />{!reference && <span>Computer not connected</span>}</div><div className="screen-label">{active.name || 'Bot'}'s screen</div></> : tab === 'Library' ? (remote ? <BotLibrary botId={active.id} onPreview={setPreviewFile}/> : <div className="panel-placeholder">No local files in this preview.</div>) : <div className="panel-placeholder">Routines and connections are not available in this preview.</div>}</aside>)}
        </div>
      </>}
      {voiceChatBotId&&<VoiceChatOverlay botId={voiceChatBotId} botName={state.bots.find(bot=>bot.id===voiceChatBotId)?.name||'Bot'} isActiveBot={active?.id===voiceChatBotId&&!activeGroup&&!newChat} onReturnToBot={()=>selectBot(voiceChatBotId)} onSaved={()=>setVoiceTranscriptRefresh(value=>value+1)} onClose={()=>setVoiceChatBotId(null)}/>}
      {groupCreateDialog&&<div className="create-overlay" onMouseDown={event=>{if(event.target===event.currentTarget&&!groupSaving)setGroupCreateDialog(null)}}><form className="group-create-dialog" role="dialog" aria-modal="true" aria-labelledby="group-create-title" onSubmit={event=>{event.preventDefault();void createGroup()}} onKeyDown={event=>{if(event.key==='Escape'&&!groupSaving){event.preventDefault();setGroupCreateDialog(null)}else if(event.key==='Tab'){const choices=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)'));const first=choices[0],last=choices.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}}}>
        <header><div><strong id="group-create-title">Create group chat</strong><span>Select 2 to 6 of your Bots</span></div><IconButton name="close" label="Close group chat" onClick={()=>{if(!groupSaving)setGroupCreateDialog(null)}} /></header>
        <label className="group-name-field">Group name<input autoFocus maxLength={60} placeholder="Name this group" value={groupCreateDialog.name} disabled={groupSaving} onChange={event=>setGroupCreateDialog(current=>current?{...current,name:event.target.value,requestId:crypto.randomUUID()}:null)} /></label>
        <div className="group-bot-options" aria-label="Choose group Bots">{state.bots.map(bot=>{const selected=groupCreateDialog.botIds.includes(bot.id),limitReached=groupCreateDialog.botIds.length>=6&&!selected;return <label key={bot.id} className={`group-bot-option ${selected?'selected':''}`}><input type="checkbox" checked={selected} disabled={groupSaving||limitReached} onChange={()=>setGroupCreateDialog(current=>{if(!current)return null;const botIds=current.botIds.includes(bot.id)?current.botIds.filter(id=>id!==bot.id):current.botIds.length<6?[...current.botIds,bot.id]:current.botIds;return{...current,botIds,requestId:crypto.randomUUID()}})} /><Avatar bot={bot} size={32}/><span><strong>{bot.name}</strong>{bot.label&&<small>{bot.label}</small>}</span></label>})}</div>
        {groupError&&<p className="group-create-error" role="alert">{groupError}</p>}
        <footer><span>{groupCreateDialog.botIds.length} / 6 selected</span><button type="button" disabled={groupSaving} onClick={()=>setGroupCreateDialog(null)}>Cancel</button><button type="submit" disabled={groupSaving||groupCreateDialog.botIds.length<2||!groupCreateDialog.name.trim()}>{groupSaving?'Creating…':'Create group'}</button></footer>
      </form></div>}
      {createDialog && <div className="create-overlay" onMouseDown={event=>{if(event.target===event.currentTarget&&!savingBot)setCreateDialog(null)}}><form className="create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-title" onSubmit={event=>{event.preventDefault();void createBot(createDialog)}} onKeyDown={handleCreateDialogKey}>
        <header><strong id="create-title">Create New Bot</strong><IconButton name="close" label="Close create Bot" onClick={()=>{if(!savingBot)setCreateDialog(null)}} /></header>
        <div className="create-preview"><Avatar bot={createDialog} size={112}/></div>
        <input ref={createName} className="create-name" aria-label="Name your Bot" placeholder="Name your Bot" maxLength={60} value={createDialog.name} disabled={savingBot} onChange={event=>setCreateDialog(current=>current?{...current,name:event.target.value}:null)} />
        <div className="create-shapes">{createShapes.map(shape=><button key={shape} type="button" aria-label={`Create shape ${shape}`} aria-pressed={createDialog.shape===shape} disabled={savingBot} onClick={()=>setCreateDialog(current=>current?{...current,shape}:null)}><Avatar bot={{shape,color:createDialog.color}} size={40}/></button>)}</div>
        <div className="create-colors">{createColors.map(color=><button key={color} type="button" aria-label={`Create color ${color}`} aria-pressed={createDialog.color===color} disabled={savingBot} onClick={()=>setCreateDialog(current=>current?{...current,color}:null)}><span style={{background:color}}/></button>)}</div>
        {botError && <p className="create-error" role="alert">{botError}</p>}
        <footer><button type="button" disabled={savingBot} onClick={()=>setCreateDialog(null)}>Cancel</button><button type="submit" disabled={savingBot||createUncertain||!createDialog.name.trim()}>Create</button></footer>
      </form></div>}
      {avatarEditor && <div className="avatar-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)closeAvatar()}}><section className="avatar-dialog" ref={avatarDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Bot picture" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();closeAvatar()}else if(event.key==='Tab'){const choices=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));const first=choices[0],last=choices.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===event.currentTarget)){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}}}><header className="avatar-tabs"><button type="button" className="selected" aria-current="true">Bot</button><button type="button" disabled title="Not available yet">Generate</button><button type="button" disabled title="Not available yet">Upload</button><button type="button" disabled title="Not available yet">Reset</button></header><div className="avatar-shapes">{avatarShapes.map(shape=><button key={shape} type="button" aria-label={`Shape ${shape}`} aria-pressed={avatarEditor.shape===shape} onClick={()=>chooseAvatar({shape})}><Avatar bot={{shape,color:avatarEditor.color}} size={40} /></button>)}</div><div className="avatar-colors">{avatarColors.map(color=><button key={color} type="button" className="avatar-color" aria-label={`Color ${color}`} aria-pressed={avatarEditor.color.toLowerCase()===color} onClick={()=>chooseAvatar({color})}><span style={{background:color}} /></button>)}</div></section></div>}
      {connectAppsOpen&&account&&active&&<ConnectAppsDialog botId={active.id} botName={active.name} focusSkillId={linkedSkillId} onClose={closeConnectApps} />}
      {teamDialogOpen&&account&&<TeamWorkspaceDialog account={account} onClose={()=>setTeamDialogOpen(false)} onWorkspaceChanged={()=>window.location.reload()} />}
      {previewFile && <FilePreviewDialog file={previewFile} onClose={()=>setPreviewFile(null)} />}
    </main>
  </div>;
}

function fileUrl(file:RunFile):string { return `${import.meta.env.BASE_URL}api/files/${file.id}`; }
function attachmentMimeType(file:File):string {
  if(file.type)return file.type.toLowerCase();
  const extension=file.name.split('.').at(-1)?.toLowerCase();
  return ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',avif:'image/avif',mp4:'video/mp4',m4v:'video/mp4',webm:'video/webm',mov:'video/quicktime',mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',ogg:'audio/ogg',aac:'audio/aac'} as Record<string,string>)[extension||'']||'application/octet-stream';
}
function previewable(file:RunFile):boolean { return previewImageTypes.has(file.mimeType)||file.mimeType==='application/pdf'||previewVideoTypes.has(file.mimeType)||previewAudioTypes.has(file.mimeType)||(['text/plain','text/csv','text/markdown','application/json'].includes(file.mimeType)&&file.size<=1024*1024); }
function displayFileSize(size:number):string { return size<1024?`${size} B`:size<1024*1024?`${(size/1024).toFixed(0)} kB`:`${(size/1024/1024).toFixed(1)} MB`; }
function RunFileCards({files,onPreview,onReuse}:{files:RunFile[];onPreview:(file:RunFile)=>void;onReuse?:(file:RunFile)=>void}) {
  if(!files.length)return null;
  return <div className="run-files">{files.map(file=><div className="run-file-card" key={file.id}>
    <button type="button" className="run-file-preview" disabled={!previewable(file)} aria-label={`Preview ${file.name}`} onClick={()=>onPreview(file)}>
      {previewImageTypes.has(file.mimeType)?<img src={fileUrl(file)} alt="" loading="lazy"/>:<span className="run-file-icon" aria-hidden="true">{file.mimeType==='application/pdf'?'PDF':previewVideoTypes.has(file.mimeType)?'▶ VIDEO':previewAudioTypes.has(file.mimeType)?'♫ AUDIO':file.name.split('.').at(-1)?.slice(0,5).toUpperCase()||'FILE'}</span>}
    </button>
    <div className="run-file-meta"><strong title={file.name}>{file.name}</strong><small>{displayFileSize(file.size)} · {file.kind==='input'?'Attached':'Result'}</small></div>
    {onReuse&&file.kind==='output'&&<button type="button" className="run-file-action" aria-label={`Attach ${file.name} to next message`} title="Continue with this file" onClick={()=>onReuse(file)}>＋</button>}
    <a href={fileUrl(file)} download={file.name} aria-label={`Download ${file.name}`} title="Download">↓</a>
  </div>)}</div>;
}
function FilePreviewDialog({file,onClose}:{file:RunFile;onClose:()=>void}) {
  const [text,setText]=useState<string|null>(null),[error,setError]=useState(false);
  useEffect(()=>{if(!['text/plain','text/csv','text/markdown','application/json'].includes(file.mimeType)||file.size>1024*1024)return;const controller=new AbortController();void fetch(fileUrl(file),{credentials:'same-origin',signal:controller.signal}).then(response=>{if(!response.ok)throw new Error();return response.text()}).then(setText).catch(()=>{if(!controller.signal.aborted)setError(true)});return()=>controller.abort()},[file]);
  return <div className="file-preview-overlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="file-preview-dialog" role="dialog" aria-modal="true" aria-label={`Preview ${file.name}`}>
    <header><strong>{file.name}</strong><a href={fileUrl(file)} download={file.name}>Download</a><button type="button" aria-label="Close preview" onClick={onClose}>×</button></header>
    {previewImageTypes.has(file.mimeType)?<img className="file-preview-image" src={fileUrl(file)} alt={file.name}/>:previewVideoTypes.has(file.mimeType)?<video className="file-preview-video" controls preload="metadata" aria-label={`Play ${file.name}`}><source src={fileUrl(file)} type={file.mimeType}/></video>:previewAudioTypes.has(file.mimeType)?<audio className="file-preview-audio" controls preload="metadata" aria-label={`Play ${file.name}`}><source src={fileUrl(file)} type={file.mimeType}/></audio>:file.mimeType==='application/pdf'?<iframe title={`Preview ${file.name}`} src={fileUrl(file)} sandbox="allow-scripts"/>:text!==null?<pre>{text}</pre>:error?<p role="alert">Preview could not be loaded.</p>:<p>Loading preview…</p>}
  </section></div>;
}

function BotLibrary({botId,onPreview}:{botId:string;onPreview:(file:RunFile)=>void}) {
  const [category,setCategory]=useState<BotLibraryCategory>('All');
  const [items,setItems]=useState<BotLibraryItem[]>([]);
  const [loading,setLoading]=useState(true);
  const [loadingMore,setLoadingMore]=useState(false);
  const [error,setError]=useState('');
  const [hasMore,setHasMore]=useState(false);
  const [nextOffset,setNextOffset]=useState(0);
  const [expanded,setExpanded]=useState<Record<string,number>>({});
  const [pinning,setPinning]=useState<string|null>(null);
  const categories:BotLibraryCategory[]=['All','Pages','Media','Links','Files','Apps','Pinned'];
  const apiCategory=category==='All'?'all':category==='Media'?'media':category==='Files'?'files':category==='Pinned'?'pinned':null;

  useEffect(()=>{
    const controller=new AbortController();
    setItems([]);setHasMore(false);setNextOffset(0);setExpanded({});setError('');setLoading(true);
    if(!apiCategory){setLoading(false);return()=>controller.abort()}
    void fetch(`${import.meta.env.BASE_URL}api/bots/${botId}/library?category=${apiCategory}&offset=0&limit=100`,{credentials:'same-origin',cache:'no-store',signal:controller.signal})
      .then(async response=>{const value=await response.json() as {files?:BotLibraryItem[];hasMore?:boolean;error?:string};if(!response.ok)throw new Error(value.error||'Library is unavailable.');return value})
      .then(value=>{if(controller.signal.aborted)return;const files=value.files||[];setItems(files);setHasMore(Boolean(value.hasMore));setNextOffset(files.length)})
      .catch(()=>{if(!controller.signal.aborted)setError('Could not load this Bot’s library.')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[botId,apiCategory]);

  async function loadMore(){
    if(!apiCategory||loadingMore||!hasMore)return;
    setLoadingMore(true);setError('');
    try{
      const response=await fetch(`${import.meta.env.BASE_URL}api/bots/${botId}/library?category=${apiCategory}&offset=${nextOffset}&limit=100`,{credentials:'same-origin',cache:'no-store'});
      const value=await response.json() as {files?:BotLibraryItem[];hasMore?:boolean;error?:string};
      if(!response.ok)throw new Error(value.error||'Library is unavailable.');
      const files=value.files||[];setItems(current=>[...current,...files]);setNextOffset(offset=>offset+files.length);setHasMore(Boolean(value.hasMore));
    }catch{setError('Could not load more library items.')}finally{setLoadingMore(false)}
  }

  async function togglePin(item:BotLibraryItem){
    if(pinning)return;const pinned=!item.pinned;setPinning(item.id);setError('');
    try{
      const response=await fetch(`${import.meta.env.BASE_URL}api/bots/${botId}/library/${item.id}`,{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({pinned})});
      const value=await response.json() as {pinned?:boolean;error?:string};if(!response.ok||value.pinned!==pinned)throw new Error(value.error||'Could not update pin.');
      setItems(current=>pinned?current.map(file=>file.id===item.id?{...file,pinned:true}:file):category==='Pinned'?current.filter(file=>file.id!==item.id):current.map(file=>file.id===item.id?{...file,pinned:false}:file));
    }catch{setError('Could not update this library item.')}finally{setPinning(null)}
  }

  const groups:Record<'Pinned'|'Today'|'This week'|'Older',BotLibraryItem[]>={Pinned:[],Today:[],'This week':[],Older:[]};
  const now=new Date(),todayStart=new Date(now.getFullYear(),now.getMonth(),now.getDate()),weekStart=new Date(todayStart);
  weekStart.setDate(todayStart.getDate()-((todayStart.getDay()+6)%7));
  for(const item of items){if(category==='Pinned'||item.pinned){groups.Pinned.push(item);continue}const date=new Date(item.createdAt);groups[date>=todayStart?'Today':date>=weekStart?'This week':'Older'].push(item)}
  const emptyLabel=category==='Media'?'No media in this Bot’s library yet.':category==='Files'?'No files in this Bot’s library yet.':category==='Pinned'?'No pinned items in this Bot’s library yet.':'No files or media in this Bot’s library yet.';

  return <section className="bot-library" aria-label="Bot library">
    <div className="library-filters" role="tablist" aria-label="Library item type">{categories.map(value=><button key={value} type="button" role="tab" aria-selected={category===value} className={category===value?'active':''} onClick={()=>setCategory(value)}>{value}</button>)}</div>
    {!apiCategory?<div className="library-empty">This Library view currently supports generated files and media.</div>:loading?<div className="library-empty" role="status">Loading library…</div>:error&&!items.length?<div className="library-empty" role="alert">{error}</div>:!items.length?<div className="library-empty">{emptyLabel}</div>:<>
      {(['Pinned','Today','This week','Older'] as const).map(group=>{const rows=groups[group],shown=expanded[group]||5;if(!rows.length)return null;return <section className="library-group" key={group} aria-label={group}>
        <h3>{group}</h3><div className="library-items">{rows.slice(0,shown).map(item=><div className="library-item" key={item.id}>
          <RunFileCards files={[item]} onPreview={onPreview}/>
          <button type="button" className="library-pin" disabled={pinning!==null} aria-label={`${item.pinned?'Unpin':'Pin'} ${item.name}`} onClick={()=>void togglePin(item)}><BotMenuIcon name="pin"/><span>{item.pinned?'Unpin':'Pin'}</span></button>
        </div>)}</div>
        {rows.length>shown&&<button type="button" className="library-show-more" onClick={()=>setExpanded(current=>({...current,[group]:shown+5}))}>Show more</button>}
      </section>})}
      {error&&<div className="library-feedback" role="alert">{error}</div>}
      {hasMore&&<button type="button" className="library-load-more" disabled={loadingMore} onClick={()=>void loadMore()}>{loadingMore?'Loading…':'Load more'}</button>}
    </>}
  </section>;
}

const pendingTeamInviteKey='coke-grok-pending-team-invite';
function JoinTeamInviteDialog({token,email,onCancel,onSwitchAccount}:{token:string;email:string;onCancel:()=>void;onSwitchAccount:()=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function accept(){
    if(busy)return;setBusy(true);setError('');
    try{
      const response=await fetch(`${import.meta.env.BASE_URL}api/team/invitations/accept`,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
      const value=await response.json() as {error?:string};if(!response.ok)throw new Error(value.error||'Could not join this workspace.');
      sessionStorage.removeItem(pendingTeamInviteKey);window.location.replace(import.meta.env.BASE_URL);
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not join this workspace.')}finally{setBusy(false)}
  }
  return <div className="connect-apps-overlay"><section className="connect-apps-dialog join-team-dialog" role="dialog" aria-modal="true" aria-labelledby="join-team-title">
    <header><div><strong id="join-team-title">Join a workspace</strong><small>Signed in as {email}</small></div></header>
    <div className="connect-apps-skills"><p>Joining adds this Google account to the invited workspace. Bots and conversations remain private to their owners.</p>{error&&<p className="connect-apps-error" role="alert">{error}</p>}<div className="join-team-actions"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" disabled={busy} onClick={onSwitchAccount}>Use another Google account</button><button type="button" disabled={busy} onClick={()=>void accept()}>{busy?'Joining…':'Join workspace'}</button></div></div>
  </section></div>;
}

function AuthenticatedApp() {
  const [authError] = useState(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('authError');
    if (code !== null) { url.searchParams.delete('authError'); window.history.replaceState(null, '', url.pathname + url.search + url.hash); }
    if (!code) return '';
    if (code === 'cancelled') return 'Sign-in was cancelled or expired. Please try again.';
    return 'Sign-in could not be completed. Please try again.';
  });
  const [account, setAccount] = useState<Account | null>(null);
  const [status, setStatus] = useState<'loading' | 'signedOut' | 'signedIn' | 'error'>('loading');
  const [logoutError, setLogoutError] = useState(false);
  const [pendingInvite,setPendingInvite]=useState('');
  useEffect(()=>{
    const token=new URLSearchParams(window.location.hash.slice(1)).get('invite');
    if(token&&/^[A-Za-z0-9_-]{43}$/.test(token))sessionStorage.setItem(pendingTeamInviteKey,token);
    if(window.location.hash){window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search)}
    const stored=sessionStorage.getItem(pendingTeamInviteKey)||'';if(/^[A-Za-z0-9_-]{43}$/.test(stored))setPendingInvite(stored);
  },[]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}api/auth/me`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (response.status === 401) { setStatus('signedOut'); return; }
        if (!response.ok) throw new Error('auth unavailable');
        const value = await response.json() as Account;
        if (![value.userId, value.tenantId, value.email, value.name, value.role].every(item => typeof item === 'string' && item.length > 0)) throw new Error('invalid session');
        setAccount(value); setStatus('signedIn');
      }).catch(error => { if (error.name !== 'AbortError') setStatus('error'); });
    return () => controller.abort();
  }, []);
  async function logout() {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}api/auth/logout`, { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('logout failed');
      setAccount(null); setStatus('signedOut'); setLogoutError(false);
    } catch { setLogoutError(true); }
  }
  if (status === 'signedIn' && account) return <><PreviewApp key={`${account.tenantId}:${account.userId}`} account={account} onLogout={() => void logout()} />{pendingInvite&&<JoinTeamInviteDialog token={pendingInvite} email={account.email} onCancel={()=>{sessionStorage.removeItem(pendingTeamInviteKey);setPendingInvite('')}} onSwitchAccount={()=>void logout()} />}{logoutError && <div role="alert" className="auth-error">Sign out failed. Please try again.</div>}</>;
  return <main className="auth-page"><div className="auth-card"><h1>Coke Grok Bot</h1>{status === 'loading' ? <p>Checking your session…</p> : status === 'error' ? <><p role="alert">The sign-in service is unavailable.</p><button type="button" onClick={() => window.location.reload()}>Try again</button></> : <><p>{pendingInvite?'Sign in with the invited Google account to join the workspace.':'Sign in to continue to the local preview.'}</p>{authError && <p role="alert">{authError}</p>}<a href={`${import.meta.env.BASE_URL}api/auth/google/start`}>Continue with Google</a></>}</div></main>;
}

function AppRoot() {
  if (import.meta.env.VITE_REQUIRE_AUTH === 'true') return <AuthenticatedApp />;
  if (new URLSearchParams(window.location.search).get('reference') === 'website-demo') return <WebsiteDemoApp />;
  return <PreviewApp />;
}

createRoot(document.getElementById('root')!).render(<AppRoot />);
