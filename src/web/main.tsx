import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { avatarPaths } from './avatar-paths';
import './shell.css';

type Shape = 'cloud' | 'drop' | 'hex' | 'round' | 'triangle' | 'oval' | 'square' | 'pill' | 'spark' | 'heart' | 'flower' | 'pentagon' | 'star';
type Bot = { id: string; name: string; label: string; color: string; shape: Shape; group: string; preview: string; pinned?: boolean; hidden?: boolean };
type Message = { id: string; role: 'user' | 'bot'; text: string };
type AgentRun = { id: string; prompt: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'unknown'; result: string | null };
type Approval = { id: string; action: string; status: 'pending' | 'approved' | 'denied' | 'consumed' | 'expired'; hasScreenshot?: boolean };
type PreviewState = { bots: Bot[]; activeId: string; messages: Record<string, Message[]>; showOnboarding: Record<string, boolean> };
type IconName = 'search' | 'plus' | 'mic' | 'sound' | 'close' | 'panel' | 'share' | 'screen' | 'arrow' | 'smile' | 'reply' | 'more';
const avatarShapes:Shape[]=['round','oval','square','pill','triangle','hex','cloud','drop'];
const avatarColors=['#000000','#a27952','#ff3e51','#ff781c','#ffaf38','#00c972','#1cc3b0','#2a92fe','#a97efe','#ff5eb1','#959595'];
const createShapes:Shape[]=['round','oval','square','spark','cloud','heart','flower','drop','pill','triangle','pentagon','star','hex'];
const createColors=['#000000','#a06b39','#fb2b3e','#fd690f','#f59312','#14c16f','#13b7a2','#1e86fc','#8f59f9','#f93498','#959595'];

const STORAGE_KEY = 'coke-grok-bot:desktop-preview:v1';
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
    {detail ? <><p>{detail.kind === 'desktop' ? 'Desktop' : 'Browser'}: {detail.action}</p>{detail.page && <p>Page: {detail.page}</p>}{detail.arguments && <pre>{JSON.stringify(detail.arguments,null,2)}</pre>}</> : <p>{approval.action}</p>}
    {approval.hasScreenshot && <img src={`${import.meta.env.BASE_URL}api/approvals/${approval.id}/screenshot`} alt="Computer screen when this action was requested" onLoad={()=>setImageLoaded(true)} onError={()=>setImageLoaded(false)} />}
    <div><button type="button" disabled={disabled} onClick={()=>decide('denied')}>Deny</button><button type="button" disabled={disabled || Boolean(approval.hasScreenshot && !imageLoaded)} onClick={()=>decide('approved')}>Approve</button></div>
  </div>;
}

function ComputerPanel({name}:{name:string}) {
  const [owner,setOwner]=useState<'agent'|'user'|null>(null),[image,setImage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[text,setText]=useState('');
  const imageUrl=useRef(''),inFlight=useRef(false),mounted=useRef(true);
  useEffect(()=>{
    mounted.current=true;let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;const controller=new AbortController();
    const refresh=async()=>{try{
      const status=await fetch(`${import.meta.env.BASE_URL}api/computer`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!status.ok)throw new Error();
      const state=await status.json() as {owner?:unknown};if(state.owner!=='agent'&&state.owner!=='user')throw new Error();
      const screen=await fetch(`${import.meta.env.BASE_URL}api/computer/screenshot`,{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!screen.ok||screen.headers.get('content-type')?.split(';')[0]!=='image/png')throw new Error();
      const blob=await screen.blob();if(stopped)return;const next=URL.createObjectURL(blob),previous=imageUrl.current;imageUrl.current=next;setImage(next);setOwner(state.owner);if(previous)URL.revokeObjectURL(previous);
    }catch{if(!stopped){setOwner(null);setImage('');if(imageUrl.current)URL.revokeObjectURL(imageUrl.current);imageUrl.current=''}}finally{if(!stopped)timer=setTimeout(refresh,2000)}};
    void refresh();return ()=>{stopped=true;mounted.current=false;controller.abort();if(timer)clearTimeout(timer);if(imageUrl.current)URL.revokeObjectURL(imageUrl.current);imageUrl.current=''};
  },[]);
  const send=async(path:'control'|'action',body:unknown)=>{
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');
    try{const response=await fetch(`${import.meta.env.BASE_URL}api/computer/${path}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error();
      if(path==='control'){const result=await response.json() as {owner:'agent'|'user'};if(mounted.current)setOwner(result.owner)}
    }catch{if(mounted.current)setError('The operation could not be confirmed. Check the screen before trying again.')}finally{inFlight.current=false;if(mounted.current)setBusy(false)}
  };
  const click=(event:React.MouseEvent<HTMLImageElement>)=>{if(owner!=='user'||busy)return;const rect=event.currentTarget.getBoundingClientRect();const x=Math.min(1439,Math.max(0,Math.floor((event.clientX-rect.left)*1440/rect.width))),y=Math.min(899,Math.max(0,Math.floor((event.clientY-rect.top)*900/rect.height)));void send('action',{action:'click',x,y})};
  return <><div className="computer-preview">{image ? <img src={image} alt="Current computer screen" onClick={click} /> : <><Icon name="screen" /><span>Computer not connected</span></>}</div>
    <div className="screen-label">{name || 'Bot'}'s screen · {owner==='user'?'You are in control':owner==='agent'?'Bot is in control':'Waiting for computer'}</div>
    {owner && <div className="computer-controls"><button type="button" disabled={busy} onClick={()=>void send('control',{owner:owner==='agent'?'user':'agent'})}>{owner==='agent'?'Take control':'Return to Bot'}</button>
      {owner==='user' && <><form onSubmit={event=>{event.preventDefault();if(text){void send('action',{action:'type',text});setText('')}}}><input aria-label="Type on computer" value={text} maxLength={2000} onChange={event=>setText(event.target.value)} /><button disabled={busy||!text}>Type</button></form><button type="button" disabled={busy} onClick={()=>void send('action',{action:'press',key:'Enter'})}>Enter</button><p>Click the screen to interact. The image refreshes every few seconds.</p></>}</div>}
    {error && <p role="alert">{error}</p>}
  </>;
}

function PreviewApp({ account, onLogout }: { account?: Account; onLogout?: () => void }) {
  const reference = new URLSearchParams(window.location.search).get('reference') === '101-new-bot';
  const remote = Boolean(account) && !reference;
  const storageKey = account ? `${STORAGE_KEY}:${account.tenantId}:${account.userId}${remote ? ':server-chat-v1' : ''}` : STORAGE_KEY;
  const [state, setState] = useState<PreviewState>(() => reference ? initialState(true) : safeStoredState(storageKey) || initialState(false));
  const [botStatus, setBotStatus] = useState<'loading' | 'ready' | 'error'>(remote ? 'loading' : 'ready');
  const [botError, setBotError] = useState('');
  const [savingBot, setSavingBot] = useState(false);
  const savingBotRef=useRef(false);
  const [createUncertain,setCreateUncertain]=useState(false);
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
  const [customAnswer, setCustomAnswer] = useState('');
  const [notice, setNotice] = useState(false);
  const [agentFeature, setAgentFeature] = useState<'loading' | 'enabled' | 'disabled' | 'error'>(remote ? 'loading' : 'disabled');
  const [agentEngine, setAgentEngine] = useState<'pi' | 'dsh' | null>(null);
  const [runHistory, setRunHistory] = useState<{ id: string; status: 'loading' | 'ready' | 'error'; runs: AgentRun[] }>({ id: '', status: 'loading', runs: [] });
  const [runRefresh, setRunRefresh] = useState(0);
  const [runApprovals, setRunApprovals] = useState<Record<string, Approval[]>>({});
  const [decidingApproval, setDecidingApproval] = useState<string | null>(null);
  const decidingRef = useRef(false);
  const uncertainMutation = useRef(false);
  const [history, setHistory] = useState<{ id: string; status: 'loading' | 'ready' | 'error' }>({ id: '', status: 'loading' });
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const recipientInput = useRef<HTMLInputElement>(null);
  const savedNames = useRef<Record<string, string>>({});
  const renameQueue = useRef<Record<string, Promise<void>>>({});
  const savedLabels = useRef<Record<string, string>>({});
  const labelQueue = useRef<Record<string, Promise<void>>>({});
  const active = state.bots.find(bot => bot.id === state.activeId) || state.bots[0];
  const activeIdRef = useRef(active?.id); activeIdRef.current = active?.id;
  const messages = active ? state.messages[active.id] || [] : [];
  const filtered = state.bots.filter(bot => !(reference && newChat && bot.id === 'new') && `${bot.name} ${bot.label}`.toLowerCase().includes(query.toLowerCase()));
  const visibleBots = filtered.filter(bot=>!bot.hidden).sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned)));
  const hiddenBots = filtered.filter(bot=>bot.hidden);
  const menuBot = sidebarMenu ? state.bots.find(bot=>bot.id===sidebarMenu.id) : undefined;

  useEffect(() => {
    if (reference) return;
    try { localStorage.setItem(storageKey, JSON.stringify(remote ? { ...state, messages: {}, showOnboarding: {} } : state)); } catch { /* The preview still works in memory. */ }
  }, [state, reference, remote, storageKey]);
  useEffect(() => {
    if (!remote) return;
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}api/bots`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('bots unavailable'); return response.json() as Promise<{ bots: Omit<Bot, 'preview'>[] }>; })
      .then(({ bots }) => {
        if (!Array.isArray(bots)) throw new Error('invalid bots');
        const mapped = bots.map(bot => ({ ...bot, preview: 'Start a conversation' }));
        savedNames.current = Object.fromEntries(mapped.map(bot => [bot.id, bot.name]));
        savedLabels.current = Object.fromEntries(mapped.map(bot => [bot.id, bot.label]));
        setState(current => ({ ...current, bots: mapped, activeId: mapped.some(bot => bot.id === current.activeId) ? current.activeId : mapped[0]?.id || '' }));
        setBotStatus('ready');
      }).catch(error => { if (error.name !== 'AbortError') setBotStatus('error'); });
    return () => controller.abort();
  }, [remote]);
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
    if (!remote || agentFeature !== 'enabled' || botStatus !== 'ready' || !active?.id) return;
    const id = active.id, controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setRunHistory({ id, status: 'loading', runs: [] });
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
        timer = setTimeout(() => void load(), 2000);
      } catch (error) {
        if (!controller.signal.aborted) setRunHistory(current => ({ id, status: 'error', runs: current.id === id ? current.runs : [] }));
      }
    };
    void load();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [remote, agentFeature, botStatus, active?.id, runRefresh]);
  useEffect(() => {
    if (!remote || !active?.id) return;
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
  }, [remote, active?.id]);
  useEffect(() => { setDraft(''); setCustomAnswer(''); setNotice(false); }, [state.activeId]);
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
        event.preventDefault();if(reference){setRecipientQuery('');setNewChat(true);setPanel(false)}else beginCreate();
      }
    };
    window.addEventListener('keydown',onKeyDown);return ()=>window.removeEventListener('keydown',onKeyDown);
  },[]);
  useEffect(() => { if (messages.length > 1) messagesEnd.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);

  function selectBot(id: string) {
    if (sendingRef.current) return;
    setState(current => ({ ...current, activeId: id }));
    setNewChat(false);
    setRecipientQuery('');
    setPanel(false);
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
  async function addMessage(text: string) {
    if (!active || uncertainMutation.current) return;
    const clean = text.trim();
    if (!clean) return;
    if (remote) {
      const id = active.id;
      if (sendingRef.current || history.id !== id || history.status !== 'ready') return;
      if (agentFeature === 'loading' || agentFeature === 'error' || (agentFeature === 'enabled' && (runHistory.id !== id || runHistory.status !== 'ready'))) return;
      if (clean.length > 10000) { setBotError('Message is too long.'); return; }
      sendingRef.current = true; setSending(true); setBotError('');
      try {
        if (agentFeature === 'enabled') {
          const response = await fetch(`${import.meta.env.BASE_URL}api/bots/${id}/runs`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), prompt: clean }) });
          if (!response.ok) throw new Error('run submission failed');
          const { run } = await response.json() as { run: AgentRun };
          if (!run || typeof run.id !== 'string' || typeof run.prompt !== 'string') throw new Error('invalid run response');
          setRunHistory(current => ({ id, status: 'ready', runs: [...current.runs.filter(item => item.id !== run.id), run] }));
          setState(current => ({ ...current, bots: current.bots.map(bot => bot.id === id ? { ...bot, preview: clean } : bot) }));
          if (activeIdRef.current === id) { setDraft(''); setCustomAnswer(''); }
          setRunRefresh(value => value + 1);
          return;
        }
        const response = await fetch(`${import.meta.env.BASE_URL}api/bots/${id}/messages`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: clean }) });
        if (!response.ok) throw new Error('save failed');
        const { message } = await response.json() as { message: Message };
        setState(current => ({ ...current, messages: { ...current.messages, [id]: [...(current.messages[id] || []), message] }, bots: current.bots.map(bot => bot.id === id ? { ...bot, preview: clean } : bot) }));
        if (activeIdRef.current === id) { setDraft(''); setCustomAnswer(''); setNotice(true); }
      } catch {
        uncertainMutation.current = true;
        if (agentFeature === 'enabled') setRunHistory(current => ({ ...current, id, status: 'error' }));
        else setHistory({ id, status: 'error' });
        setBotError('Submission could not be confirmed. Refresh and check the history before trying again.');
      } finally { sendingRef.current = false; setSending(false); }
      return;
    }
    setState(current => ({ ...current, messages: { ...current.messages, [active.id]: [...(current.messages[active.id] || []), { id: crypto.randomUUID(), role: 'user', text: clean }] }, bots: current.bots.map(bot => bot.id === active.id ? { ...bot, preview: clean } : bot), showOnboarding: { ...current.showOnboarding, [active.id]: false } }));
    setDraft(''); setCustomAnswer(''); setNotice(true);
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
        savedNames.current[id] = name;
        setState(current => ({ ...current, bots: current.bots.map(bot => bot.id === id && bot.name === draftName ? { ...bot, name } : bot) }));
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
  const renderBotRow=(bot:Bot)=><div className="bot-row-wrap" key={bot.id}><button ref={element=>{sidebarRows.current[bot.id]=element}} type="button" className={`bot-row ${!newChat && bot.id === active?.id ? 'selected' : ''}`} aria-haspopup="menu" onClick={() => selectBot(bot.id)} onContextMenu={event=>{event.preventDefault();setSidebarMenu({id:bot.id,x:Math.max(0,Math.min(event.clientX,window.innerWidth-200)),y:Math.max(0,Math.min(event.clientY,window.innerHeight-265))})}}>
          <Avatar bot={bot} size={46} /><span className="bot-row-content"><span className="bot-row-title"><span onDoubleClick={event=>{event.stopPropagation();beginSidebarRename(bot.id)}}>{bot.name}</span>{bot.label && <small>{bot.label}</small>}</span><span className="bot-preview">{bot.preview}</span></span>
        </button>{sidebarRename?.id===bot.id && <input ref={sidebarInput} className="sidebar-rename" aria-label="Rename Bot" maxLength={60} value={sidebarRename.value} onChange={event=>{const edit={id:bot.id,value:event.target.value};sidebarRenameRef.current=edit;setSidebarRename(edit)}} onBlur={event=>finishSidebarRename(bot.id,event.currentTarget.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur()}else if(event.key==='Escape'){event.preventDefault();sidebarRenameRef.current=null;setSidebarRename(null);sidebarRows.current[bot.id]?.focus()}}} />}</div>;
  const composerDisabled = remote && (sending || history.id !== active?.id || history.status !== 'ready' || agentFeature === 'loading' || agentFeature === 'error' || (agentFeature === 'enabled' && (runHistory.id !== active?.id || runHistory.status !== 'ready')));
  if (botStatus === 'loading') return <main className="auth-page"><div className="auth-card">Loading your Bots…</div></main>;
  if (botStatus === 'error') return <main className="auth-page"><div className="auth-card"><p role="alert">Could not load your Bots.</p><button type="button" onClick={() => window.location.reload()}>Try again</button></div></main>;

  return <div className={`app ${reference ? 'reference-mode' : 'preview-mode'}`}>
    <aside className="sidebar" aria-label="Bots">
      <div className="sidebar-top"><IconButton name="search" label="Search bots" onClick={() => { setSearching(value => !value); setQuery(''); }} /><IconButton buttonRef={createTrigger} name="plus" label="New chat" onClick={() => { if(reference){setRecipientQuery('');setNewChat(true);setPanel(false)}else beginCreate(); }} /></div>
      {searching && <input className="search-input" aria-label="Search bots" value={query} placeholder="Search bots" onChange={event => setQuery(event.target.value)} />}
      <button className="primary-bot" type="button" onClick={() => setNotice(true)} aria-label="Primary bot preview"><Avatar bot={primary} size={80} /><span>{primary.name}</span><small>{primary.label}</small></button>
      <div className="sidebar-scroll">
        {reference && <><div className="section-line"><span>OLD</span><span>3</span></div><div className="section-line"><span>MISC</span><span>3</span></div></>}
        <div className="section-line unassigned"><span>Unassigned</span></div>
        {visibleBots.map(renderBotRow)}
        {hiddenBots.length>0 && <><button type="button" className="hidden-section" aria-expanded={hiddenOpen} onClick={()=>setHiddenOpen(value=>!value)}><span>{hiddenOpen?'⌄':'›'}&nbsp; Hidden Bots</span><span>{hiddenBots.length}</span></button>{hiddenOpen && hiddenBots.map(renderBotRow)}</>}
        {filtered.length === 0 && <p className="empty-list">No matching bots</p>}
      </div>
      {reference && <button type="button" className="more-unreads">↓&nbsp; More unreads</button>}
      <div className="sidebar-footer"><div className="account-dot">{account ? account.name.slice(0, 1).toUpperCase() : "M"}</div>{account && <button type="button" className="logout-button" onClick={onLogout}>Sign out</button>}<button type="button" className="connect-button" onClick={() => setNotice(true)}>Connect apps <span aria-hidden="true">◈◉▣</span></button></div>
    </aside>
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
      {!reference && <div className="preview-notice" role="status">{remote ? (agentFeature === 'enabled' ? `${agentEngine === 'dsh' ? 'DeepSeek Harness' : 'Pi'} 任务在你的云电脑执行；同一台电脑的任务会排队。` : 'Bot 和消息保存在服务器；尚未连接云电脑或 Agent。原预览数据仍在本地，不会自动导入。') : '本地界面预览：数据仅保存在当前浏览器，尚未连接云电脑或 Agent。'}</div>}
      {remote && agentFeature === 'error' && <div role="alert">Could not check Agent availability. Refresh to try again.</div>}
      {botError && !createDialog && <div role="alert">{botError}</div>}
      {newChat || !active ? <div className="new-chat-view" onKeyDown={event=>{if(event.key==='Escape'&&active){setNewChat(false);setRecipientQuery('')}}}>
        <div className="new-chat-head"><label>To: <input ref={recipientInput} aria-label="Start a chat with" placeholder="Start a chat with..." value={recipientQuery} onChange={event=>setRecipientQuery(event.target.value)} /></label><IconButton name="close" label="Close new chat" onClick={() => {setNewChat(false);setRecipientQuery('')}} /></div>
        <div className="new-chat-menu" aria-label="Chat recipients"><button type="button" className="menu-option menu-primary" onClick={()=>reference?void createBot():beginCreate()}><Icon name="plus" />Create new Bot</button><button type="button" className="menu-option" onClick={() => setNotice(true)}><span className="menu-symbol">♧</span>Create group chat</button>{[primary, ...state.bots.filter(bot=>!reference || bot.id!=='new')].filter(bot=>`${bot.name} ${bot.label}`.toLowerCase().includes(recipientQuery.trim().toLowerCase())).map(bot => <button key={bot.id} type="button" className="menu-option" onClick={() => bot.id === primary.id ? setNotice(true) : selectBot(bot.id)}><Avatar bot={bot} size={27} />{bot.name}</button>)}<button type="button" className="menu-option team-option" onClick={() => setNotice(true)}><span>🟣</span>Team Bots <span className="menu-arrow">›</span></button></div>
        <div className="composer new-chat-composer"><IconButton name="plus" label="Add attachment" onClick={() => setNotice(true)} /><textarea aria-label="Message Bot" placeholder="Message Bot" disabled rows={1} /><IconButton name="mic" label="Voice input" className="voice-button" onClick={() => setNotice(true)} /></div>
      </div> : <>
        <div className={`chat-header ${panel ? 'panel-open' : ''}`}><button type="button" className="chat-title" onClick={() => setPanel(value => !value)}><Avatar bot={active} size={30} /><span>{active.name}</span></button></div>
        <div className="header-actions"><IconButton name="share" label="Share bot" onClick={() => setNotice(true)} /><IconButton name="panel" label={panel ? 'Hide bot details' : 'Show bot details'} onClick={() => setPanel(value => !value)} /></div>
        <div className={`workspace ${panel ? 'with-panel' : ''}`}>
          <section className="conversation" aria-label={`Chat with ${active.name}`}>
            <div className="message-scroll">
              {remote && history.id === active.id && history.status === 'loading' && <div role="status">Loading messages…</div>}
              {remote && history.id === active.id && history.status === 'error' && <div role="alert">Could not confirm message history. Refresh to check it.</div>}
              {messages.length > 0 && <div className="date-line">{reference ? 'Today 1:26 PM' : 'Today'}</div>}
              {messages.map(message => <div key={message.id} className={`message-line ${message.role}`}><div className="message-bubble">{message.text}</div>{message.role === 'bot' && <div className="message-actions"><Icon name="smile" /><Icon name="reply" /><Icon name="more" /></div>}</div>)}
              {remote && agentFeature === 'enabled' && runHistory.id === active.id && runHistory.runs.map(run => <React.Fragment key={run.id}><div className="message-line user"><div className="message-bubble">{run.prompt}</div></div><div className="message-line bot"><div className="message-bubble"><span className="run-status">{({ queued: 'Queued · waiting for your computer', running: 'Working on your computer', completed: 'Completed', failed: 'Failed', unknown: 'Outcome unknown · check before retrying' } as const)[run.status]}</span>{run.result && <p>{run.result}</p>}{(runApprovals[run.id] || []).filter(approval => approval.status === 'pending').map(approval => <ApprovalCard key={approval.id} approval={approval} disabled={Boolean(decidingApproval) || runHistory.status !== 'ready'} decide={decision => void decideApproval(approval.id, decision)} />)}</div></div></React.Fragment>)}
              {remote && agentFeature === 'enabled' && runHistory.id === active.id && runHistory.status === 'error' && <div role="alert">Could not confirm task history. Refresh to check it before submitting again.</div>}
              {state.showOnboarding[active.id] && <div className="onboarding-card">
                <div className="onboarding-title">What do you want me helping with most right now?<IconButton name="close" label="Dismiss suggestions" onClick={() => setState(current => ({ ...current, showOnboarding: { ...current.showOnboarding, [active.id]: false } }))} /></div>
                <div className="choice-list">{['Work & projects', 'Email & Slack', 'Calendar & scheduling', 'Research & writing', 'Something else'].map((option, index) => <button key={option} type="button" onClick={() => addMessage(option)}><span className="choice-key">{String.fromCharCode(65 + index)}</span><span>{option}{index === 4 && <small>I’ll tell you in chat</small>}</span></button>)}</div>
                <form onSubmit={event => { event.preventDefault(); addMessage(customAnswer); }}><input aria-label="Type your own answer" placeholder="Type your own answer" value={customAnswer} onChange={event => setCustomAnswer(event.target.value)} /></form>
                <div className="card-actions" aria-hidden="true"><Icon name="smile" /><Icon name="reply" /><Icon name="more" /></div>
              </div>}
              {!reference && !messages.length && !(agentFeature === 'enabled' && runHistory.id === active.id && runHistory.runs.length) && <div className="empty-chat"><Avatar bot={active} size={52} /><p>Start a conversation with {active.name}.</p>{agentFeature !== 'enabled' && <small>This local preview does not connect to a model.</small>}</div>}
              {notice && <div className="local-feedback" role="status">{remote ? 'No message was sent to an Agent.' : 'This is a local preview. No message was sent to an Agent or external service.'}</div>}
              <div ref={messagesEnd} />
            </div>
            <form className="composer" onSubmit={event => { event.preventDefault(); void addMessage(draft); }}><IconButton name="plus" label="Add attachment" onClick={() => setNotice(true)} /><textarea aria-label={`Message ${active.name}`} placeholder={`Message ${active.name}`} value={draft} rows={1} disabled={composerDisabled} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void addMessage(draft); } }} /><IconButton name="mic" label="Voice input" onClick={() => setNotice(true)} />{draft.trim() ? <button type="submit" className="send-button" disabled={composerDisabled} aria-label={remote ? (agentFeature === 'enabled' ? 'Send task' : 'Save message') : 'Save local message'}><Icon name="arrow" /></button> : <IconButton name="sound" label="Start voice chat" className="voice-button" onClick={() => setNotice(true)} />}</form>
          </section>
          {panel && <aside className="details-panel" aria-label="Bot details"><button type="button" className="avatar-edit" ref={avatarButton} aria-label="Change Bot picture" onClick={openAvatar}><Avatar bot={active} size={86} /></button><input className="bot-name" aria-label="Bot name" value={active.name} onChange={event => renameBot(event.target.value)} onBlur={() => saveBotName(active.id,active.name)} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}} /><input className="bot-label" aria-label="Bot label" placeholder="Add a label" maxLength={60} value={active.label} onChange={event=>{const label=event.target.value;setState(current=>({...current,bots:current.bots.map(bot=>bot.id===active.id?{...bot,label}:bot)}))}} onBlur={saveBotLabel} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}} /><div className="tabs">{(['Details', 'Library', 'Computer'] as const).map(name => <button key={name} type="button" className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>)}</div>{tab === 'Computer' ? remote && agentFeature === 'enabled' ? <ComputerPanel name={active.name} /> : <><div className="computer-preview"><Icon name="screen" />{!reference && <span>Computer not connected</span>}</div><div className="screen-label">{active.name || 'Bot'}'s screen</div></> : <div className="panel-placeholder">{tab === 'Library' ? 'No local files in this preview.' : 'Routines and connections are not available in this preview.'}</div>}</aside>}
        </div>
      </>}
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
    </main>
  </div>;
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

createRoot(document.getElementById('root')!).render(import.meta.env.VITE_REQUIRE_AUTH === 'true' ? <AuthenticatedApp /> : <PreviewApp />);
