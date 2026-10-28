import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './shell.css';

type Shape = 'cloud' | 'drop' | 'hex' | 'round' | 'triangle';
type Bot = { id: string; name: string; label: string; color: string; shape: Shape; group: string; preview: string };
type Message = { id: string; role: 'user' | 'bot'; text: string };
type PreviewState = { bots: Bot[]; activeId: string; messages: Record<string, Message[]>; showOnboarding: Record<string, boolean> };
type IconName = 'search' | 'plus' | 'mic' | 'sound' | 'close' | 'panel' | 'share' | 'screen' | 'arrow' | 'smile' | 'reply' | 'more';

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
  const paths: Record<Shape, string> = {
    cloud: 'M7 28C4 21 7 13 13 10c5-4 11-4 17-3 6-3 12 0 15 5 6 3 10 9 9 15-1 6-5 9-10 11-4 6-11 9-18 8-5 3-12 2-16-1C4 41 3 34 7 28Z',
    drop: 'M27 4c-5 1-8 7-12 13C8 27 8 33 12 39c4 7 16 9 25 4 8-4 12-13 8-21C41 14 34 5 27 4Z',
    hex: 'M17 5 34 6 45 16 47 30 38 43 22 47 9 39 5 24 10 12Z',
    round: 'M27 4C13 4 4 14 4 27s10 23 23 23 23-10 23-23S40 4 27 4Z',
    triangle: 'M20 7c3-4 7-4 11 0l17 26c4 7 0 12-7 13l-29 1C5 47 2 42 5 35Z',
  };
  return <svg width={size} height={size} viewBox="0 0 54 54" className="avatar" aria-hidden="true">
    <path fill={bot.color} d={paths[bot.shape] || paths.round} />
    {bot.shape === 'cloud'
      ? <g fill="#fff" transform="rotate(-24 34 22)"><rect x="27" y="15" width="5" height="13" rx="2.5" /><rect x="38" y="15" width="5" height="13" rx="2.5" /></g>
      : <g fill="#fff" transform="rotate(-24 27 27)"><rect x="19" y="18" width="6" height="15" rx="3" /><rect x="31" y="18" width="6" height="15" rx="3" /></g>}
  </svg>;
}

function IconButton({ name, label, onClick, className = '' }: { name: IconName; label: string; onClick?: () => void; className?: string }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick}><Icon name={name} /></button>;
}

type Account = { userId: string; tenantId: string; email: string; name: string; role: string };

function PreviewApp({ account, onLogout }: { account?: Account; onLogout?: () => void }) {
  const storageKey = account ? `${STORAGE_KEY}:${account.tenantId}:${account.userId}` : STORAGE_KEY;
  const reference = new URLSearchParams(window.location.search).get('reference') === '101-new-bot';
  const [state, setState] = useState<PreviewState>(() => reference ? initialState(true) : safeStoredState(storageKey) || initialState(false));
  const [newChat, setNewChat] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState(false);
  const [tab, setTab] = useState<'Details' | 'Library' | 'Computer'>('Computer');
  const [draft, setDraft] = useState('');
  const [customAnswer, setCustomAnswer] = useState('');
  const [notice, setNotice] = useState(false);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const active = state.bots.find(bot => bot.id === state.activeId) || state.bots[0];
  const messages = state.messages[active.id] || [];
  const filtered = state.bots.filter(bot => `${bot.name} ${bot.label}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (reference) return;
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* The preview still works in memory. */ }
  }, [state, reference, storageKey]);
  useEffect(() => { setDraft(''); setCustomAnswer(''); setNotice(false); }, [state.activeId]);
  useEffect(() => { if (messages.length > 1) messagesEnd.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);

  function selectBot(id: string) {
    setState(current => ({ ...current, activeId: id }));
    setNewChat(false);
    setPanel(false);
  }
  function createBot() {
    const id = crypto.randomUUID();
    const bot: Bot = { id, name: 'New Bot', label: '', color: '#a382ef', shape: 'drop', group: 'Unassigned', preview: 'Start a conversation' };
    // A static welcome card demonstrates the recorded layout in this local-only preview.
    // It is not an Agent response and the preview notice remains visible.
    const welcome: Message = { id: 'welcome', role: 'bot', text: 'Hello — what would you like help with?' };
    setState(current => ({ ...current, bots: [bot, ...current.bots], activeId: id, messages: { ...current.messages, [id]: [welcome] }, showOnboarding: { ...current.showOnboarding, [id]: true } }));
    setNewChat(false);
    setPanel(false);
  }
  function addMessage(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setState(current => ({ ...current, messages: { ...current.messages, [active.id]: [...(current.messages[active.id] || []), { id: crypto.randomUUID(), role: 'user', text: clean }] }, bots: current.bots.map(bot => bot.id === active.id ? { ...bot, preview: clean } : bot), showOnboarding: { ...current.showOnboarding, [active.id]: false } }));
    setDraft(''); setCustomAnswer(''); setNotice(true);
  }
  function renameBot(name: string) {
    setState(current => ({ ...current, bots: current.bots.map(bot => bot.id === active.id ? { ...bot, name: name.slice(0, 60) } : bot) }));
  }

  return <div className={`app ${reference ? 'reference-mode' : 'preview-mode'}`}>
    <aside className="sidebar" aria-label="Bots">
      <div className="sidebar-top"><IconButton name="search" label="Search bots" onClick={() => { setSearching(value => !value); setQuery(''); }} /><IconButton name="plus" label="New chat" onClick={() => { setNewChat(true); setPanel(false); }} /></div>
      {searching && <input className="search-input" aria-label="Search bots" value={query} placeholder="Search bots" onChange={event => setQuery(event.target.value)} />}
      <button className="primary-bot" type="button" onClick={() => setNotice(true)} aria-label="Primary bot preview"><Avatar bot={primary} size={80} /><span>{primary.name}</span><small>{primary.label}</small></button>
      <div className="sidebar-scroll">
        {reference && <><div className="section-line"><span>OLD</span><span>3</span></div><div className="section-line"><span>MISC</span><span>3</span></div></>}
        <div className="section-line unassigned"><span>Unassigned</span></div>
        {filtered.map(bot => <button key={bot.id} type="button" className={`bot-row ${!newChat && bot.id === active.id ? 'selected' : ''}`} onClick={() => selectBot(bot.id)}>
          <Avatar bot={bot} size={46} /><span className="bot-row-content"><span className="bot-row-title">{bot.name}{bot.label && <small>{bot.label}</small>}</span><span className="bot-preview">{bot.preview}</span></span>
        </button>)}
        {filtered.length === 0 && <p className="empty-list">No matching bots</p>}
      </div>
      {reference && <button type="button" className="more-unreads">↓&nbsp; More unreads</button>}
      <div className="sidebar-footer"><div className="account-dot">{account ? account.name.slice(0, 1).toUpperCase() : "M"}</div>{account && <button type="button" className="logout-button" onClick={onLogout}>Sign out</button>}<button type="button" className="connect-button" onClick={() => setNotice(true)}>Connect apps <span aria-hidden="true">◈◉▣</span></button></div>
    </aside>
    <main className="main-shell">
      {!reference && <div className="preview-notice" role="status">本地界面预览：数据仅保存在当前浏览器，尚未连接云电脑或 Agent。</div>}
      {newChat ? <div className="new-chat-view">
        <div className="new-chat-head"><span>To: <span className="muted">Start a chat with...</span></span><IconButton name="close" label="Close new chat" onClick={() => setNewChat(false)} /></div>
        <div className="new-chat-menu"><button type="button" className="menu-option menu-primary" onClick={createBot}><Icon name="plus" />Create new Bot</button><button type="button" className="menu-option" onClick={() => setNotice(true)}><span className="menu-symbol">♧</span>Create group chat</button>{[primary, ...state.bots].map(bot => <button key={bot.id} type="button" className="menu-option" onClick={() => bot.id === primary.id ? setNotice(true) : selectBot(bot.id)}><Avatar bot={bot} size={27} />{bot.name}</button>)}<button type="button" className="menu-option team-option" onClick={() => setNotice(true)}><span>🟣</span>Team Bots <span className="menu-arrow">›</span></button></div>
      </div> : <>
        <div className="chat-header"><button type="button" className="chat-title" onClick={() => setPanel(value => !value)}><Avatar bot={active} size={30} /><span>{active.name}</span></button></div>
        <div className="header-actions"><IconButton name="share" label="Share bot" onClick={() => setNotice(true)} /><IconButton name="panel" label={panel ? 'Hide bot details' : 'Show bot details'} onClick={() => setPanel(value => !value)} /></div>
        <div className={`workspace ${panel ? 'with-panel' : ''}`}>
          <section className="conversation" aria-label={`Chat with ${active.name}`}>
            <div className="message-scroll">
              {messages.length > 0 && <div className="date-line">{reference ? 'Today 1:26 PM' : 'Today'}</div>}
              {messages.map(message => <div key={message.id} className={`message-line ${message.role}`}><div className="message-bubble">{message.text}</div>{message.role === 'bot' && <div className="message-actions"><Icon name="smile" /><Icon name="reply" /><Icon name="more" /></div>}</div>)}
              {state.showOnboarding[active.id] && <div className="onboarding-card">
                <div className="onboarding-title">What do you want me helping with most right now?<IconButton name="close" label="Dismiss suggestions" onClick={() => setState(current => ({ ...current, showOnboarding: { ...current.showOnboarding, [active.id]: false } }))} /></div>
                <div className="choice-list">{['Work & projects', 'Email & Slack', 'Calendar & scheduling', 'Research & writing', 'Something else'].map((option, index) => <button key={option} type="button" onClick={() => addMessage(option)}><span className="choice-key">{String.fromCharCode(65 + index)}</span><span>{option}{index === 4 && <small>I’ll tell you in chat</small>}</span></button>)}</div>
                <form onSubmit={event => { event.preventDefault(); addMessage(customAnswer); }}><input aria-label="Type your own answer" placeholder="Type your own answer" value={customAnswer} onChange={event => setCustomAnswer(event.target.value)} /></form>
                <div className="card-actions" aria-hidden="true"><Icon name="smile" /><Icon name="reply" /><Icon name="more" /></div>
              </div>}
              {!reference && !messages.length && <div className="empty-chat"><Avatar bot={active} size={52} /><p>Start a conversation with {active.name}.</p><small>This local preview does not connect to a model.</small></div>}
              {notice && <div className="local-feedback" role="status">This is a local preview. No message was sent to an Agent or external service.</div>}
              <div ref={messagesEnd} />
            </div>
            <form className="composer" onSubmit={event => { event.preventDefault(); addMessage(draft); }}><IconButton name="plus" label="Add attachment" onClick={() => setNotice(true)} /><textarea aria-label={`Message ${active.name}`} placeholder={`Message ${active.name}`} value={draft} rows={1} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); addMessage(draft); } }} /><IconButton name="mic" label="Voice input" onClick={() => setNotice(true)} />{draft.trim() ? <button type="submit" className="send-button" aria-label="Save local message"><Icon name="arrow" /></button> : <IconButton name="sound" label="Start voice chat" className="voice-button" onClick={() => setNotice(true)} />}</form>
          </section>
          {panel && <aside className="details-panel" aria-label="Bot details"><Avatar bot={active} size={86} /><input className="bot-name" aria-label="Bot name" value={active.name} onChange={event => renameBot(event.target.value)} /><span className="bot-label">{active.label || 'Add a label'}</span><div className="tabs">{(['Details', 'Library', 'Computer'] as const).map(name => <button key={name} type="button" className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>)}</div>{tab === 'Computer' ? <><div className="computer-preview"><Icon name="screen" /><span>Computer not connected</span></div><div className="screen-label">{active.name || 'Bot'}'s screen</div></> : <div className="panel-placeholder">{tab === 'Library' ? 'No local files in this preview.' : 'Routines and connections are not available in this preview.'}</div>}</aside>}
        </div>
      </>}
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
