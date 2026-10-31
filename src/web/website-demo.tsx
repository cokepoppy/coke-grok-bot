import React, { useState } from 'react';
import { avatarPaths } from './avatar-paths';
import './website-demo.css';

type Agent = { id: string; name: string; color: string; shape: keyof typeof avatarPaths; preview: string; time: string; unread?: boolean; group?: boolean };

const agents: Agent[] = [
  { id: 'chief', name: 'Chief', color: '#50b9a8', shape: 'round', preview: 'booked the venue and sent the c...', time: 'Yesterday' },
  { id: 'sales', name: 'Sales Outbound', color: '#f59d32', shape: 'round', preview: 'Done.', time: '16:35' },
  { id: 'inbox', name: 'Inbox Manager', color: '#6659ed', shape: 'drop', preview: 'sent. inbox at zero, 5 drafts park...', time: '13:34', unread: true },
  { id: 'account', name: 'Account Manager', color: '#895af2', shape: 'round', preview: "invite's out to vicky, globex note ...", time: '11:34' },
  { id: 'talent', name: 'Talent Scout', color: '#3e7ff1', shape: 'round', preview: '3 intros drafted in your voice, hel...', time: '8:34' },
  { id: 'expense', name: 'Expense Manager', color: '#f4772a', shape: 'round', preview: 'report filed. 9 receipts, nothing o...', time: '12:34' },
  { id: 'offsite', name: 'Offsite crew', color: '#52bca9', shape: 'round', preview: "that leaves the pipeline. i'd spin ...", time: '10:34', group: true },
];

const taskText = 'Overnight pipeline generation and outbound.\n\nPick eligible prospects from this Google Sheet, research them on the web, grab context on contacts and accounts from Hex, Sumble, and Salesforce. Draft email and LinkedIn sequences in my voice.';

function AgentAvatar({ agent, size = 30 }: { agent: Agent; size?: number }) {
  const path = avatarPaths[agent.shape] || avatarPaths.round;
  return <svg className="site-demo-avatar" width={size} height={size} viewBox="0 0 54 54" aria-hidden="true">
    <path d={path} fill={agent.color} />
    <g fill="#fff" transform="rotate(-24 33 21)"><rect x="25" y="16" width="4" height="10" rx="2" /><rect x="37" y="16" width="4" height="10" rx="2" /></g>
    {('unread' in agent && agent.unread) && <circle cx="44" cy="11" r="8" fill="#ff4548" stroke="#fff" strokeWidth="2" />}
  </svg>;
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg>;
}

function ScreenIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="1.5" /><path d="M12 17v3M8 20h8" /></svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.2" /><path d="m15.2 15.2 4.4 4.4" /></svg>;
}

function Waveform() {
  return <div className="site-demo-waveform" aria-hidden="true">{[4, 6, 9, 12, 8, 14, 10, 6, 12, 15, 9, 5, 11, 14, 8, 5].map((height, index) => <i key={index} style={{ '--bar-height': `${height}px`, '--bar-delay': `${index * 45}ms` } as React.CSSProperties} />)}</div>;
}

function ComputerScreen({ large = false, showCrm = true, showDraftsQueue = true }: { large?: boolean; showCrm?: boolean; showDraftsQueue?: boolean }) {
  return <div className={`site-demo-desktop ${large ? 'large' : ''}`} aria-label="Example computer screen">
    <div className="site-demo-mountain" />
    {showCrm && <div className="site-demo-window-back">
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
    {showDraftsQueue && <div className="site-demo-window-front">
      <div className="site-demo-window-controls"><i /><i /><i /><span className="site-demo-window-title-placeholder" /></div>
      <div className="site-demo-mini-title"><span>Outreach queue</span><i /></div>
      {[['Priya Natarajan', '82%'], ['Marcus Webb', '64%'], ['Elena Sørensen', '74%'], ['Daniel Alvarez', '58%']].map(([name, lineWidth]) => <div className="site-demo-contact" key={name}><b /><span className="site-demo-contact-copy"><span>{name}</span><i style={{ width: lineWidth }} /></span><small>Draft</small></div>)}
      <div className="site-demo-queue-foot"><span>36 drafts queued</span><span>0 sent</span></div>
    </div>}
  </div>;
}

function ComputerAppDock({ showCrm, showDraftsQueue, toggleCrm, toggleDraftsQueue }: { showCrm: boolean; showDraftsQueue: boolean; toggleCrm: () => void; toggleDraftsQueue: () => void }) {
  return <div className="site-demo-app-dock" role="toolbar" aria-label="Applications">
    <button type="button" aria-label={`${showCrm ? 'Hide' : 'Show'} CRM portal`} aria-pressed={showCrm} onClick={toggleCrm}>
      <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" /><circle className="site-demo-compass-ring" cx="20" cy="20" r="12.5" /><path className="site-demo-compass-needle" d="m25.8 13.8-4.4 9-7.2 3.4 3.6-7.4z" /></svg>
    </button>
    <button type="button" aria-label={`${showDraftsQueue ? 'Hide' : 'Show'} Drafts queue`} aria-pressed={showDraftsQueue} onClick={toggleDraftsQueue}>
      <svg viewBox="0 0 40 40" aria-hidden="true"><rect x="3" y="3" width="34" height="34" rx="9" /><path className="site-demo-mail" d="m8 13 12 9 12-9M8 13v14h24V13" /></svg>
    </button>
  </div>;
}

function NewAgentPicker({ close, create, select }: { close: () => void; create: () => void; select: (id: string) => void }) {
  const [query, setQuery] = useState('');
  return <div className="site-demo-picker" role="dialog" aria-label="Search or create agents">
    <div className="site-demo-picker-head"><span>To:</span><input aria-label="Search or create agents" autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search or create agents" /><button type="button" aria-label="Close agent picker" onClick={close}>×</button></div>
    <button type="button" className="site-demo-picker-option" onClick={create}><span className="site-demo-picker-plus"><PlusIcon /></span>Create new agent</button>
    {agents.filter(agent => agent.name.toLowerCase().includes(query.toLowerCase())).map(agent => <button type="button" key={agent.id} className="site-demo-picker-option" onClick={() => select(agent.id)}><AgentAvatar agent={agent} size={27} />{agent.name}</button>)}
  </div>;
}

export function WebsiteDemoApp() {
  const [active, setActive] = useState('sales');
  const [computerOpen, setComputerOpen] = useState(false);
  const [screenOpen, setScreenOpen] = useState(false);
  const [showCrm, setShowCrm] = useState(true);
  const [showDraftsQueue, setShowDraftsQueue] = useState(true);
  const [screenResultsVisible, setScreenResultsVisible] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [newAgentCreated, setNewAgentCreated] = useState(false);
  const isNewAgent = active === 'new-agent';
  const selected = agents.find(agent => agent.id === active) || agents[1];
  const newAgent: Agent = { id: 'new-agent', name: 'New agent', color: '#895af2', shape: 'round', preview: '', time: '' };

  function createAgent() {
    setNewAgentCreated(true);
    setActive('new-agent');
    setComputerOpen(false);
    setScreenOpen(false);
    setPickerOpen(false);
  }

  function selectAgent(id: string) {
    setActive(id);
    setComputerOpen(false);
    setScreenOpen(false);
    setPickerOpen(false);
  }

  function openScreen() {
    setShowCrm(true);
    setShowDraftsQueue(true);
    setScreenOpen(true);
  }

  return <main className="site-demo-stage">
    <section className={`grok-demo-window ${computerOpen ? 'computer-open' : ''}`} aria-label="Grok Bot interactive website demo">
      <div className="site-demo-titlebar">
        <div className="site-demo-titlebar-sidebar">
          <div className="site-demo-traffic" aria-hidden="true"><i /><i /><i /></div>
          <button className="site-demo-new-agent" type="button" aria-label="New agent" onClick={() => setPickerOpen(true)}><PlusIcon /></button>
        </div>
        <div className="site-demo-titlebar-main">
          <div className="site-demo-chat-name">
            {!isNewAgent && <AgentAvatar agent={selected} size={24} />}
            <span>{isNewAgent ? 'New agent' : selected.name}</span>
          </div>
          <button className="site-demo-screen-toggle" type="button" aria-label={computerOpen ? 'Hide computer' : `Open ${isNewAgent ? 'New agent' : selected.name}'s computer`} aria-pressed={computerOpen} onClick={() => setComputerOpen(value => !value)}><ScreenIcon /></button>
        </div>
      </div>

      <div className={`site-demo-layout ${computerOpen ? 'computer-open' : ''}`}>
        <aside className={`site-demo-sidebar ${computerOpen ? 'collapsed' : ''}`} aria-label="Agents">
          {!computerOpen && <label className="site-demo-search"><SearchIcon /><input aria-label="Search agents" placeholder="Search" value={search} onChange={event => setSearch(event.target.value)} /></label>}
          <div className="site-demo-agent-list">
            {agents.filter(agent => agent.name.toLowerCase().includes(search.toLowerCase())).map(agent => <button type="button" key={agent.id} className={`site-demo-agent-row ${active === agent.id ? 'selected' : ''} ${agent.group ? 'group' : ''}`} onClick={() => selectAgent(agent.id)} aria-label={`${agent.name}${agent.preview ? `, ${agent.preview}` : ''}`}>
              {agent.group ? <span className="site-demo-avatar-stack"><AgentAvatar agent={{ ...agents[0], color: '#50b9a8' }} size={20} /><AgentAvatar agent={{ ...agents[4], color: '#6659ed' }} size={20} /><AgentAvatar agent={{ ...agents[3], color: '#895af2' }} size={20} /></span> : <AgentAvatar agent={agent} size={34} />}
              {!computerOpen && <span className="site-demo-agent-copy"><span className="site-demo-agent-title">{agent.name}</span><span className="site-demo-agent-preview">{agent.preview}</span></span>}
              {!computerOpen && <time>{agent.time}</time>}
            </button>)}
            {newAgentCreated && newAgent.name.toLowerCase().includes(search.toLowerCase()) && <button type="button" className={`site-demo-agent-row ${isNewAgent ? 'selected' : ''}`} aria-label="New agent" onClick={() => selectAgent('new-agent')}><AgentAvatar agent={newAgent} size={34} /><span className="site-demo-agent-copy"><span className="site-demo-agent-title">New agent</span></span></button>}
          </div>
        </aside>

        <section className="site-demo-main" aria-label="Conversation">
          <div className="site-demo-message-scroll">
            {active === 'sales' ? <>
              <div className="site-demo-user-message">{taskText}</div>
              <div className="site-demo-system-message">Renamed to Sales Outbound</div>
              <div className="site-demo-assistant-message">Checking what's connected. Hex, Gmail, and LinkedIn are already signed in. Salesforce isn't.</div>
              <article className="site-demo-computer-card">
                <div className="site-demo-computer-card-heading"><strong>Computer</strong><span><i />Done</span></div>
                <p>Sign in to Salesforce so I can see the accounts you own.</p>
                <button type="button" className="site-demo-open-screen" aria-label="Open screen" onClick={openScreen}><ComputerScreen /></button>
              </article>
              {screenResultsVisible && <div className="site-demo-result-summary" aria-label="Task results">
                <p>Salesforce <span>list pulled · 52 accounts</span></p>
                <p>Hex <span>3 lookalike segments</span></p>
                <p>LinkedIn <span>4 profiles skipped</span></p>
                <p>Sequencer <span>36 drafts queued · 0 sent</span></p>
              </div>}
            </> : active === 'new-agent' ? <div className="site-demo-empty-chat"><AgentAvatar agent={{ ...agents[2], name: 'New agent' }} size={50} /><span>Message New agent</span></div> : <div className="site-demo-empty-chat"><AgentAvatar agent={selected} size={50} /><span>Message {selected.name}</span></div>}
          </div>
          <form className="site-demo-composer" onSubmit={event => event.preventDefault()}><button type="button" aria-label="Add attachment"><PlusIcon /></button><input aria-label={`Message ${isNewAgent ? 'New agent' : selected.name}`} placeholder={`Message ${isNewAgent ? 'New agent' : selected.name}`} /><button type="button" aria-label="Voice input"><span className="site-demo-mic">●</span></button><button type="button" aria-label="Start voice chat"><span className="site-demo-sound">▮▮▮</span></button></form>
        </section>

        {computerOpen && <aside className="site-demo-computer-panel" aria-label="Computer and routines">
          <div className="site-demo-panel-label">Computer</div><button type="button" className="site-demo-panel-screen" aria-label="Open screen" onClick={openScreen}><ComputerScreen /></button>
          {!isNewAgent && <><div className="site-demo-routines-title">Routines</div><button type="button" className="site-demo-routine"><span>Overnight outbound</span><small>Every day</small></button></>}
        </aside>}
      </div>

      <Waveform />
      {pickerOpen && <NewAgentPicker close={() => setPickerOpen(false)} create={createAgent} select={selectAgent} />}
      {screenOpen && <div className="site-demo-screen-overlay" role="dialog" aria-label={`${isNewAgent ? 'New agent' : selected.name} computer screen`}>
        <button type="button" className="site-demo-close-screen" aria-label="Close screen" onClick={() => { setScreenOpen(false); setScreenResultsVisible(true); }}>×</button>
        <div className="site-demo-large-desktop">
          <ComputerScreen large showCrm={showCrm} showDraftsQueue={showDraftsQueue} />
          <ComputerAppDock showCrm={showCrm} showDraftsQueue={showDraftsQueue} toggleCrm={() => setShowCrm(value => !value)} toggleDraftsQueue={() => setShowDraftsQueue(value => !value)} />
        </div>
      </div>}
    </section>
  </main>;
}
