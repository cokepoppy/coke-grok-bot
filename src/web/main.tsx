import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { avatarPaths } from './avatar-paths';
import { WebsiteDemoApp } from './website-demo';
import {findGroupMentionQuery,groupRecipientBotIds,rebaseGroupMentionTokens,type GroupMentionQuery,type GroupMentionToken} from './group-mentions';
import './shell.css';

type Shape = 'cloud' | 'drop' | 'hex' | 'round' | 'triangle' | 'oval' | 'square' | 'pill' | 'spark' | 'heart' | 'flower' | 'pentagon' | 'star';
type Bot = { id: string; name: string; label: string; color: string; shape: Shape; group: string; preview: string; lastActivityAt?: string | null; pinned?: boolean; hidden?: boolean };
type Message = { id: string; role: 'user' | 'bot' | 'system'; text: string; createdAt?: string | null };
type RunFile = { id: string; name: string; mimeType: string; size: number; sha256: string; kind: 'input' | 'output' };
type ExecutionAudit = {engine:'pi'|'dsh';model:string;modelCompleted:boolean;calls:{tool:string;action:string|null;outcome:'succeeded'|'failed'|'unconfirmed'}[];truncated:boolean};
type AgentRun = { id: string; prompt: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'unknown'; result: string | null; recoveryState: 'none' | 'pending' | 'retried' | 'acknowledged'; replacementRunId: string | null; files: RunFile[]; computerUsed?: boolean; executionAudit?:ExecutionAudit|null; createdAt?:string|null; updatedAt?: string | null; diagnosticCode?: string | null };
type GroupMember = Pick<Bot,'id'|'name'|'label'|'color'|'shape'> & { position: number };
type GroupChat = { id: string; name: string; members: GroupMember[]; preview: string; lastActivityAt: string | null };
type GroupReplacementRun = { id:string; status:AgentRun['status']; result:string|null; computerUsed:boolean; executionAudit?:ExecutionAudit|null; updatedAt:string|null; diagnosticCode?:string|null; files:RunFile[]; approvals?:Approval[] };
type GroupMessage = { id:string;turnId:string;role:'user'|'bot';botId:string|null;botName:string|null;text:string|null;runId:string|null;status:AgentRun['status']|null;recoveryState:AgentRun['recoveryState']|null;replacementRunId:string|null;replacementRun:GroupReplacementRun|null;computerUsed:boolean;executionAudit?:ExecutionAudit|null;updatedAt:string|null;diagnosticCode?:string|null;targetBotIds?:string[];approvals?:Approval[];files?:RunFile[] };
type GroupChatView = { group: GroupChat; messages: GroupMessage[] };
type Approval = { id: string; action: string; status: 'pending' | 'approved' | 'denied' | 'consumed' | 'expired'; hasScreenshot?: boolean };
type Routine = { id:string; name:string; instruction:string; schedule:{kind:'weekly';weekday:number;hour:number;minute:number}|{kind:'interval';minutes:number}; timezone:string; paused:boolean; when:string; nextRunAt:string; runs:{id:string;status:string;scheduledFor:string;result:string|null}[] };
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
    messages: { new: [{ id: 'welcome', role: 'bot', text: 'Hey Martin — good to meet you. What do you want me helping with most right now?' }] },
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
function buildBotTimeline(messages:Message[],runs:AgentRun[],runApprovals:Record<string,Approval[]>,latestSubmittedItemId?:string):BotTimelineEntry[] {
  const entries:BotTimelineEntry[]=[];
  messages.forEach((message,index)=>entries.push({key:`message:${message.id}`,at:timelineTime(message.createdAt),priority:1,order:index,kind:'message',message}));
  runs.forEach((run,index)=>{
    const createdAt=timelineTime(run.createdAt)||timelineTime(run.updatedAt),updatedAt=timelineTime(run.updatedAt)||createdAt;
    const outputFiles=(run.files||[]).filter(file=>file.kind==='output');
    const genericDone=Boolean(run.computerUsed&&/^(done|done\.)$/i.test(run.result?.trim()||''));
    const showRecovery=run.status==='unknown'&&run.recoveryState==='pending';
    const showRetryNote=run.status==='unknown'&&run.recoveryState==='retried'&&Boolean(run.replacementRunId);
    const pendingApprovals=(runApprovals[run.id]||[]).some(approval=>approval.status==='pending');
    const showFollowup=!run.computerUsed||Boolean((run.result&&!genericDone)||outputFiles.length||showRecovery||showRetryNote||pendingApprovals);
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
  if (message.status === 'unknown' && message.recoveryState === 'pending') return 'Outcome unknown · review the computer before continuing.';
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

function renderGroupUserText(message: GroupMessage, members: GroupMember[]): React.ReactNode {
  const text=message.text||'',targeted=new Set(message.targetBotIds||[]);
  const mentions=members.filter(member=>targeted.has(member.id)).map(member=>({label:`@${member.name}`,id:member.id})).sort((a,b)=>b.label.length-a.label.length);
  if(!mentions.length)return text;
  const parts:React.ReactNode[]=[];let cursor=0;
  while(cursor<text.length){
    const match=mentions.find(item=>text.startsWith(item.label,cursor)&&(cursor===0||/[\s([{>]/.test(text[cursor-1])));
    if(!match){const next=text.indexOf('@',cursor+1);if(next<0){parts.push(text.slice(cursor));break}parts.push(text.slice(cursor,next));cursor=next;continue}
    parts.push(<span className="group-mention-token" key={`${match.id}:${cursor}`}>{match.label}</span>);cursor+=match.label.length;
  }
  return parts;
}

function runDiagnosticExplanation(code?: string | null): string | null {
  if (code === 'model_upstream_429') return 'Model requests are temporarily paused after a provider rate limit. This run’s result is unconfirmed; review the computer before continuing.';
  if (code === 'agent_paused_for_control') return 'The Bot paused because the cloud computer was under your control. The result is unconfirmed; review the screen before continuing.';
  if (code === 'agent_result_status_unconfirmed') return 'The Agent returned an unexpected task status. The result is unconfirmed; review the computer before continuing.';
  if (code === 'agent_result_message_missing') return 'The Agent returned no readable result. The task outcome is unconfirmed; review the computer before continuing.';
  return null;
}

function IconButton({ name, label, onClick, className = '', buttonRef }: { name: IconName; label: string; onClick?: () => void; className?: string; buttonRef?: React.Ref<HTMLButtonElement> }) {
  return <button ref={buttonRef} type="button" className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick}><Icon name={name} /></button>;
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

function ApprovalCard({approval, disabled, decide}: {approval:Approval; disabled:boolean; decide:(decision:'approved'|'denied')=>void}) {
  const [imageLoaded,setImageLoaded]=useState(false);
  let detail: {kind?:string;action?:string;arguments?:Record<string,unknown>;page?:string}|null=null;
  try { const value=JSON.parse(approval.action); if(value && typeof value==='object' && typeof value.action==='string') detail=value; } catch { /* Legacy textual approvals. */ }
  return <div className="approval-card"><strong>Approval requested</strong>
    {detail ? <><p>{detail.kind === 'desktop' ? 'Desktop' : detail.kind === 'terminal' ? 'Computer terminal' : 'Browser'}: {detail.action}</p>{detail.page && <p>Page: {detail.page}</p>}{detail.arguments && <pre>{detail.kind === 'terminal' ? `${String(detail.arguments.directory || 'task')} directory\n${String(detail.arguments.command || '')}` : JSON.stringify(detail.arguments,null,2)}</pre>}</> : <p>{approval.action}</p>}
    {approval.hasScreenshot && <img src={`${import.meta.env.BASE_URL}api/approvals/${approval.id}/screenshot`} alt="Computer screen when this action was requested" onLoad={()=>setImageLoaded(true)} onError={()=>setImageLoaded(false)} />}
    <div><button type="button" disabled={disabled} onClick={()=>decide('denied')}>Deny</button><button type="button" disabled={disabled || Boolean(approval.hasScreenshot && !imageLoaded)} onClick={()=>decide('approved')}>Approve</button></div>
  </div>;
}

function ComputerPanel({name,botId,official=false,bot,onClose,onRename,onSaveName,onLabelChange,onSaveLabel,onChangeAvatar,onEditRoutine}:{name:string;botId:string;official?:boolean;bot?:Bot;onClose?:()=>void;onRename?:(value:string)=>void;onSaveName?:()=>void;onLabelChange?:(value:string)=>void;onSaveLabel?:()=>void;onChangeAvatar?:()=>void;onEditRoutine?:(name:string)=>void}) {
  const [owner,setOwner]=useState<'agent'|'user'|null>(null),[image,setImage]=useState(''),[error,setError]=useState(''),[diagnostic,setDiagnostic]=useState(''),[busy,setBusy]=useState(false),[text,setText]=useState('');
  const [screenOpen,setScreenOpen]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [routines,setRoutines]=useState<Routine[]>([]),[routineState,setRoutineState]=useState<'loading'|'ready'|'error'>('loading');
  const [routineDetailId,setRoutineDetailId]=useState(''),[routineDeleteConfirm,setRoutineDeleteConfirm]=useState(false);
  const [routineBusy,setRoutineBusy]=useState(false),[routineError,setRoutineError]=useState('');
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
  const loadRoutines=async(signal?:AbortSignal)=>{
    const response=await fetch(routinesUrl,{credentials:'same-origin',cache:'no-store',signal});
    if(!response.ok)throw new Error('Could not load routines');
    const value=await response.json() as {routines?:unknown};
    if(!Array.isArray(value.routines))throw new Error('Invalid routine response');
    setRoutines(value.routines as Routine[]);setRoutineState('ready');
  };
  useEffect(()=>{
    mounted.current=true;let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;const controller=new AbortController();
    const responseDiagnostic=async(response:Response,phase:string)=>{
      let code='',upstreamStatus:number|undefined;
      try{const body=await response.clone().json() as {diagnostic?:{code?:unknown;status?:unknown}}|null;const metadata=body?.diagnostic;const reportedStatus=metadata?.status;if(typeof metadata?.code==='string'&&/^(?:COMPUTER_[A-Z0-9_]+|INTERNAL_FAILURE)$/.test(metadata.code))code=metadata.code;if(typeof reportedStatus==='number'&&Number.isInteger(reportedStatus)&&reportedStatus>=100&&reportedStatus<=599)upstreamStatus=reportedStatus}catch{/* Keep the diagnostic limited to the HTTP status. */}
      return `${phase}: HTTP ${response.status}${code?` · ${code}`:''}${upstreamStatus!==undefined?` · upstream ${upstreamStatus}`:''}`;
    };
    const refresh=async()=>{let phase='Computer status request',failure='';try{
      const status=await fetch(computerUrl,{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!status.ok){failure=await responseDiagnostic(status,phase);throw new Error()}
      phase='Computer status response';const state=await status.json() as {owner?:unknown};if(state.owner!=='agent'&&state.owner!=='user'){failure=`${phase}: invalid response`;throw new Error()}
      phase='Computer screenshot request';const screen=await fetch(`${computerUrl}/screenshot`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!screen.ok){failure=await responseDiagnostic(screen,phase);throw new Error()}
      if(screen.headers.get('content-type')?.split(';')[0]!=='image/png'){failure='Computer screenshot response: invalid image type';throw new Error()}
      phase='Computer screenshot image';const blob=await screen.blob();if(stopped)return;const next=URL.createObjectURL(blob),previous=imageUrl.current;imageUrl.current=next;setImage(next);setOwner(state.owner);setDiagnostic('');if(previous)URL.revokeObjectURL(previous);
    }catch{if(!stopped){setOwner(null);setImage('');setDiagnostic(failure||`${phase}: request failed`);if(imageUrl.current)URL.revokeObjectURL(imageUrl.current);imageUrl.current=''}}finally{if(!stopped)timer=setTimeout(refresh,2000)}};
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
  const click=(event:React.MouseEvent<HTMLImageElement>)=>{if(owner!=='user'||busy)return;const rect=event.currentTarget.getBoundingClientRect();const x=Math.min(1439,Math.max(0,Math.floor((event.clientX-rect.left)*1440/rect.width))),y=Math.min(899,Math.max(0,Math.floor((event.clientY-rect.top)*900/rect.height)));void send('action',{action:'click',x,y})};
  const toggleScreenFullscreen=async()=>{const element=screenDialog.current;if(!element)return;try{if(document.fullscreenElement===element)await document.exitFullscreen();else await element.requestFullscreen()}catch{setError('Full-screen view is unavailable in this browser.')}};
  const controlLabel=owner==='user'?'You are in control':owner==='agent'?'Bot is in control':'Waiting for computer';
  const selectedRoutine=routines.find(routine=>routine.id===routineDetailId);
  if(!official)return <><div className="computer-preview" title={diagnostic||undefined}>{image ? <img src={image} alt="Current computer screen" onClick={click} /> : <><Icon name="screen" /><span>Computer not connected</span></>}</div>
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
      <div className="routine-detail-schedule"><span>When to run</span><strong>{selectedRoutine.paused?'Paused':selectedRoutine.when}</strong><small>{selectedRoutine.timezone}</small></div>
      <div className="routine-detail-instruction"><span>Instruction</span><p>{selectedRoutine.instruction}</p></div>
      {!selectedRoutine.paused&&<p className="routine-next-run">Next run · {new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:selectedRoutine.timezone}).format(new Date(selectedRoutine.nextRunAt))}</p>}
      <section className="routine-history" aria-label="Run history"><h2>Run history</h2>{selectedRoutine.runs.length?selectedRoutine.runs.map(run=><div className="routine-history-row" key={run.id}><strong>{run.status==='queued'?'Queued':run.status==='running'?'Running':run.status==='completed'?'Succeeded':'Failed'}</strong><time dateTime={run.scheduledFor}>{new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:selectedRoutine.timezone}).format(new Date(run.scheduledFor))}</time>{run.result&&<p>{run.result}</p>}</div>):<p>No runs yet.</p>}</section>
      {routineDeleteConfirm?<div className="routine-delete-confirm" role="group" aria-label="Confirm delete routine"><p>Delete this routine? Future runs will stop.</p><button type="button" disabled={routineBusy} onClick={()=>setRoutineDeleteConfirm(false)}>Keep routine</button><button type="button" disabled={routineBusy} onClick={()=>void deleteRoutine(selectedRoutine)}>Delete routine</button></div>:<footer className="routine-actions"><button type="button" disabled={routineBusy} onClick={()=>{setRoutineDetailId('');onEditRoutine?.(selectedRoutine.name)}}>Edit</button><button type="button" disabled={routineBusy} onClick={()=>void toggleRoutine(selectedRoutine)}>{selectedRoutine.paused?'Resume':'Pause'}</button><button type="button" disabled={routineBusy} onClick={()=>void testRoutine(selectedRoutine)}>Test</button><button type="button" disabled={routineBusy} onClick={()=>void deleteRoutine(selectedRoutine)} aria-label="Delete routine">Delete</button></footer>}
      {routineError&&<p role="alert">{routineError}</p>}
    </section> : <>
      <button ref={previewButton} type="button" className="computer-preview-button" aria-label="Open screen" title={diagnostic||undefined} onClick={()=>setScreenOpen(true)}>
        {image ? <img src={image} alt="Current computer screen" /> : <span className="computer-preview-empty"><Icon name="screen" /><span>Computer not connected</span></span>}
        <span className="computer-open-screen"><Icon name="screen" /><span>Open screen</span></span>
      </button>
      <div className="screen-label" title={diagnostic||undefined}>{name || 'Bot'}’s screen</div>
      <section className="computer-routines" aria-label="Routines">
        <header><h2>Routines</h2></header>
        {routineState==='loading'?<p>Loading routines…</p>:routineState==='error'?<p>Routines are unavailable right now.</p>:routines.length?routines.map(routine=><div className="computer-routine-row" key={routine.id}>
          <button type="button" className="computer-routine-open" aria-label={`${routine.name}, ${routine.paused?'Paused':routine.when}`} onClick={()=>setRoutineDetailId(routine.id)}><Icon name="clock" /><span><strong>{routine.name}</strong><small>{routine.paused?'Paused':routine.when}</small></span></button>
          <button type="button" role="switch" aria-checked={!routine.paused} aria-label={`${routine.paused?'Resume':'Pause'} ${routine.name}`} disabled={routineBusy} onClick={()=>void toggleRoutine(routine)}><span /></button>
        </div>):<p>Ask in chat to set a routine.</p>}
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
        {error&&<span className="sr-only" role="status">{error}</span>}
      </section>
    </div>}
  </div>;
}

function ComputerActivityCard({run,botId,showScreen,onOpenComputer,children}:{run:AgentRun;botId:string;showScreen:boolean;onOpenComputer:()=>void;children?:React.ReactNode}) {
  const [image,setImage]=useState('');
  const [unavailable,setUnavailable]=useState(false);
  const imageUrl=useRef('');
  const status=run.status==='running'?'Working':run.status==='queued'?'Queued':run.status==='completed'?'Done':run.status==='failed'?'Failed':'Review';
  useEffect(()=>{
    if(!showScreen||run.status==='queued')return;
    let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
    const controller=new AbortController();
    const refresh=async()=>{
      try{
        const response=await fetch(`${import.meta.env.BASE_URL}api/bots/${encodeURIComponent(botId)}/computer/screenshot`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
        if(!response.ok||response.headers.get('content-type')?.split(';')[0]!=='image/png')throw new Error();
        const next=URL.createObjectURL(await response.blob());if(stopped){URL.revokeObjectURL(next);return}
        const previous=imageUrl.current;imageUrl.current=next;setImage(next);setUnavailable(false);if(previous)URL.revokeObjectURL(previous);
      }catch(error){if(!stopped&&error instanceof Error&&error.name!=='AbortError'){setImage('');setUnavailable(true)}}
      finally{if(!stopped&&run.status==='running')timer=setTimeout(refresh,2000)}
    };
    void refresh();
    return()=>{stopped=true;controller.abort();if(timer)clearTimeout(timer);if(imageUrl.current)URL.revokeObjectURL(imageUrl.current);imageUrl.current=''};
  },[botId,run.id,run.status,showScreen]);
  const toolLabel=(tool:string)=>tool==='computer_browser'?'Browser User':tool==='computer_desktop'?'Computer User':tool==='computer_files'?'Computer files':tool==='computer_terminal'?'Computer terminal':tool==='open_public_page'?'Public page':tool==='bot_handoff'?'Bot handoff':tool==='bot_memory'?'Bot memory':tool==='bot_routines'?'Bot routines':tool;
  return <section className="computer-activity-card" aria-label={`Computer activity · ${status}`}>
    <header><strong>Computer</strong><span className={`computer-activity-status ${run.status}`}><i />{status}</span></header>
    {run.prompt.trim()&&<p className="computer-activity-prompt">{run.prompt}</p>}
    {children}
    {showScreen&&image?<button type="button" className="computer-activity-screen" onClick={onOpenComputer} aria-label="Open this Bot's computer"><img src={image} alt="Current cloud computer screen" /></button>:<button type="button" className="computer-activity-open" onClick={onOpenComputer}>{unavailable?'Open computer to inspect the screen':'View computer screen'}</button>}
    {run.executionAudit&&<details className="computer-activity-audit"><summary>Execution details</summary><div className="computer-activity-audit-body"><span>{run.executionAudit.engine==='dsh'?'DeepSeek Harness':'Pi'} · {run.executionAudit.model} · {run.executionAudit.modelCompleted?'response received':'response not confirmed'}</span>{run.executionAudit.calls.map((call,index)=><span key={`${call.tool}-${call.action||''}-${index}`}>{toolLabel(call.tool)}{call.action?` · ${call.action}`:''} · {call.outcome}</span>)}{run.executionAudit.truncated&&<span>Additional tool calls omitted</span>}</div></details>}
  </section>;
}

function PreviewApp({ account, onLogout }: { account?: Account; onLogout?: () => void }) {
  const reference = new URLSearchParams(window.location.search).get('reference') === '101-new-bot';
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
  const [previewFile, setPreviewFile] = useState<RunFile | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const [customAnswer, setCustomAnswer] = useState('');
  const [notice, setNotice] = useState(false);
  const [agentFeature, setAgentFeature] = useState<'loading' | 'enabled' | 'disabled' | 'error'>(remote ? 'loading' : 'disabled');
  const [agentEngine, setAgentEngine] = useState<'pi' | 'dsh' | null>(null);
  const [runHistory, setRunHistory] = useState<{ id: string; status: 'loading' | 'ready' | 'error'; runs: AgentRun[] }>({ id: '', status: 'loading', runs: [] });
  const [runRefresh, setRunRefresh] = useState(0);
  const [runApprovals, setRunApprovals] = useState<Record<string, Approval[]>>({});
  const [decidingApproval, setDecidingApproval] = useState<string | null>(null);
  const [resolvingRun, setResolvingRun] = useState<string | null>(null);
  const decidingRef = useRef(false);
  const uncertainMutation = useRef(false);
  const [history, setHistory] = useState<{ id: string; status: 'loading' | 'ready' | 'error' }>({ id: '', status: 'loading' });
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [scrollRequest, setScrollRequest] = useState(0);
  const latestSubmittedTimelineItemByBot = useRef<Record<string,string>>({});
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
  const activeGroup=groups.find(group=>group.id===selectedGroupId);
  const layoutSidebarWidth = account && panel && !panelSidebarExpanded ? PRODUCT_SIDEBAR_MIN : sidebarWidth;
  const botMentionCandidates=botMentionQuery?(activeGroup?activeGroup.members:state.bots.filter(bot=>bot.id!==active?.id)).filter(bot=>`${bot.name} ${bot.label}`.toLowerCase().includes(botMentionQuery.query.trim().toLowerCase())).slice(0,6):[];
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
  const botTimeline=buildBotTimeline(messages,activeRuns,runApprovals,active?latestSubmittedTimelineItemByBot.current[active.id]:undefined);
  const visibleConversationLength=activeGroup?(groupChat.id===activeGroup.id?groupChat.view?.messages.length||0:0):botTimeline.length;
  const activeConversationKey=activeGroup?`group:${activeGroup.id}`:`bot:${active?.id||''}`;
  const visibleConversationTailKey=activeGroup?(groupChat.id===activeGroup.id?groupChat.view?.messages.at(-1)?.id||'':''):botTimeline.at(-1)?.key||'';
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
        const actionable=view.messages.flatMap(message=>[
          ...(message.runId&&(message.status==='running'||(message.status==='unknown'&&message.recoveryState==='pending'))?[message.runId]:[]),
          ...(message.replacementRun&&(message.replacementRun.status==='running'||message.replacementRun.status==='unknown')?[message.replacementRun.id]:[])
        ]);
        const approvals=await Promise.all([...new Set(actionable)].map(async runId=>{
          try{
            const approvalResponse=await fetch(`${import.meta.env.BASE_URL}api/runs/${runId}/approvals`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
            if(!approvalResponse.ok)return[runId,[] as Approval[]] as const;
            const data=await approvalResponse.json() as {approvals:Approval[]};
            return[runId,Array.isArray(data.approvals)?data.approvals:[]] as const;
          }catch(error){if(controller.signal.aborted)throw error;return[runId,[] as Approval[]] as const}
        }));
        const approvalsByRun=new Map(approvals);
        view.messages=view.messages.map(message=>({...message,
          approvals:message.runId?approvalsByRun.get(message.runId)||[]:[],
          replacementRun:message.replacementRun?{...message.replacementRun,approvals:approvalsByRun.get(message.replacementRun.id)||[]}:null
        }));
        if(controller.signal.aborted)return;
        setGroupChat({id,status:'ready',view});
        setGroups(current=>current.map(group=>group.id===id?{...group,...view.group}:group));
        timer=setTimeout(()=>void load(),2000);
      }catch(error){if(!controller.signal.aborted)setGroupChat(current=>({id,status:'error',view:current.id===id?current.view:null}))}
    };
    void load();return()=>{controller.abort();if(timer)clearTimeout(timer)};
  },[remote,agentFeature,groupsStatus,selectedGroupId,groupRefresh]);
  useEffect(() => {
    if (!remote) return;
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}api/auth/features`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => { if (response.status === 404) return { agent: false, engine: null }; if (!response.ok) throw new Error('features unavailable'); return response.json() as Promise<{ agent: boolean; engine: unknown }>; })
      .then(value => {
        if (typeof value.agent !== 'boolean' || (value.agent && value.engine !== 'pi' && value.engine !== 'dsh') || (!value.agent && value.engine !== null)) throw new Error('invalid features');
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
        const pending = await Promise.all(value.runs.filter(run => run.status === 'running').map(async run => {
          const approvalResponse = await fetch(`${import.meta.env.BASE_URL}api/runs/${run.id}/approvals`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
          if (!approvalResponse.ok) throw new Error('approvals unavailable');
          const data = await approvalResponse.json() as { approvals: Approval[] };
          if (!Array.isArray(data.approvals)) throw new Error('invalid approvals');
          return [run.id, data.approvals] as const;
        }));
        if (controller.signal.aborted || uncertainMutation.current) return;
        setRunApprovals(Object.fromEntries(pending));
        setRunHistory({ id, status: 'ready', runs: value.runs });
        const latest=value.runs.at(-1);
        if(latest)setState(current=>({...current,bots:current.bots.map(bot=>bot.id===id?{...bot,preview:runPreview(latest),lastActivityAt:latest.updatedAt||bot.lastActivityAt}:bot)}));
        timer = setTimeout(() => void load(), 2000);
      } catch (error) {
        if (!controller.signal.aborted) setRunHistory(current => ({ id, status: 'error', runs: current.id === id ? current.runs : [] }));
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
  }, [remote, active?.id, activeGroup?.id]);
  useEffect(() => { setDraft(''); setCustomAnswer(''); setNotice(false);setGroupError(''); }, [state.activeId,selectedGroupId]);
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
  async function decideApproval(id: string, decision: 'approved' | 'denied') {
    if (uncertainMutation.current || decidingRef.current || !active || runHistory.id !== active.id || runHistory.status !== 'ready') return;
    decidingRef.current = true; setDecidingApproval(id); setBotError('');
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}api/approvals/${id}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) });
      if (!response.ok) throw new Error('decision could not be confirmed');
      setRunRefresh(value => value + 1);
    } catch {
      uncertainMutation.current = true;
      setBotError('Approval could not be confirmed. Refresh and check its status before trying again.');
      setRunHistory(current => ({ ...current, status: 'error' }));
    } finally { decidingRef.current = false; setDecidingApproval(null); }
  }
  async function decideGroupApproval(id:string,decision:'approved'|'denied'){
    if(uncertainMutation.current||decidingRef.current||!selectedGroupId||groupChat.id!==selectedGroupId||groupChat.status!=='ready')return;
    decidingRef.current=true;setDecidingApproval(id);setGroupError('');
    try{
      const response=await fetch(`${import.meta.env.BASE_URL}api/approvals/${id}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision})});
      if(!response.ok)throw new Error('decision could not be confirmed');
      setGroupRefresh(value=>value+1);
    }catch{
      uncertainMutation.current=true;setGroupError('Approval could not be confirmed. Refresh and check its status before trying again.');
      setGroupChat(current=>({...current,status:'error'}));
    }finally{decidingRef.current=false;setDecidingApproval(null)}
  }
  async function recoverGroupRun(message:GroupMessage,decision:'retry'|'acknowledge'){
    if(uncertainMutation.current||decidingRef.current||!selectedGroupId||groupChat.id!==selectedGroupId||groupChat.status!=='ready'||!message.runId||message.status!=='unknown'||message.recoveryState!=='pending'||(message.approvals||[]).some(approval=>approval.status==='pending'))return;
    decidingRef.current=true;setResolvingRun(message.runId);setGroupError('');
    try{
      const response=await fetch(`${import.meta.env.BASE_URL}api/runs/${message.runId}/recovery`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision})});
      if(!response.ok)throw new Error('recovery could not be confirmed');
      const result=await response.json() as {decision:'retry'|'acknowledge';run:AgentRun|null};
      if(result.decision!==decision||(decision==='retry'&&(!result.run||result.run.status!=='queued'))||(decision==='acknowledge'&&result.run!==null))throw new Error('invalid recovery response');
      setGroupRefresh(value=>value+1);
    }catch{
      uncertainMutation.current=true;setGroupError('Recovery could not be confirmed. Refresh and check the group history before making another decision.');
      setGroupChat(current=>({...current,status:'error'}));
    }finally{decidingRef.current=false;setResolvingRun(null)}
  }
  async function recoverRun(run: AgentRun, decision: 'retry' | 'acknowledge') {
    if (uncertainMutation.current || decidingRef.current || !active || run.status !== 'unknown' || run.recoveryState !== 'pending' || runHistory.id !== active.id || runHistory.status !== 'ready') return;
    decidingRef.current = true; setResolvingRun(run.id); setBotError('');
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}api/runs/${run.id}/recovery`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) });
      if (!response.ok) throw new Error('recovery could not be confirmed');
      const result = await response.json() as { decision: 'retry' | 'acknowledge'; run: AgentRun | null };
      if (result.decision !== decision || (decision === 'retry' && (!result.run || result.run.status !== 'queued')) || (decision === 'acknowledge' && result.run !== null)) throw new Error('invalid recovery response');
      setRunHistory(current => {
        const runs = current.runs.map(item => item.id === run.id ? { ...item, recoveryState: decision === 'retry' ? 'retried' as const : 'acknowledged' as const, replacementRunId: result.run?.id || null } : item);
        if (result.run && !runs.some(item => item.id === result.run!.id)) runs.push(result.run);
        return { ...current, runs };
      });
      setRunRefresh(value => value + 1);
    } catch {
      uncertainMutation.current = true;
      setBotError('Recovery could not be confirmed. Refresh and check the run history before making another decision.');
      setRunHistory(current => ({ ...current, status: 'error' }));
    } finally { decidingRef.current = false; setResolvingRun(null); }
  }
  function renderBotTimelineEntry(entry:BotTimelineEntry):React.ReactNode {
    if(entry.kind==='message'){
      const message=entry.message;
      if(message.role==='system')return <div key={entry.key} className="system-event-line" role="status">{message.text}</div>;
      return <div key={entry.key} className={`message-line ${message.role}`}><div className="message-bubble">{message.text}</div>{message.role==='bot'&&<div className="message-actions"><Icon name="smile"/><Icon name="reply"/><Icon name="more"/></div>}</div>;
    }
    if(!active)return null;
    const run=entry.run;
    const inputFiles=(run.files||[]).filter(file=>file.kind==='input'),outputFiles=(run.files||[]).filter(file=>file.kind==='output');
    const genericDone=Boolean(run.computerUsed&&/^(done|done\.)$/i.test(run.result?.trim()||''));
    const showRecovery=run.status==='unknown'&&run.recoveryState==='pending';
    const showRetryNote=run.status==='unknown'&&run.recoveryState==='retried'&&Boolean(run.replacementRunId);
    const pendingApprovals=(runApprovals[run.id]||[]).filter(approval=>approval.status==='pending');
    if(entry.kind==='run-prompt')return <div key={entry.key} className="message-line user"><div className="message-bubble">{run.prompt}<RunFileCards files={inputFiles} onPreview={setPreviewFile}/></div></div>;
    if(entry.kind==='computer')return <div key={entry.key} className="computer-activity-line"><ComputerActivityCard run={run} botId={active.id} showScreen={run.id===latestComputerRunId} onOpenComputer={()=>openProductPanel('Computer')}><RunFileCards files={inputFiles} onPreview={setPreviewFile}/></ComputerActivityCard></div>;
    return <div key={entry.key} className={`message-line bot${run.computerUsed?' computer-followup':''}`}><div className="message-bubble">
      {!run.computerUsed&&run.status!=='completed'&&<span className="run-status">{run.status==='unknown'&&run.recoveryState==='acknowledged'?'Outcome unknown · reviewed; queue resumed':run.status==='unknown'&&run.recoveryState==='retried'?'Outcome unknown · explicit retry recorded':({queued:'Queued · waiting for your computer',running:'Working on your computer',failed:'Failed',unknown:'Outcome unknown · check before retrying'} as const)[run.status]}</span>}
      {run.result&&!genericDone&&<p>{run.result}</p>}
      <RunFileCards files={outputFiles} onPreview={setPreviewFile} onReuse={reuseRunFile}/>
      {showRecovery&&<section className="run-recovery" aria-label="Review uncertain task outcome"><p>{runDiagnosticExplanation(run.diagnosticCode)||'The previous task may have run even though its result was not saved. Review the computer before deciding.'}</p><div><button type="button" disabled={Boolean(resolvingRun)||runHistory.status!=='ready'} onClick={()=>void recoverRun(run,'acknowledge')}>{resolvingRun===run.id?'Saving…':'I checked · continue'}</button><button type="button" disabled={Boolean(resolvingRun)||runHistory.status!=='ready'} onClick={()=>void recoverRun(run,'retry')}>{resolvingRun===run.id?'Saving…':'Retry as a new task'}</button></div></section>}
      {showRetryNote&&<p className="run-recovery-note">A separate queued task was created; the original outcome remains in history.</p>}
      {pendingApprovals.map(approval=><ApprovalCard key={approval.id} approval={approval} disabled={Boolean(decidingApproval)||runHistory.status!=='ready'} decide={decision=>void decideApproval(approval.id,decision)}/>)}
    </div></div>;
  }
  function updateBotMentionDraft(value:string,caret:number){
    setDraft(value);
    const tokens=rebaseGroupMentionTokens(draft,value,botMentionTokensRef.current);
    botMentionTokensRef.current=tokens;setBotMentionTokens(tokens);
    setBotMentionQuery(findGroupMentionQuery(value,caret));setBotMentionActiveIndex(0);
  }
  function selectBotMention(member:GroupMember|Bot){
    if(!botMentionQuery)return;
    const {start,end}=botMentionQuery,label=`@${member.name}`,next=`${draft.slice(0,start)}${label} ${draft.slice(end)}`,caret=start+label.length+1;
    const token={botId:member.id,name:member.name,start,end:start+label.length};
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
  async function addMessage(text: string) {
    if(remote&&selectedGroupId){
      const clean=text.trim();
      const selectedFiles=pendingGroupFiles[selectedGroupId]||[];
      if((!clean&&!selectedFiles.length)||uncertainMutation.current||groupSendingRef.current||groupChat.id!==selectedGroupId||groupChat.status!=='ready')return;
      if(clean.length>8000){setGroupError('Message is too long.');return}
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
        const targetBotIds=Array.from(new Set(botMentionTokensRef.current.map(token=>token.botId)));
        submissionStarted=true;
        const response=await fetch(`${import.meta.env.BASE_URL}api/groups/${encodeURIComponent(selectedGroupId)}/messages`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),text:clean,...(uploadedIds.length?{files:uploadedIds}:{}),...(targetBotIds.length?{targetBotIds}:{})})});
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
      if (agentFeature === 'loading' || agentFeature === 'error' || (agentFeature === 'enabled' && (runHistory.id !== id || runHistory.status !== 'ready' || unresolvedOutcome))) return;
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
          const mentionBotIds=[...new Set(botMentionTokensRef.current.map(token=>token.botId))];
          const response = await fetch(`${import.meta.env.BASE_URL}api/bots/${id}/runs`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), prompt, files:[...uploaded.map(file=>file.id),...selectedRunFiles.map(file=>file.id)], ...(mentionBotIds.length?{mentionBotIds}:{}) }) });
          if (!response.ok) throw new Error('run submission failed');
          const { run } = await response.json() as { run: AgentRun };
          if (!run || typeof run.id !== 'string' || typeof run.prompt !== 'string') throw new Error('invalid run response');
          // A newly submitted instruction must remain the last chat item even
          // if a subsequent history poll returns a differently normalized DB
          // timestamp. Otherwise mixed message/run sorting can move it above
          // older history while the scroll viewport correctly stays at bottom.
          latestSubmittedTimelineItemByBot.current[id]=run.id;
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
    if(combined.length>attachmentCountLimit){setGroupError('Attach up to 20 files per message.');return}
    for(const item of combined){
      const mimeType=attachmentMimeType(item.file);
      if(!Number.isSafeInteger(item.file.size)||item.file.size<1){setGroupError(`${item.file.name||'This file'} is empty or unreadable.`);return}
      const limit=mimeType.startsWith('image/')?attachmentImageLimit:mimeType.startsWith('video/')?attachmentVideoLimit:attachmentDocumentLimit;
      if(item.file.size>limit){setGroupError(`${item.file.name} is too large. The limit is ${mimeType.startsWith('image/')?'25 MB per image':mimeType.startsWith('video/')?'1 GB per video':'250 MB per file'}.`);return}
    }
    const images=combined.filter(item=>attachmentMimeType(item.file).startsWith('image/'));
    if(images.reduce((total,item)=>total+item.file.size,0)>attachmentImagesTotalLimit){setGroupError('Images exceed the 200 MB total limit per message.');return}
    setGroupError('');setPendingGroupFiles(value=>({...value,[activeGroup.id]:combined}));
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
  const unresolvedOutcome = agentFeature === 'enabled' && runHistory.id === active?.id && runHistory.runs.some(run => run.status === 'unknown' && run.recoveryState === 'pending');
  const latestComputerRunId=runHistory.runs.filter(run=>run.computerUsed).at(-1)?.id;
  const groupNeedsReview=Boolean(groupChat.id===selectedGroupId&&groupChat.view?.messages.some(message=>message.role==='bot'&&message.status==='unknown'&&message.recoveryState==='pending'));
  const groupComposerDisabled=remote&&(groupSending||groupNeedsReview||groupChat.id!==selectedGroupId||groupChat.status!=='ready'||agentFeature!=='enabled'||uncertainMutation.current);
  const composerDisabled = activeGroup ? groupComposerDisabled : remote && (sending || history.id !== active?.id || history.status !== 'ready' || agentFeature === 'loading' || agentFeature === 'error' || (agentFeature === 'enabled' && (runHistory.id !== active?.id || runHistory.status !== 'ready' || unresolvedOutcome)));
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
        {accountMenuOpen && <div className="account-menu" role="menu" aria-label="Account"><button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setNotice(true); }}>Connect apps</button><button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); onLogout?.(); }}>Sign out</button></div>}
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
        <div className={`chat-header ${panel ? 'panel-open' : ''}`}><button type="button" className="chat-title" onClick={toggleProductPanel}>{activeGroup?<GroupAvatar members={activeGroup.members} size={30}/>:<Avatar bot={active} size={30}/>}<span>{activeGroup?.name||active.name}</span></button></div>
        <div className={`header-actions ${panel ? 'panel-open' : ''}`}><IconButton name="share" label={activeGroup?'Share group':'Share bot'} onClick={() => setNotice(true)} /><IconButton name={account && !panel ? 'screen' : 'panel'} label={panel ? account ? 'Hide computer' : 'Hide bot details' : account ? `Open ${activeGroup?.name||active.name}'s computer` : 'Show bot details'} onClick={toggleProductPanel} /></div>
        <div className={`workspace ${panel ? 'with-panel' : ''}`}>
          <section className="conversation" aria-label={activeGroup?`Group chat ${activeGroup.name}`:`Chat with ${active.name}`} onDragOver={event=>{if(remote&&agentFeature==='enabled'&&Array.from(event.dataTransfer.types).includes('Files'))event.preventDefault()}} onDrop={event=>{if(!remote||agentFeature!=='enabled'||!event.dataTransfer.files.length)return;event.preventDefault();event.stopPropagation();const dropped=Array.from(event.dataTransfer.files);activeGroup?stageGroupFiles(dropped):stageFiles(dropped)}}>
            <div className="message-scroll" ref={messageScroll}>
              <div className="message-content" ref={messageContent}>
              {activeGroup ? <>
                {groupChat.id===activeGroup.id&&groupChat.status==='loading'&&<div role="status">Loading group chat…</div>}
                {groupChat.id===activeGroup.id&&groupChat.status==='error'&&<div role="alert">Could not confirm this group chat. Refresh to check its messages before sending again.</div>}
                {(groupChat.view?.messages.length||0)>0&&<div className="date-line">{formatBotTime(activeGroup.lastActivityAt)||'Today'}</div>}
                {groupChat.id===activeGroup.id&&groupChat.view?.messages.map(message=>message.role==='user'
                  ? <div key={message.id} className="message-line user group-user-message"><div className="message-bubble">{renderGroupUserText(message,activeGroup.members)}<RunFileCards files={(message.files||[]).filter(file=>file.kind==='input')} onPreview={setPreviewFile}/></div></div>
                  : <div key={message.id} className="message-line bot group-bot-message">
                    <Avatar bot={activeGroup.members.find(member=>member.id===message.botId)||activeGroup.members[0]} size={27}/>
                    <div className="message-bubble">
                      <header className="group-message-heading"><strong>{message.botName||'Bot'}</strong><span className={`group-run-status ${message.status||'queued'}`} title={groupRunStatusLabel(message)}>{groupRunStatusLabel(message)}</span></header>
                      <p>{message.text||groupRunFallback(message)}</p>
                      <RunFileCards files={(message.files||[]).filter(file=>file.kind==='output')} onPreview={setPreviewFile}/>
                      {message.computerUsed&&message.botId&&<ComputerActivityCard run={{id:message.runId||message.id,prompt:'',status:message.status||'queued',result:message.text,recoveryState:message.recoveryState||'none',replacementRunId:message.replacementRunId,files:message.files||[],computerUsed:true,executionAudit:message.executionAudit}} botId={message.botId} showScreen={message.status==='running'||message.status==='completed'} onOpenComputer={()=>{setGroupComputerBotId(message.botId!);openProductPanel('Computer')}} />}
                      {(message.approvals||[]).filter(approval=>approval.status==='pending').map(approval=><ApprovalCard key={approval.id} approval={approval} disabled={Boolean(decidingApproval)||groupChat.status!=='ready'} decide={decision=>void decideGroupApproval(approval.id,decision)}/>)}
                      {message.status==='unknown'&&message.recoveryState==='pending'&&!(message.approvals||[]).some(approval=>approval.status==='pending')&&<section className="run-recovery" aria-label={`Review uncertain task outcome for ${message.botName||'Bot'}`}><p>{runDiagnosticExplanation(message.diagnosticCode)||'The previous task may have run even though its result was not saved. Review this Bot’s computer before deciding.'}</p><div><button type="button" disabled={Boolean(resolvingRun)||groupChat.status!=='ready'} onClick={()=>void recoverGroupRun(message,'acknowledge')}>{resolvingRun===message.runId?'Saving…':'I checked · continue'}</button><button type="button" disabled={Boolean(resolvingRun)||groupChat.status!=='ready'} onClick={()=>void recoverGroupRun(message,'retry')}>{resolvingRun===message.runId?'Saving…':'Retry as a new task'}</button></div></section>}
                      {message.status==='unknown'&&message.recoveryState==='retried'&&message.replacementRunId&&<p className="run-recovery-note">The original task outcome remains unknown. The separate retry is shown below.</p>}
                      {message.replacementRun&&<section className="group-replacement-run" aria-label={`Separate retry for ${message.botName||'Bot'}`}>
                        <header><strong>Separate retry</strong><span className={`group-run-status ${message.replacementRun.status}`}>{replacementRunLabel(message.replacementRun.status)}</span></header>
                        <p>{message.replacementRun.result||replacementRunFallback(message.replacementRun.status)}</p>
                        <RunFileCards files={message.replacementRun.files.filter(file=>file.kind==='output')} onPreview={setPreviewFile}/>
                        {message.replacementRun.computerUsed&&message.botId&&<ComputerActivityCard run={{id:message.replacementRun.id,prompt:'',status:message.replacementRun.status,result:message.replacementRun.result,recoveryState:'none',replacementRunId:null,files:message.replacementRun.files,computerUsed:true,executionAudit:message.replacementRun.executionAudit}} botId={message.botId} showScreen={message.replacementRun.status==='running'||message.replacementRun.status==='completed'} onOpenComputer={()=>{setGroupComputerBotId(message.botId!);openProductPanel('Computer')}} />}
                        {(message.replacementRun.approvals||[]).filter(approval=>approval.status==='pending').map(approval=><ApprovalCard key={approval.id} approval={approval} disabled={Boolean(decidingApproval)||groupChat.status!=='ready'} decide={decision=>void decideGroupApproval(approval.id,decision)}/>)}
                      </section>}
                    </div>
                  </div>)}
                {groupChat.id===activeGroup.id&&groupChat.view?.messages.length===0&&<div className="empty-chat group-empty"><GroupAvatar members={activeGroup.members} size={56}/><p>Start a conversation with {activeGroup.name}.</p><small>{activeGroup.members.length} Bots are ready to work on their own computers.</small></div>}
                {groupError&&<div className="local-feedback" role="status">{groupError}</div>}
              </> : <>
              {remote && history.id === active.id && history.status === 'loading' && <div role="status">Loading messages…</div>}
              {remote && history.id === active.id && history.status === 'error' && <div role="alert">Could not confirm message history. Refresh to check it.</div>}
              {botTimeline.length > 0 && !panel && <div className="date-line">{formatBotTime(active.lastActivityAt) || 'Today'}</div>}
              {botTimeline.map(renderBotTimelineEntry)}
              {remote && agentFeature === 'enabled' && runHistory.id === active.id && runHistory.status === 'error' && <div role="alert">Could not confirm task history. Refresh to check it before submitting again.</div>}
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
            {activeGroup&&remote&&agentFeature==='enabled'&&(pendingGroupFiles[activeGroup.id]||[]).length>0&&<div className="pending-files" aria-label="Files to attach">{(pendingGroupFiles[activeGroup.id]||[]).map(item=><span className="pending-file" key={item.key}><span>{item.file.name}{item.uploadedId?' · Ready':''}</span><button type="button" aria-label={`Remove ${item.file.name}`} disabled={groupSending} onClick={()=>setPendingGroupFiles(current=>({...current,[activeGroup.id]:(current[activeGroup.id]||[]).filter(file=>file.key!==item.key)}))}>×</button></span>)}</div>}
            {remote && agentFeature === 'enabled' && ((pendingFiles[active.id]||[]).length+(pendingRunFiles[active.id]||[]).length)>0 && <div className="pending-files" aria-label="Files to attach">{(pendingRunFiles[active.id]||[]).map((file,index)=><span className="pending-file" key={`run:${file.id}`}><span>{file.name}</span><button type="button" aria-label={`Remove reused ${file.name}`} onClick={()=>setPendingRunFiles(current=>({...current,[active.id]:(current[active.id]||[]).filter((_,itemIndex)=>itemIndex!==index)}))}>×</button></span>)}{(pendingFiles[active.id]||[]).map((file,index)=><span className="pending-file" key={`local:${file.name}:${file.lastModified}:${index}`}><span>{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={()=>setPendingFiles(current=>({...current,[active.id]:(current[active.id]||[]).filter((_,itemIndex)=>itemIndex!==index)}))}>×</button></span>)}</div>}
            {botMentionQuery&&botMentionCandidates.length>0&&<div id="bot-mention-list" className="group-mention-menu" role="listbox" aria-label="Mention a Bot">{botMentionCandidates.map((member,index)=><button id={`bot-mention-option-${member.id}`} key={member.id} type="button" role="option" aria-selected={index===botMentionActiveIndex} onMouseDown={event=>event.preventDefault()} onClick={()=>selectBotMention(member)}><Avatar bot={member} size={25}/><span><strong>{member.name}</strong>{member.label&&<small>{member.label}</small>}</span><small>Bot</small></button>)}</div>}
            <form className="composer" onSubmit={event=>{event.preventDefault();void addMessage(draft)}}><IconButton name="plus" label="Add attachment" onClick={()=>remote&&agentFeature==='enabled'?filePicker.current?.click():setNotice(true)}/><textarea ref={activeGroup?groupComposer:composerInput} aria-label={`Message ${activeGroup?.name||active.name}`} placeholder={`Message ${activeGroup?.name||active.name}`} value={draft} rows={1} disabled={composerDisabled} aria-autocomplete={botMentionQuery?'list':undefined} aria-expanded={botMentionQuery?Boolean(botMentionCandidates.length):undefined} aria-controls={botMentionQuery&&botMentionCandidates.length?'bot-mention-list':undefined} aria-activedescendant={botMentionQuery&&botMentionCandidates[botMentionActiveIndex]?`bot-mention-option-${botMentionCandidates[botMentionActiveIndex].id}`:undefined} onChange={event=>updateBotMentionDraft(event.currentTarget.value,event.currentTarget.selectionStart)} onPaste={event=>{if(!remote||agentFeature!=='enabled')return;const pasted=Array.from(event.clipboardData.files||[]);if(!pasted.length)return;event.preventDefault();activeGroup?stageGroupFiles(pasted):stageFiles(pasted)}} onKeyDown={handleComposerKeyDown}/><IconButton name="mic" label="Voice input" onClick={()=>setNotice(true)}/>{draft.trim()||(activeGroup?(pendingGroupFiles[activeGroup.id]||[]).length>0:((pendingFiles[active.id]||[]).length+(pendingRunFiles[active.id]||[]).length)>0)?<button type="submit" className="send-button" disabled={composerDisabled} aria-label={remote?'Send task':'Save local message'}><Icon name="arrow"/></button>:<IconButton name="sound" label="Start voice chat" className="voice-button" onClick={()=>setNotice(true)}/>}</form>
          </section>
          {account && panel && <div className="computer-panel-resize-handle" role="separator" aria-label="Resize computer panel" aria-orientation="vertical" aria-valuemin={productPanelMin()} aria-valuemax={productPanelMax(layoutSidebarWidth)} aria-valuenow={Math.round(computerPanelWidth)} aria-valuetext={`${Math.round(computerPanelWidth)} pixels`} tabIndex={0} onPointerDown={startComputerPanelResize} onPointerMove={moveComputerPanelResize} onPointerUp={finishComputerPanelResize} onPointerCancel={finishComputerPanelResize} onKeyDown={adjustComputerPanelResize} onDoubleClick={() => setComputerPanelWidth(initialProductPanelWidth('', layoutSidebarWidth, ''))} />}
          {panel && (activeGroup?<aside className="details-panel group-details-panel" aria-label="Group details"><GroupAvatar members={activeGroup.members} size={80}/><div className="group-panel-name">{activeGroup.name}</div><div className="group-panel-count">{activeGroup.members.length} Bots</div><div className="tabs"><button type="button" className={tab==='Details'?'active':''} onClick={()=>setTab('Details')}>Details</button><button type="button" className={tab==='Computer'?'active':''} onClick={()=>setTab('Computer')}>Computer</button></div>{tab==='Computer'?remote&&agentFeature==='enabled'?<ComputerPanel name={activeGroup.members.find(member=>member.id===groupComputerBotId)?.name||activeGroup.members[0].name} botId={groupComputerBotId||activeGroup.members[0].id}/>:<div className="computer-preview"><Icon name="screen"/><span>Computer not connected</span></div>:<div className="group-member-list" aria-label="Group members">{activeGroup.members.map(member=><div className="group-member" key={member.id}><Avatar bot={member} size={30}/><span><strong>{member.name}</strong>{member.label&&<small>{member.label}</small>}</span><button type="button" onClick={()=>{setGroupComputerBotId(member.id);setTab('Computer')}}>Computer</button></div>)}</div>}</aside>:<aside className="details-panel" aria-label="Bot details"><button type="button" className="avatar-edit" ref={avatarButton} aria-label="Change Bot picture" onClick={openAvatar}><Avatar bot={active} size={86} /></button><input className="bot-name" aria-label="Bot name" value={active.name} onChange={event => renameBot(event.target.value)} onBlur={() => saveBotName(active.id,active.name)} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}} /><input className="bot-label" aria-label="Bot label" placeholder="Add a label" maxLength={60} value={active.label} onChange={event=>{const label=event.target.value;setState(current=>({...current,bots:current.bots.map(bot=>bot.id===active.id?{...bot,label}:bot)}))}} onBlur={saveBotLabel} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}} /><div className="tabs">{(['Details', 'Library', 'Computer'] as const).map(name => <button key={name} type="button" className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>)}</div>{tab === 'Computer' ? remote && agentFeature === 'enabled' ? <ComputerPanel name={active.name} botId={active.id} official bot={active} onClose={()=>setPanel(false)} onRename={renameBot} onSaveName={()=>saveBotName(active.id,active.name)} onLabelChange={label=>setState(current=>({...current,bots:current.bots.map(bot=>bot.id===active.id?{...bot,label}:bot)}))} onSaveLabel={saveBotLabel} onChangeAvatar={openAvatar} onEditRoutine={name=>{setDraft(`Edit your routine: ${name}`);setPanel(false);requestAnimationFrame(()=>composerInput.current?.focus())}} /> : <><div className="computer-preview"><Icon name="screen" />{!reference && <span>Computer not connected</span>}</div><div className="screen-label">{active.name || 'Bot'}'s screen</div></> : <div className="panel-placeholder">{tab === 'Library' ? 'No local files in this preview.' : 'Routines and connections are not available in this preview.'}</div>}</aside>)}
        </div>
      </>}
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
  if (status === 'signedIn' && account) return <><PreviewApp key={`${account.tenantId}:${account.userId}`} account={account} onLogout={() => void logout()} />{logoutError && <div role="alert" className="auth-error">Sign out failed. Please try again.</div>}</>;
  return <main className="auth-page"><div className="auth-card"><h1>Coke Grok Bot</h1>{status === 'loading' ? <p>Checking your session…</p> : status === 'error' ? <><p role="alert">The sign-in service is unavailable.</p><button type="button" onClick={() => window.location.reload()}>Try again</button></> : <><p>Sign in to continue to the local preview.</p>{authError && <p role="alert">{authError}</p>}<a href={`${import.meta.env.BASE_URL}api/auth/google/start`}>Continue with Google</a></>}</div></main>;
}

function AppRoot() {
  if (import.meta.env.VITE_REQUIRE_AUTH === 'true') return <AuthenticatedApp />;
  if (new URLSearchParams(window.location.search).get('reference') === 'website-demo') return <WebsiteDemoApp />;
  return <PreviewApp />;
}

createRoot(document.getElementById('root')!).render(<AppRoot />);
