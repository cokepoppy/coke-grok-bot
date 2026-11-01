import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { avatarPaths } from './avatar-paths';
import './website-demo.css';

type Agent = { id: string; name: string; color: string; shape: keyof typeof avatarPaths; preview: string; time?: string; timeOffsetHours?: number; unread?: boolean; group?: boolean };
type DemoPhase = 'intro' | 'connections' | 'action-needed' | 'takeover' | 'computer-working' | 'computer' | 'results' | 'collaboration' | 'approval' | 'complete';

const demoPhases: DemoPhase[] = ['intro', 'connections', 'action-needed', 'takeover', 'computer-working', 'computer', 'results', 'collaboration', 'approval', 'complete'];
const computerActiveColor = '#895af2';
const demoTimeline: Array<[number, DemoPhase]> = [
  [1_200, 'connections'],
  [2_400, 'action-needed'],
  [3_600, 'takeover'],
  [4_800, 'computer-working'],
  [6_000, 'computer'],
  [7_200, 'results'],
  [8_400, 'collaboration'],
  [9_600, 'approval'],
  [10_800, 'complete'],
];

const agents: Agent[] = [
  { id: 'chief', name: 'Chief', color: '#54b9a5', shape: 'round', preview: 'booked the venue and sent the confirmation around.', time: 'Yesterday' },
  { id: 'sales', name: 'Sales Outbound', color: '#f19d39', shape: 'round', preview: 'Done.', timeOffsetHours: 0 },
  { id: 'inbox', name: 'Inbox Manager', color: '#6464ef', shape: 'drop', preview: 'sent. inbox at zero, 5 drafts parked for tomorrow.', timeOffsetHours: -3, unread: true },
  { id: 'account', name: 'Account Manager', color: '#895cf5', shape: 'round', preview: "invite's out to vicky. globex note held in drafts.", timeOffsetHours: -5 },
  { id: 'talent', name: 'Talent Scout', color: '#3c82f6', shape: 'round', preview: '3 intros drafted in your voice, held for your ok.', timeOffsetHours: -8 },
  { id: 'expense', name: 'Expense Manager', color: '#ed712e', shape: 'round', preview: 'report filed. 9 receipts, nothing outstanding.', timeOffsetHours: -4 },
  { id: 'offsite', name: 'Offsite crew', color: '#52bca9', shape: 'round', preview: "that leaves the pipeline. i'd spin up a dedicated agent.", timeOffsetHours: -6, group: true },
];

const inboxDemoAvatarPath = 'M 20 7 C 15 6 12 9 10 14 C 8 18 8 24 8.5 30 C 8.5 36 8 42 9 48 C 10 53 12 56 17 58 C 22 58 27 56 33 54 C 42 51 49 47 54 42 C 58 38 59.25 33 59.25 28 C 57 24 54 21 50 19 C 46 17 41 16 37 14 C 33 12 31 9 27 8 C 24 7 22 7 20 7 Z';

const taskText = 'Overnight pipeline generation and outbound.\n\nPick eligible prospects from this Google Sheet, research them on the web, grab context on contacts and accounts from Hex, Sumble, and Salesforce. Draft email and LinkedIn sequences in my voice.';

function AgentAvatar({ agent, size = 30, smooth = false }: { agent: Agent; size?: number; smooth?: boolean }) {
  const path = avatarPaths[agent.shape] || avatarPaths.round;
  const inboxDemoAvatar = agent.id === 'inbox' && size >= 30;
  return <svg className={`site-demo-avatar${inboxDemoAvatar ? ' inbox' : ''}`} width={size} height={size} viewBox="0 0 54 54" preserveAspectRatio={size === 20 ? 'none' : undefined} aria-hidden="true">
    {agent.shape === 'round' ? <circle cx="27" cy="27" r={smooth ? 22.5 : 23} fill={agent.color} /> : <path d={inboxDemoAvatar ? inboxDemoAvatarPath : path} fill={agent.color} />}
    <g fill="#fff" transform={smooth ? undefined : 'rotate(-24 33 21)'}><rect x="25" y="16" width="4" height="10" rx="2" /><rect x="37" y="16" width="4" height="10" rx="2" /></g>
    {('unread' in agent && agent.unread) && <circle cx={inboxDemoAvatar ? 41 : 44} cy={inboxDemoAvatar ? 14 : 11} r={inboxDemoAvatar ? 9.7 : 8} fill="#ff3b2f" stroke="#fff" strokeWidth="2" />}
  </svg>;
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg>;
}

function VoiceMessageIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 18v3m-3 0h6" /></svg>;
}

function ScreenIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="1.5" /><path d="M12 17v3M8 20h8" /></svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.2" /><path d="m15.2 15.2 4.4 4.4" /></svg>;
}

function AgentTitleMark({ color }: { color: string }) {
  return <svg className="site-demo-title-mark" width="24" height="24" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="22.5" fill={color} /><g fill="#fff"><rect x="22" y="16" width="4" height="10" rx="2" /><rect x="30" y="16" width="4" height="10" rx="2" /></g></svg>;
}

function GearIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" /><path d="m19.2 13.8 1.1.9-1.5 2.6-1.4-.6a7.3 7.3 0 0 1-1.5.9l-.2 1.5h-3l-.3-1.5a7.3 7.3 0 0 1-1.5-.9l-1.4.6L8 14.7l1.1-.9a6.7 6.7 0 0 1 0-1.8L8 11.1l1.5-2.6 1.4.6a7.3 7.3 0 0 1 1.5-.9l.3-1.5h3l.2 1.5a7.3 7.3 0 0 1 1.5.9l1.4-.6 1.5 2.6-1.1.9a6.7 6.7 0 0 1 0 1.8Z" /></svg>;
}

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7" /></svg>;
}

function ClockIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.3 2" /></svg>;
}

function DemoActivity({ label }: { label: string }) {
  return <div className="site-demo-activity" role="status"><span className="site-demo-thinking-dots" aria-hidden="true"><i /><i /><i /></span><span>{label}</span></div>;
}

function formatClock(date: Date) {
  return new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: false }).format(date);
}

function formatCreatedAgentClock(date: Date) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function ComputerScreen({ large = false, showCrm = true, showDraftsQueue = true, showPointer = false, showSalesforceLogin = false, showHumanPointer = false }: { large?: boolean; showCrm?: boolean; showDraftsQueue?: boolean; showPointer?: boolean; showSalesforceLogin?: boolean; showHumanPointer?: boolean }) {
  return <div className={`site-demo-desktop ${large ? 'large' : ''}`} aria-label="Example computer screen">
    <div className="site-demo-mountain" />
    {showSalesforceLogin ? <div className="site-demo-salesforce-login" aria-label="Salesforce sign-in screen">
      <div className="site-demo-window-controls"><i /><i /><i /><span className="site-demo-window-title-placeholder" /></div>
      <div className="site-demo-salesforce-login-body"><i aria-hidden="true" /><span className="site-demo-login-field">Email</span><span className="site-demo-login-field">Password</span><span className="site-demo-login-button">Sign in</span></div>
    </div> : showCrm && <div className="site-demo-window-back">
      <div className="site-demo-window-controls"><i /><i /><i /><span className="site-demo-window-title-placeholder" /></div>
      <div className="site-demo-back-body">
        <aside className="site-demo-back-nav" aria-hidden="true">{['70%', '57%', '80%', '62%', '78%', '50%', '65%'].map((width, index) => <i key={index} style={{ width }} />)}</aside>
        <div className="site-demo-back-sheet">
          <div className="site-demo-back-sheet-head"><i /><i /></div>
          <div className="site-demo-checklist">{Array.from({ length: 11 }, (_, index) => <span key={index}><b>✓</b><em /><i /></span>)}</div>
          <div className="site-demo-back-foot">52 accounts</div>
        </div>
      </div>
    </div>}
    {!showSalesforceLogin && showDraftsQueue && <div className="site-demo-window-front">
      <div className="site-demo-window-controls"><i /><i /><i /><span className="site-demo-window-title-placeholder" /></div>
      <div className="site-demo-mini-title"><span>Outreach queue</span><i /></div>
      {[['Priya Natarajan', '82%'], ['Marcus Webb', '64%'], ['Elena Sørensen', '74%'], ['Daniel Alvarez', '58%']].map(([name, lineWidth]) => <div className="site-demo-contact" key={name}><b /><span className="site-demo-contact-copy"><span>{name}</span><i style={{ width: lineWidth }} /></span><small>Draft</small></div>)}
      <div className="site-demo-queue-foot"><span>36 drafts queued</span><span>0 sent</span></div>
    </div>}
    {showPointer && <div className="site-demo-agent-pointer" aria-hidden="true"><svg viewBox="0 0 18 24"><path d="M2 1v18l5-4 3 7 3-1-3-7 7-.5L2 1Z" /></svg><i /></div>}
    {showHumanPointer && <div className="site-demo-human-pointer" aria-hidden="true"><svg viewBox="0 0 18 24"><path d="M2 1v18l5-4 3 7 3-1-3-7 7-.5L2 1Z" /></svg><span>You</span></div>}
  </div>;
}

function ComputerAppDock({ showCrm, showDraftsQueue, toggleCrm, toggleDraftsQueue, loginOnly = false }: { showCrm: boolean; showDraftsQueue: boolean; toggleCrm: () => void; toggleDraftsQueue: () => void; loginOnly?: boolean }) {
  return <div className="site-demo-app-dock" role="toolbar" aria-label="Applications">
    {loginOnly ? <button type="button" aria-label="Safari">
      <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" /><circle className="site-demo-compass-ring" cx="20" cy="20" r="12.5" /><path className="site-demo-compass-needle" d="m25.8 13.8-4.4 9-7.2 3.4 3.6-7.4z" /></svg>
    </button> : <><button type="button" aria-label={`${showCrm ? 'Hide' : 'Show'} CRM portal`} aria-pressed={showCrm} onClick={toggleCrm}>
      <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" /><circle className="site-demo-compass-ring" cx="20" cy="20" r="12.5" /><path className="site-demo-compass-needle" d="m25.8 13.8-4.4 9-7.2 3.4 3.6-7.4z" /></svg>
    </button><button type="button" aria-label={`${showDraftsQueue ? 'Hide' : 'Show'} Drafts queue`} aria-pressed={showDraftsQueue} onClick={toggleDraftsQueue}>
      <svg viewBox="0 0 40 40" aria-hidden="true"><rect x="3" y="3" width="34" height="34" rx="9" /><path className="site-demo-mail" d="m8 13 12 9 12-9M8 13v14h24V13" /></svg>
    </button></>}
  </div>;
}

function NewAgentPicker({ query, create, select }: { query: string; create: () => void; select: (id: string) => void }) {
  return <div className="site-demo-picker" role="dialog" aria-label="Search or create agents">
    <div className="site-demo-picker-options" role="listbox">
      <button type="button" className="site-demo-picker-option site-demo-create-agent-option" onClick={create}><span className="site-demo-picker-plus"><PlusIcon /></span>Create new agent</button>
      {agents.filter(agent => agent.name.toLowerCase().includes(query.toLowerCase())).map(agent => <button type="button" key={agent.id} className="site-demo-picker-option" onClick={() => select(agent.id)}><AgentAvatar agent={agent} size={27} />{agent.name}</button>)}
    </div>
  </div>;
}

export function WebsiteDemoApp() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [demoPhase, setDemoPhase] = useState<DemoPhase>(prefersReducedMotion ? 'complete' : 'intro');
  const [demoPaused, setDemoPaused] = useState(prefersReducedMotion);
  const [active, setActive] = useState('sales');
  const [computerOpen, setComputerOpen] = useState(false);
  const [screenOpen, setScreenOpen] = useState(false);
  const [showCrm, setShowCrm] = useState(true);
  const [showDraftsQueue, setShowDraftsQueue] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileName, setProfileName] = useState('Sales Outbound');
  const [profileTitle, setProfileTitle] = useState('Sales');
  const [profileDescription, setProfileDescription] = useState('Works the pipeline overnight: researches the prospects worth a look, pulls their context together, and leaves sequences drafted for the morning.');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [agentPickerQuery, setAgentPickerQuery] = useState('');
  const [search, setSearch] = useState('');
  const [newAgentCreated, setNewAgentCreated] = useState(false);
  const [newAgentCreatedTime, setNewAgentCreatedTime] = useState('');
  const [clockBase] = useState(() => new Date(2026, 9, 31, 16, 35));
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const isNewAgent = active === 'new-agent';
  const phaseIndex = demoPhases.indexOf(demoPhase);
  const isComplete = demoPhase === 'complete';
  const isComputerWorking = demoPhase === 'computer-working';
  const isActionNeeded = demoPhase === 'action-needed';
  const isUserInControl = demoPhase === 'takeover';
  const showScreenOverlay = screenOpen || isUserInControl;
  const selected = agents.find(agent => agent.id === active) || agents[1];
  const displayName = isNewAgent ? 'New agent' : selected.id === 'sales' ? profileName : selected.name;
  const formatAgentTime = (agent: Agent) => agent.time || formatClock(new Date(clockBase.getTime() + (agent.timeOffsetHours || 0) * 60 * 60 * 1000 - (agent.id === 'sales' ? 0 : 60_000)));
  const newAgent: Agent = { id: 'new-agent', name: 'New agent', color: '#111110', shape: 'round', preview: '', time: newAgentCreatedTime };

  useEffect(() => {
    if (demoPaused || isComplete || active !== 'sales') return;
    const next = demoTimeline[phaseIndex];
    if (!next) return;
    const timer = window.setTimeout(() => setDemoPhase(next[1]), next[0] - (phaseIndex === 0 ? 0 : demoTimeline[phaseIndex - 1][0]));
    return () => window.clearTimeout(timer);
  }, [active, demoPaused, demoPhase, isComplete, phaseIndex]);

  useLayoutEffect(() => {
    if ((active !== 'sales' && active !== 'chief') || !messageScrollRef.current) return;
    const viewport = messageScrollRef.current;
    if (prefersReducedMotion) {
      if (active === 'chief') viewport.scrollTop = viewport.scrollHeight;
      else {
        const taskMessage = viewport.querySelector<HTMLElement>('.site-demo-user-message:not(.site-demo-approval-message)');
        if (taskMessage) viewport.scrollTop += taskMessage.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 14;
      }
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, [active, demoPhase, prefersReducedMotion]);

  function pauseDemo() {
    setDemoPaused(true);
  }

  function createAgent() {
    pauseDemo();
    setNewAgentCreated(true);
    setNewAgentCreatedTime(formatCreatedAgentClock(new Date()));
    setActive('new-agent');
    setComputerOpen(false);
    setSettingsOpen(false);
    setScreenOpen(false);
    setPickerOpen(false);
  }

  function selectAgent(id: string) {
    pauseDemo();
    setActive(id);
    setComputerOpen(false);
    setSettingsOpen(false);
    setScreenOpen(false);
    setPickerOpen(false);
  }

  function openScreen() {
    pauseDemo();
    setShowCrm(true);
    setShowDraftsQueue(true);
    setScreenOpen(true);
  }

  function closeScreen() {
    if (isUserInControl) {
      continueAfterTakeover();
      return;
    }
    setScreenOpen(false);
  }

  function beginTakeover() {
    setDemoPaused(true);
    setDemoPhase('takeover');
    setScreenOpen(false);
  }

  function continueAfterTakeover() {
    setScreenOpen(false);
    setDemoPhase('computer-working');
    setDemoPaused(false);
  }

  function toggleComputer() {
    if (computerOpen) {
      setSettingsOpen(false);
      setComputerOpen(false);
      return;
    }
    setComputerOpen(true);
  }

  function closeComputer() {
    setSettingsOpen(false);
    setComputerOpen(false);
  }

  return <main className="site-demo-stage">
    <section className={`grok-demo-window ${computerOpen ? 'computer-open' : ''} ${pickerOpen ? 'picker-open' : ''}`} data-demo-phase={demoPhase} data-demo-motion={prefersReducedMotion ? 'reduced' : 'autoplay'} aria-label="Grok Bot interactive website demo">
      <div className="site-demo-titlebar">
        <div className="site-demo-titlebar-sidebar">
          <div className="site-demo-traffic" aria-hidden="true"><i /><i /><i /></div>
          <button className="site-demo-new-agent" type="button" aria-label="New agent" onClick={() => { pauseDemo(); setAgentPickerQuery(''); setPickerOpen(true); }}><PlusIcon /></button>
        </div>
        <div className="site-demo-titlebar-main">
          {pickerOpen ? <label className="site-demo-recipient-search"><span>To:</span><input aria-label="Search or create agents" autoFocus value={agentPickerQuery} onChange={event => setAgentPickerQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setPickerOpen(false); }} placeholder="Search or create agents" /></label> : <>
            <div className="site-demo-chat-name">
              {selected.id === 'sales' && !isNewAgent ? <AgentTitleMark color={isComputerWorking ? computerActiveColor : selected.color} /> : <AgentAvatar agent={isNewAgent ? newAgent : selected} size={24} />}
              <span>{displayName}</span>
            </div>
            <button className="site-demo-screen-toggle" type="button" aria-label={computerOpen ? 'Hide computer' : `Open ${displayName}'s computer`} aria-pressed={computerOpen} onClick={toggleComputer}><ScreenIcon /></button>
          </>}
        </div>
      </div>

      <div className={`site-demo-layout ${computerOpen ? 'computer-open' : ''}`}>
        <aside className={`site-demo-sidebar ${computerOpen ? 'collapsed' : ''}`} aria-label="Agents">
          {!computerOpen && <label className="site-demo-search"><SearchIcon /><input aria-label="Search agents" placeholder="Search" value={search} onChange={event => setSearch(event.target.value)} /></label>}
          <div className="site-demo-agent-list">
            {newAgentCreated && newAgent.name.toLowerCase().includes(search.toLowerCase()) && <button type="button" className={`site-demo-agent-row ${isNewAgent ? 'selected' : ''}`} aria-label="New agent" onClick={() => selectAgent('new-agent')}><AgentAvatar agent={newAgent} size={34} /><span className="site-demo-agent-copy"><span className="site-demo-agent-title">New agent</span></span><time>{newAgent.time}</time></button>}
            {agents.filter(agent => (agent.id === 'sales' ? profileName : agent.name).toLowerCase().includes(search.toLowerCase())).map(agent => <button type="button" key={agent.id} className={`site-demo-agent-row ${active === agent.id ? 'selected' : ''} ${agent.group ? 'group' : ''}`} onClick={() => selectAgent(agent.id)} aria-label={`${agent.id === 'sales' ? profileName : agent.name}${agent.preview ? `, ${agent.preview}` : ''}`}>
              {agent.group ? <span className="site-demo-avatar-stack"><AgentAvatar agent={{ ...agents[4], color: '#6464ef' }} size={20} /><AgentAvatar agent={{ ...agents[0], color: '#54b9a5' }} size={20} /><AgentAvatar agent={{ ...agents[3], color: '#895cf5' }} size={20} /></span> : <AgentAvatar agent={agent} size={34} />}
              {!computerOpen && <span className="site-demo-agent-copy"><span className="site-demo-agent-title">{agent.id === 'sales' ? profileName : agent.name}</span><span className="site-demo-agent-preview">{agent.id === 'sales' && !isComplete ? 'Typing…' : agent.preview}</span></span>}
              {!computerOpen && <time>{formatAgentTime(agent)}</time>}
            </button>)}
          </div>
          {computerOpen && <div className="site-demo-sidebar-footer">
            <button className="site-demo-footer-new-agent" type="button" aria-label="New agent" onClick={() => { pauseDemo(); setAgentPickerQuery(''); setPickerOpen(true); }}><PlusIcon /></button>
            <span className="site-demo-user-avatar" role="img" aria-label="Armand Segall">AS</span>
          </div>}
        </aside>

        <section className="site-demo-main" aria-label="Conversation">
          <div className="site-demo-message-scroll" ref={messageScrollRef}>
            {!pickerOpen && <>
            {active === 'sales' ? <>
              <div className="site-demo-chat-time">{formatClock(new Date(clockBase.getTime() - 60_000))}</div>
              <div className="site-demo-assistant-message site-demo-greeting">Hey Armand, good to meet you. What do you want me around for? Anything concrete, or more of a general sidekick?</div>
              <div className="site-demo-user-message">{taskText}</div>
              {demoPhase !== 'intro' && <div className="site-demo-system-message site-demo-animated">Renamed to Sales Outbound</div>}
              {phaseIndex >= 1 && <div className="site-demo-assistant-message site-demo-animated">Checking what's connected. Hex, Gmail, and LinkedIn are already signed in. Salesforce isn't.</div>}
              {phaseIndex >= 2 && <article className="site-demo-computer-card site-demo-animated">
                <div className="site-demo-computer-card-heading"><strong>Computer</strong><span className={`site-demo-status ${isComputerWorking ? 'working' : ''} ${isActionNeeded ? 'action-needed' : ''} ${isUserInControl ? 'taking-over' : ''}`}><i />{isActionNeeded ? 'Action needed' : isUserInControl ? "You're in control" : isComputerWorking ? 'Working' : 'Done'}</span></div>
                <p>Sign in to Salesforce so I can see the accounts you own.</p>
                <button type="button" className="site-demo-open-screen" aria-label="Open screen" onClick={isActionNeeded ? beginTakeover : openScreen}><ComputerScreen showPointer={isComputerWorking} showSalesforceLogin={isActionNeeded || isUserInControl} /></button>
                {(isActionNeeded || isUserInControl) && <div className="site-demo-computer-card-actions"><button type="button" className="site-demo-takeover-button" onClick={beginTakeover}>Take over</button><button type="button" className="site-demo-done-button" onClick={continueAfterTakeover}>I’m done</button></div>}
              </article>}
              {phaseIndex >= 6 && <div className="site-demo-result-summary site-demo-animated" aria-label="Task results">
                <p><strong>Salesforce</strong> <span>→ list pulled · 52 accounts</span></p>
                <p><strong>Hex</strong> <span>→ 3 lookalike segments pulled</span></p>
                <p><strong>LinkedIn</strong> <span>→ 4 profiles skipped · recently contacted</span></p>
                <p><strong>Sequencer</strong> <span>→ 36 drafts queued · 0 sent</span></p>
              </div>}
              {demoPhase === 'intro' && <DemoActivity label="Thinking" />}
              {phaseIndex >= 7 && <div className="site-demo-collaboration-label site-demo-animated">Messages from <span className="site-demo-inline-agent account"><AgentAvatar agent={agents[3]} size={14} />Account Manager</span> and <span className="site-demo-inline-agent chief"><AgentAvatar agent={agents[0]} size={14} />Chief</span></div>}
              {phaseIndex >= 7 && <div className="site-demo-assistant-message site-demo-collaboration-message site-demo-animated"><span className="site-demo-inline-agent account"><AgentAvatar agent={agents[3]} size={14} />Account Manager</span> sent over the Acme + Globex threads and <span className="site-demo-inline-agent chief"><AgentAvatar agent={agents[0]} size={14} />Chief</span> flagged the priority accounts. Both are folded into tonight's list.</div>}
              {phaseIndex >= 7 && <div className="site-demo-assistant-message site-demo-followup-message site-demo-animated">The 36 drafts are sitting in the LinkedIn queue on my screen: recipient, opener, and a Draft badge on each. Nothing goes out until you've had a look.</div>}
              {phaseIndex >= 8 && <div className="site-demo-approval-wrap site-demo-animated"><div className="site-demo-user-message site-demo-approval-message">The top 10 look good. Send it. Run this every week.</div><button type="button" className="site-demo-message-reaction" aria-label="Thumbs up reaction">👍</button></div>}
              {isComplete && <><div className="site-demo-system-message site-demo-routine-created site-demo-animated">Created routine <span><i aria-hidden="true">◷</i> Overnight outbound</span></div><div className="site-demo-assistant-message site-demo-done-message site-demo-animated">Done.</div></>}
            </> : active === 'chief' ? <>
              <div className="site-demo-chat-time">10月22日 23:25</div>
              <div className="site-demo-system-message site-demo-routine-created site-demo-animated">Created routine <span><i aria-hidden="true">◷</i> Morning briefing</span></div>
              <div className="site-demo-chat-time">Yesterday 23:25</div>
              <div className="site-demo-assistant-message site-demo-chief-briefing">morning briefing:{'\n'}✓ Calendar → 2pm double-booking resolved · board review kept{'\n'}✓ Deck → numbers checked against finance's sheet · 2 stale slides flagged{'\n'}✓ Offsite → 3 venues shortlisted · dates held on each{'\n\n'}two things need you today: the deck review at 2pm, and a yes/no on the venue. everything else is handled.</div>
              <div className="site-demo-chat-time">2:25</div>
              <div className="site-demo-user-message site-demo-chief-user-message">take the venue, i'll do the deck</div>
              <div className="site-demo-assistant-message site-demo-chief-reply">the marina house is the pick: seats all 40, the mid-week rate came in 15% under budget, and they'll hold the date until tomorrow.</div>
              <div className="site-demo-chat-time">3:25</div>
              <div className="site-demo-approval-wrap site-demo-chief-approval-wrap site-demo-animated"><div className="site-demo-user-message site-demo-approval-message">book it</div><button type="button" className="site-demo-message-reaction" aria-label="Thumbs up reaction">👍</button></div>
              <div className="site-demo-chief-results">✓ Venue → marina house booked · deposit paid{'\n'}✓ Calendar → invites updated for all 40{'\n'}✓ Holds → other two released with a thank-you</div>
              <div className="site-demo-assistant-message site-demo-chief-reply">booked the venue and sent the confirmation around. you're clear until the 2pm deck review.</div>
            </> : isNewAgent ? null : <div className="site-demo-empty-chat"><AgentAvatar agent={selected} size={50} /><span>Message {selected.name}</span></div>}
            </>}
          </div>
          <form className="site-demo-composer" onSubmit={event => event.preventDefault()}><button type="button" aria-label="Add attachment"><PlusIcon /></button><input aria-label={`Message ${pickerOpen ? 'agent' : displayName}`} placeholder={`Message ${pickerOpen ? 'agent' : displayName}`} /><button className="site-demo-voice-message" type="button" aria-label="Voice message"><VoiceMessageIcon /></button></form>
        </section>

        {computerOpen && <aside className="site-demo-computer-panel" aria-label={settingsOpen ? `${displayName} settings` : 'Computer and routines'}>
          <div className={`site-demo-panel-header ${settingsOpen ? 'settings' : ''}`}>
            {settingsOpen ? <><button type="button" aria-label="Back to computer" onClick={() => setSettingsOpen(false)}><BackIcon /></button><h2>Settings</h2><button type="button" aria-label="Close computer" onClick={closeComputer}>×</button></> : <><span /><div className="site-demo-panel-actions"><button type="button" aria-label="Agent settings" onClick={() => setSettingsOpen(true)}><GearIcon /></button><button type="button" aria-label="Close computer" onClick={closeComputer}>×</button></div></>}
          </div>
          {settingsOpen ? <div className="site-demo-profile-settings">
            <div className="site-demo-profile-avatar"><AgentAvatar agent={{ ...selected, name: displayName }} size={72} smooth /></div>
            <label>Name<input aria-label="Name" value={selected.id === 'sales' ? profileName : selected.name} onChange={event => selected.id === 'sales' && setProfileName(event.target.value)} /></label>
            <label>Title (optional)<input aria-label="Title (optional)" value={selected.id === 'sales' ? profileTitle : ''} onChange={event => selected.id === 'sales' && setProfileTitle(event.target.value)} /></label>
            <label>Description<textarea aria-label="Description" value={selected.id === 'sales' ? profileDescription : ''} onChange={event => selected.id === 'sales' && setProfileDescription(event.target.value)} /></label>
            <button type="button" role="switch" aria-label="Notifications" aria-checked={notificationsEnabled} className={`site-demo-notifications ${notificationsEnabled ? 'enabled' : ''}`} onClick={() => setNotificationsEnabled(value => !value)}>
              <span className="site-demo-notifications-copy"><strong>Notifications</strong><small>Get notified when this agent finishes or needs input</small></span><i aria-hidden="true" />
            </button>
          </div> : <>
            <button type="button" className="site-demo-panel-screen" aria-label="Open screen" onClick={openScreen}><ComputerScreen /></button>
            <div className="site-demo-screen-caption">{displayName}’s screen</div>
            {!isNewAgent && <><div className="site-demo-routines-title">Routines</div><div className="site-demo-routine" role="listitem"><ClockIcon /><strong>Overnight outbound</strong><small>Sundays at 11:00 PM</small></div></>}
          </>}
        </aside>}
      </div>

      {pickerOpen && <NewAgentPicker query={agentPickerQuery} create={createAgent} select={selectAgent} />}
      {showScreenOverlay && <div className="site-demo-screen-overlay" role="dialog" aria-label={isUserInControl ? 'Salesforce computer takeover' : `${displayName} computer screen`}>
        {isUserInControl ? <div className="site-demo-takeover-dialog">
          <div className="site-demo-takeover-header"><strong>Sign into Salesforce</strong><button type="button" onClick={continueAfterTakeover}>I’m done, continue</button></div>
          <div className="site-demo-large-desktop"><ComputerScreen large showCrm={false} showDraftsQueue={false} showSalesforceLogin showHumanPointer /><ComputerAppDock showCrm={true} showDraftsQueue={false} toggleCrm={() => {}} toggleDraftsQueue={() => {}} loginOnly /></div>
        </div> : <><button type="button" className="site-demo-close-screen" aria-label="Close screen" onClick={closeScreen}>×</button>
          <div className="site-demo-large-desktop">
            <ComputerScreen large showCrm={showCrm} showDraftsQueue={showDraftsQueue} showPointer={isComputerWorking} />
            <ComputerAppDock showCrm={showCrm} showDraftsQueue={showDraftsQueue} toggleCrm={() => setShowCrm(value => !value)} toggleDraftsQueue={() => setShowDraftsQueue(value => !value)} />
          </div>
        </>}
      </div>}
    </section>
  </main>;
}
