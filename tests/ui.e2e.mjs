import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

const progress = message => { if (process.env.E2E_PROGRESS === '1') console.log(`[ui-e2e] ${message}`); };

const server = createServer();
await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
child.stdout.on('data', chunk => { serverLog += chunk; });
child.stderr.on('data', chunk => { serverLog += chunk; });
const base = `http://127.0.0.1:${port}`;
let browser;
let authChild;
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Vite exited early: ${serverLog}`);
    try { const response = await fetch(base); if (response.ok) break; } catch { /* Wait for local server. */ }
    if (attempt === 79) throw new Error(`Vite did not start: ${serverLog}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1584, height: 994 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  progress('browser started');
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByText('Local UI preview: data is stored only in this browser.', { exact: false }).waitFor();
  assert.equal(await page.locator('.bot-row').count(), 1);
  await page.keyboard.press('Control+N');
  assert.equal(await page.getByRole('dialog', { name: 'Create New Bot' }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name: 'Create', exact: true }).isDisabled(), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.getByRole('button', { name: 'Close create Bot' }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Close create Bot' }).evaluate(element => element === document.activeElement), true);
  await page.getByLabel('Name your Bot').press('Escape');
  assert.equal(await page.getByRole('button', { name: 'New chat' }).evaluate(element => element === document.activeElement), true);
  await page.getByRole('button', { name: 'New chat' }).click();
  assert.equal(await page.locator('.create-shapes button').count(), 13);
  assert.equal(await page.locator('.create-colors button').count(), 11);
  await mkdir('artifacts/ui', { recursive: true });
  await page.getByRole('dialog', { name: 'Create New Bot' }).screenshot({ path: 'artifacts/ui/create-bot.png' });
  await page.getByLabel('Name your Bot').fill('New Bot');
  await page.getByRole('button', { name: 'Create shape heart' }).click();
  await page.getByRole('button', { name: 'Create color #1e86fc' }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  assert.equal(await page.locator('.bot-row').count(), 2);
  assert.equal(await page.locator('.bot-row.selected .avatar path').first().getAttribute('fill'), '#1e86fc');
  await page.locator('.bot-row').nth(1).click({ button: 'right' });
  const botMenu = page.getByRole('menu', { name: 'Bot actions' });
  assert.equal(await botMenu.getByRole('menuitem', { name: 'Pin' }).isEnabled(), true);
  await mkdir('artifacts/ui', { recursive: true });
  await botMenu.screenshot({ path: 'artifacts/ui/sidebar-bot-menu.png' });
  await botMenu.getByRole('menuitem', { name: 'Rename Bot' }).click();
  await page.getByLabel('Rename Bot').fill('Other Local');
  await page.getByLabel('Rename Bot').press('Enter');
  assert.equal(await page.locator('.bot-row').nth(1).getByText('Other Local').count(), 1);
  assert.equal(await page.locator('.bot-row.selected').getByText('New Bot').count(), 1);
  await page.locator('.bot-row').filter({ hasText: 'Other Local' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  assert.equal(await page.locator('.bot-row').first().getByText('Other Local').count(), 1);
  await page.locator('.bot-row').filter({ hasText: 'Other Local' }).click({ button: 'right' });
  assert.equal(await page.getByRole('menuitem', { name: 'Unpin' }).isVisible(), true);
  await page.getByRole('menuitem', { name: 'Hide from sidebar' }).click();
  assert.equal(await page.locator('.bot-row').filter({ hasText: 'Other Local' }).count(), 0);
  await page.getByRole('button', { name: /Hidden Bots/ }).click();
  await page.locator('.bot-row').filter({ hasText: 'Other Local' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Show in sidebar' }).click();
  assert.equal(await page.locator('.bot-row').first().getByText('Other Local').count(), 1);
  await page.locator('.bot-row.selected .bot-row-title > span').dblclick();
  await page.getByLabel('Rename Bot').fill('Cancelled');
  await page.getByLabel('Rename Bot').press('Escape');
  assert.equal(await page.locator('.bot-row.selected').getByText('New Bot').count(), 1);
  await page.locator('.bot-row.selected .bot-row-title > span').dblclick();
  await page.getByLabel('Rename Bot').fill('Temp name');
  await page.getByLabel('Rename Bot').press('Enter');
  assert.equal(await page.locator('.chat-title').getByText('Temp name').count(), 1);
  await page.getByRole('button', { name: 'Show bot details' }).click();
  await page.getByLabel('Bot name').fill('Local Research');
  await page.getByLabel('Bot label').fill('analyst');
  await page.getByLabel('Bot label').press('Enter');
  assert.equal(await page.locator('.bot-row.selected').getByText('analyst').count(), 1);
  await page.getByRole('button', { name: 'Change Bot picture' }).click();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.getByRole('button', { name: 'Color #959595' }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Bot', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: 'Change Bot picture' }).evaluate(element => element === document.activeElement), true);
  await page.getByRole('button', { name: 'Change Bot picture' }).click();
  assert.equal(await page.locator('.avatar-shapes button').count(), 8);
  assert.equal(await page.locator('.avatar-colors button').count(), 11);
  await page.getByRole('button', { name: 'Shape square' }).click();
  await page.getByRole('button', { name: 'Color #959595' }).click();
  await mkdir('artifacts/ui', { recursive: true });
  await page.locator('.avatar-dialog').screenshot({ path: 'artifacts/ui/avatar-picker.png' });
  await page.getByRole('button', { name: 'Shape triangle' }).click();
  await page.getByRole('button', { name: 'Color #1cc3b0' }).click();
  await page.getByRole('button', { name: 'Color #1cc3b0' }).press('Escape');
  assert.equal(await page.getByRole('button', { name: 'Change Bot picture' }).evaluate(element => element === document.activeElement), true);
  assert.equal(await page.locator('.bot-row.selected .avatar path').first().getAttribute('fill'), '#1cc3b0');
  await page.getByRole('button', { name: 'Hide bot details' }).click();
  await page.getByLabel('Message Local Research').fill('Local-only test message');
  await page.getByRole('button', { name: 'Save local message' }).click();
  await page.getByText('No message was sent to an Agent', { exact: false }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('.bot-row.selected').getByText('analyst').count(), 1);
  assert.equal(await page.locator('.bot-row.selected .avatar path').first().getAttribute('fill'), '#1cc3b0');
  assert.equal(await page.locator('.conversation').getByText('Local-only test message', { exact: true }).count(), 1);
  assert.equal(await page.locator('.bot-row').first().getByText('Other Local').count(), 1);
  await page.locator('.bot-row.selected').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hide from sidebar' }).click();
  assert.equal(await page.locator('.conversation').getByText('Local-only test message', { exact: true }).count(), 1);
  await page.getByRole('button', { name: /Hidden Bots/ }).click();
  await page.locator('.bot-row').filter({ hasText: 'Local Research' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Show in sidebar' }).click();
  assert.equal(await page.locator('.conversation').getByText('Local-only test message', { exact: true }).count(), 1);
  await page.getByRole('button', { name: /Other Local.*Ready for a conversation/ }).click();
  assert.equal(await page.locator('.conversation').getByText('Local-only test message', { exact: true }).count(), 0);
  const second = await browser.newContext({ viewport: { width: 1584, height: 994 } });
  const secondPage = await second.newPage();
  await secondPage.goto(base, { waitUntil: 'networkidle' });
  assert.equal(await secondPage.locator('.bot-row').count(), 1);
  assert.equal(await secondPage.getByText('Local-only test message', { exact: true }).count(), 0);
  await second.close();
  const narrow = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const narrowPage = await narrow.newPage();
  narrowPage.on('pageerror', error => errors.push(error.message));
  await narrowPage.goto(base, { waitUntil: 'networkidle' });
  const noticeBox = await narrowPage.locator('.preview-notice').boundingBox();
  const titleBox = await narrowPage.locator('.chat-title').boundingBox();
  const composerBox = await narrowPage.locator('.composer').boundingBox();
  assert.ok(noticeBox && titleBox && composerBox);
  assert.ok(noticeBox.y >= titleBox.y + titleBox.height, 'Preview notice overlaps the chat title');
  assert.ok(composerBox.x >= 0 && composerBox.x + composerBox.width <= 390 && composerBox.y + composerBox.height <= 844, 'Composer is outside the viewport');
  await narrow.close();
  const authPortServer = createServer();
  await new Promise((resolve, reject) => authPortServer.listen(0, '127.0.0.1', resolve).once('error', reject));
  const authPort = authPortServer.address().port;
  await new Promise(resolve => authPortServer.close(resolve));
  authChild = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(authPort), '--strictPort'], {
    env: { ...process.env, VITE_REQUIRE_AUTH: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let authServerLog = '';
  authChild.stdout.on('data', chunk => { authServerLog += chunk; });
  authChild.stderr.on('data', chunk => { authServerLog += chunk; });
  const authBase = `http://127.0.0.1:${authPort}`;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (authChild.exitCode !== null) throw new Error(`Authenticated Vite exited early: ${authServerLog}`);
    try { const response = await fetch(authBase); if (response.ok) break; } catch { /* Wait for local server. */ }
    if (attempt === 79) throw new Error(`Authenticated Vite did not start: ${authServerLog}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const productShellContext = await browser.newContext({ viewport: { width: 995, height: 675 }, deviceScaleFactor: 2 });
  const productShellPage = await productShellContext.newPage();
  productShellPage.on('pageerror', error => errors.push(error.message));
  const demoAccount = { userId: 'visual-user', tenantId: 'visual-tenant', email: 'visual@example.test', name: 'Armand Segall', role: 'owner' };
  const referenceActivity = new Date();
  referenceActivity.setHours(15, 33, 0, 0);
  const yesterdayActivity = new Date(referenceActivity.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const demoBot = { id: 'sales-outbound', name: 'Sales Outbound', label: 'Sales', color: '#f19d39', shape: 'round', group: 'Unassigned', pinned: false, hidden: false, preview: 'Done.', lastActivityAt: referenceActivity.toISOString() };
  const demoBots = [
    { id: 'chief', name: 'Chief', label: '', color: '#50b8a6', shape: 'round', group: 'Unassigned', pinned: true, hidden: false, preview: 'booked the venue and sent the c…', lastActivityAt: yesterdayActivity },
    demoBot,
    { id: 'inbox-manager', name: 'Inbox Manager', label: '', color: '#6259e7', shape: 'hex', group: 'Unassigned', pinned: false, hidden: false, preview: 'sent. inbox at zero, 5 drafts park…', lastActivityAt: new Date(referenceActivity.getFullYear(), referenceActivity.getMonth(), referenceActivity.getDate(), 12, 33).toISOString() },
    { id: 'account-manager', name: 'Account Manager', label: '', color: '#8a55f0', shape: 'round', group: 'Unassigned', pinned: false, hidden: false, preview: "invite's out to vicky. globex note …", lastActivityAt: new Date(referenceActivity.getFullYear(), referenceActivity.getMonth(), referenceActivity.getDate(), 10, 33).toISOString() },
    { id: 'talent-scout', name: 'Talent Scout', label: '', color: '#3e83f5', shape: 'round', group: 'Unassigned', pinned: false, hidden: false, preview: '3 intros drafted in your voice, hel…', lastActivityAt: new Date(referenceActivity.getFullYear(), referenceActivity.getMonth(), referenceActivity.getDate(), 7, 33).toISOString() },
    { id: 'expense-manager', name: 'Expense Manager', label: '', color: '#ef6e2d', shape: 'round', group: 'Unassigned', pinned: false, hidden: false, preview: 'report filed. 9 receipts, nothing o…', lastActivityAt: new Date(referenceActivity.getFullYear(), referenceActivity.getMonth(), referenceActivity.getDate(), 11, 33).toISOString() },
  ];
  const demoGroups = [{
    id: 'offsite-crew', name: 'Offsite crew', preview: "that leaves the pipeline. i'd spin …", lastActivityAt: new Date(referenceActivity.getFullYear(), referenceActivity.getMonth(), referenceActivity.getDate(), 9, 33).toISOString(),
    members: [
      { id: 'chief', name: 'Chief', label: '', color: '#50b8a6', shape: 'round', position: 0 },
      { id: 'account-manager', name: 'Account Manager', label: '', color: '#8a55f0', shape: 'round', position: 1 },
      { id: 'talent-scout', name: 'Talent Scout', label: '', color: '#3e83f5', shape: 'round', position: 2 },
    ],
  }];
  const demoRuns = [
    { id: 'outbound-run', prompt: 'Overnight pipeline generation and outbound.\n\nPick eligible prospects from this Google Sheet, research them on the web, grab context on contacts and accounts from Hex, Sumble, and Salesforce. Draft email and LinkedIn sequences in my voice.', status: 'completed', result: "Checking what's connected. Hex, Gmail, and LinkedIn are already signed in. Salesforce isn't.", recoveryState: 'none', replacementRunId: null, computerUsed: false, createdAt: new Date(referenceActivity.getTime() - 15000).toISOString(), updatedAt: new Date(referenceActivity.getTime() + 1000).toISOString(), files: [] },
    { id: 'live-computer-run', prompt: 'Sign in to Salesforce so I can see the accounts you own.', status: 'completed', result: 'Done.', recoveryState: 'none', replacementRunId: null, computerUsed: true, createdAt: new Date(referenceActivity.getTime() + 2000).toISOString(), updatedAt: new Date(referenceActivity.getTime() + 3000).toISOString(), files: [] },
  ];
  let postedMentionBody = null;
  const demoMessages = [
    { id: 'welcome-message', role: 'bot', text: 'Hey Armand, good to meet you. What do you want me around for? Anything concrete, or more of a general sidekick?', createdAt: new Date(referenceActivity.getTime() - 60000).toISOString() },
    { id: 'rename-event', role: 'system', text: 'Renamed to Sales Outbound', createdAt: referenceActivity.toISOString() },
  ];
  const demoRoutines = [{ id:'official-routine',botId:'sales-outbound',requestId:'official-routine-request',name:'Overnight outbound',instruction:'Prepare outbound drafts for review.',schedule:{kind:'weekly',weekday:0,hour:23,minute:0},timezone:'UTC',paused:false,when:'Sundays at 11:00 PM',nextRunAt:new Date(Date.now()+86_400_000).toISOString(),runs:[] }];
  // Crop from the user-provided public x.ai/bot screenshot; this fixture is only used for visual UI tests.
  const demoScreenBytes = await readFile(new URL('./fixtures/official-grok-bot-computer-preview.png', import.meta.url));
  await productShellPage.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const routineCollection = '/api/bots/sales-outbound/routines';
    if (path.endsWith(routineCollection)) {
      if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ routines: demoRoutines }) });
    }
    if (path.startsWith(`${routineCollection}/`)) {
      const testRun = path.endsWith('/test');
      const routineId = path.slice(routineCollection.length + 1).replace(/\/test$/, '');
      const index = demoRoutines.findIndex(routine => routine.id === routineId);
      if (index < 0) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
      if (testRun && route.request().method() === 'POST') {
        const run = { id: 'routine-run-e2e', status: 'queued', scheduledFor: new Date().toISOString(), result: null };
        demoRoutines[index].runs.unshift(run);
        return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run }) });
      }
      if (route.request().method() === 'PATCH') {
        demoRoutines[index].paused = route.request().postDataJSON().paused;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ routine: demoRoutines[index] }) });
      }
      if (route.request().method() === 'DELETE') {
        demoRoutines.splice(index, 1);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      }
    }
    if (path === '/api/bots/sales-outbound' && route.request().method() === 'PATCH') {
      const name = String(route.request().postDataJSON().name || '');
      const event = name !== demoBot.name ? { id: `rename-${Date.now()}`, role: 'system', text: `Renamed to ${name}`, createdAt: new Date().toISOString() } : undefined;
      demoBot.name = name;
      if (event) demoMessages.push(event);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...(event ? { event } : {}) }) });
    }
    if (path === '/api/bots/sales-outbound/runs' && route.request().method() === 'POST') {
      postedMentionBody = route.request().postDataJSON();
      const run = { id:'mentioned-bot-run', prompt:postedMentionBody.prompt, status:'queued', result:null, recoveryState:'none', replacementRunId:null, computerUsed:false, files:[] };
      demoRuns.push(run);
      return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({run}) });
    }
    if (path.endsWith('/api/bots/sales-outbound/computer/screenshot')) return route.fulfill({ status: 200, contentType: 'image/png', body: demoScreenBytes });
    if (path.endsWith('/api/bots/sales-outbound/computer')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ owner: 'agent' }) });
    const data = path.endsWith('/api/auth/me') ? demoAccount
      : path.endsWith('/api/auth/features') ? { agent: true, engine: 'dsh' }
        : path.endsWith('/api/groups') ? { groups: demoGroups }
        : path.endsWith('/api/bots') ? { bots: demoBots }
          : path.endsWith('/api/bots/sales-outbound/messages') ? { messages: demoMessages }
            : path.endsWith('/api/bots/sales-outbound/runs') ? { runs: demoRuns }
              : path.includes('/approvals') ? { approvals: [] }
                : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await productShellPage.addInitScript(({ storageKey, state }) => localStorage.setItem(storageKey, JSON.stringify(state)), {
    storageKey: 'coke-grok-bot:desktop-preview:v1:visual-tenant:visual-user:server-chat-v1',
    state: { bots: [demoBot], activeId: demoBot.id, messages: {}, showOnboarding: {} },
  });
  await productShellPage.goto(authBase, { waitUntil: 'networkidle' });
  await productShellPage.getByText('Hey Armand, good to meet you.', { exact: false }).waitFor();
  await productShellPage.getByText('Overnight pipeline generation and outbound.', { exact: false }).waitFor();
  const appBox = await productShellPage.locator('.app.product-shell').boundingBox();
  const sidebarBox = await productShellPage.locator('.sidebar').boundingBox();
  const productComposerBox = await productShellPage.locator('.composer').boundingBox();
  assert.deepEqual(appBox && { x: appBox.x, y: appBox.y, width: appBox.width, height: appBox.height }, { x: 6, y: 10, width: 978, height: 660 }, 'Authenticated product window should match the supplied 1996×1352 screenshot at 2× scale');
  assert.ok(sidebarBox && Math.abs(sidebarBox.x - 6) <= 1 && Math.abs(sidebarBox.y - 54) <= 1 && Math.abs(sidebarBox.width - 280) <= 1, 'Product sidebar should align to the window header and match the reference width');
  assert.ok(productComposerBox && productComposerBox.x >= sidebarBox.x + sidebarBox.width && productComposerBox.x + productComposerBox.width <= 989 && productComposerBox.y + productComposerBox.height <= 674, 'Product composer should stay inside the two-column chat area');
  assert.equal(await productShellPage.getByLabel('Search bots').isVisible(), true);
  assert.equal(await productShellPage.locator('.bot-row').count(), 7, 'The official reference state shows the full Bot list');
  const firstBotAvatarBounds = await productShellPage.locator('.bot-row').first().locator('.avatar').boundingBox();
  assert.ok(firstBotAvatarBounds && Math.abs(firstBotAvatarBounds.width - 36) < 1 && Math.abs(firstBotAvatarBounds.y - 101.5) < 1, `The expanded Bot list should align avatar size and first-row spacing to the official screenshot: ${JSON.stringify(firstBotAvatarBounds)}`);
  assert.equal(await productShellPage.locator('.group-row').count(), 1, 'The reference state contains six Bots and one separate group');
  assert.equal(await productShellPage.locator('.group-row .group-avatar > span').count(), 3, 'The group avatar should stack its three member Bots');
  assert.equal(await productShellPage.locator('.group-section-heading').isVisible(), false, 'The compact reference sidebar places the group directly after the Bot list');
  assert.equal(await productShellPage.locator('.bot-row.selected time').innerText(), '15:33');
  assert.equal(await productShellPage.locator('.date-line').innerText(), '15:33', 'The active Bot conversation shows its activity time above the timeline');
  const completedActivityCard=productShellPage.getByRole('region',{name:'Computer activity · Done'});
  await completedActivityCard.waitFor();
  await productShellPage.getByText('Renamed to Sales Outbound', { exact: true }).waitFor();
  const visibleTimelineOrder = await productShellPage.locator('.message-scroll > .message-line, .message-scroll > .system-event-line, .message-scroll > .computer-activity-line').evaluateAll(elements => elements.map(element => element.textContent || ''));
  const timelinePosition = (text) => visibleTimelineOrder.findIndex(item => item.includes(text));
  assert.ok(timelinePosition('Overnight pipeline generation and outbound.') < timelinePosition('Renamed to Sales Outbound') && timelinePosition('Renamed to Sales Outbound') < timelinePosition("Checking what's connected."), 'User tasks, persisted rename events, and Agent results should follow their event times');
  assert.equal(await completedActivityCard.locator('.computer-activity-prompt').innerText(), 'Sign in to Salesforce so I can see the accounts you own.');
  assert.equal(await productShellPage.locator('.message-line.user .message-bubble').count(), 1, 'Computer work should appear in its activity card without a duplicate user bubble');
  assert.equal(await productShellPage.locator('.message-line.bot .message-bubble').filter({hasText: /^Done\.$/}).count(), 0, 'The activity status should carry a generic Done result without a duplicate reply bubble');
  const activityCardBounds = await productShellPage.locator('.computer-activity-card').boundingBox();
  assert.ok(activityCardBounds && activityCardBounds.width <= 421, 'Computer activity should match the reference card width');
  await completedActivityCard.getByRole('img',{name:'Current cloud computer screen'}).waitFor();
  assert.equal(await productShellPage.locator('.run-status').filter({ hasText: 'Completed' }).count(), 0, 'Completed agent responses should read as ordinary chat; the Computer card carries its own Done state');
  await productShellPage.waitForFunction(()=>{const image=document.querySelector('.computer-activity-screen img');return Boolean(image&&image.complete&&image.naturalWidth===464&&image.naturalHeight===290)});
  assert.equal(await productShellPage.getByRole('button', { name: 'New chat' }).isVisible(), true, 'the top-left create control should not be clipped by the sidebar');
  const computerPanelToggle = productShellPage.getByRole('button', { name: "Open Sales Outbound's computer" });
  assert.equal(await computerPanelToggle.count(), 1, 'The default workspace should show the monitor control');
  const computerPanel = productShellPage.locator('.details-panel');
  assert.equal(await computerPanel.count(), 0, 'The default workspace should keep the Computer panel closed');
  assert.ok(await productShellPage.locator('.account-name').textContent().then(value => value?.includes('Armand Segall')), 'The account identity should appear in the sidebar footer');
  const defaultConversationBox = await productShellPage.locator('.conversation').boundingBox();
  const mainBox = await productShellPage.locator('.main-shell').boundingBox();
  assert.ok(mainBox && defaultConversationBox && defaultConversationBox.width >= mainBox.width * 0.94, 'The default two-column layout should give nearly all main-column width to chat');
  assert.ok(await productShellPage.evaluate(() => document.documentElement.scrollWidth === window.innerWidth), 'Product shell should not create horizontal page whitespace');
  await mkdir('artifacts/ui', { recursive: true });
  await productShellPage.screenshot({ path: 'artifacts/ui/authenticated-product-window-reference-size-20261102.png' });
  await computerPanelToggle.click();
  await computerPanel.waitFor({ state: 'visible' });
  const referenceRailWidth = await productShellPage.locator('.sidebar').evaluate(element => element.getBoundingClientRect().width);
  const referenceComputerWidth = await computerPanel.evaluate(element => element.getBoundingClientRect().width);
  const productViewportWidth = await productShellPage.evaluate(() => innerWidth);
  const expectedComputerWidth = Math.max(240, Math.min(400, Math.floor((productViewportWidth - 16) * 0.27)));
  assert.ok(Math.abs(referenceRailWidth - 84) <= 1, 'Opening Computer should collapse the expanded Bot list to the 84px icon rail');
  assert.ok(Math.abs(referenceComputerWidth - expectedComputerWidth) <= 2, 'The default Computer pane should use the responsive width measured from the official reference');
  assert.equal(await productShellPage.locator('.app.product-shell').evaluate(element => element.classList.contains('sidebar-collapsed')), true, 'Opening Computer should show the compact Bot icon rail');
  await mkdir('artifacts/ui', { recursive: true });
  await productShellPage.getByRole('button', { name: 'Overnight outbound, Sundays at 11:00 PM' }).waitFor();
  const referenceMessageGeometry = await productShellPage.evaluate(() => {
    const box = (selector, index = 0) => { const rect = document.querySelectorAll(selector)[index]?.getBoundingClientRect(); return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; };
    return { welcome: box('.message-line.bot .message-bubble', 0), prompt: box('.message-line.user .message-bubble'), response: box('.message-line.bot .message-bubble', 1), computer: box('.computer-activity-card'), screen: box('.computer-preview-button') };
  });
  assert.ok(referenceMessageGeometry.welcome && Math.abs(referenceMessageGeometry.welcome.x - 110.5) <= 3 && Math.abs(referenceMessageGeometry.welcome.width - 531) <= 8, 'The welcome message should align to the official panel-open chat geometry');
  assert.ok(referenceMessageGeometry.welcome && Math.abs(referenceMessageGeometry.welcome.y - 54) <= 2, 'The welcome message should start at the official header baseline');
  assert.ok(referenceMessageGeometry.prompt && Math.abs(referenceMessageGeometry.prompt.x - 267.5) <= 4 && Math.abs(referenceMessageGeometry.prompt.width - 420) <= 5, 'The user prompt should match the official message width and right alignment');
  assert.ok(referenceMessageGeometry.prompt && Math.abs(referenceMessageGeometry.prompt.y - 121.5) <= 3, `The first task should start at the official vertical position: ${JSON.stringify(referenceMessageGeometry.prompt)}`);
  assert.ok(referenceMessageGeometry.response && Math.abs(referenceMessageGeometry.response.x - 110.5) <= 3 && Math.abs(referenceMessageGeometry.response.width - 531) <= 8, 'The Agent response should match the official Bot bubble geometry');
  assert.ok(referenceMessageGeometry.response && Math.abs(referenceMessageGeometry.response.y - 313.5) <= 2, 'The Agent response should match the official vertical position');
  assert.ok(referenceMessageGeometry.computer && Math.abs(referenceMessageGeometry.computer.width - 420) <= 1, 'The Computer activity card should match the official card width');
  assert.ok(referenceMessageGeometry.computer && Math.abs(referenceMessageGeometry.computer.y - 373.5) <= 2, 'The Computer activity card should follow the Agent response at the official position');
  assert.ok(referenceMessageGeometry.screen && Math.abs(referenceMessageGeometry.screen.x - 735) <= 2 && Math.abs(referenceMessageGeometry.screen.y - 58.5) <= 2 && Math.abs(referenceMessageGeometry.screen.width - 231.5) <= 2, 'The live computer preview should align to the official right pane');
  await productShellPage.screenshot({ path: 'artifacts/ui/authenticated-product-computer-panel-reference-size-20261105.png' });
  demoRoutines.splice(0, demoRoutines.length);
  await productShellPage.getByRole('button', { name: 'Hide computer' }).click();
  await computerPanel.waitFor({ state: 'hidden' });
  assert.equal(await productShellPage.getByRole('separator', { name: 'Resize sidebar' }).getAttribute('aria-valuenow'), '280', 'Closing Computer restores the saved expanded sidebar width');
  demoRuns[1].status = 'running';
  demoRuns[1].result = 'Salesforce needs your attention before I can continue.';
  await productShellPage.reload({ waitUntil: 'networkidle' });
  const runningActivityCard=productShellPage.getByRole('region',{name:'Computer activity · Working'});
  await runningActivityCard.waitFor();
  await runningActivityCard.getByRole('img',{name:'Current cloud computer screen'}).waitFor();
  await productShellPage.waitForFunction(()=>{const image=document.querySelector('.computer-activity-screen img');return Boolean(image&&image.complete&&image.naturalWidth===464&&image.naturalHeight===290)});
  await computerPanelToggle.click();
  await computerPanel.waitFor({ state: 'visible' });
  const computerPanelBox = await computerPanel.boundingBox();
  const conversationBox = await productShellPage.locator('.conversation').boundingBox();
  assert.ok(computerPanelBox && computerPanelBox.x + computerPanelBox.width <= 989 && computerPanelBox.width >= 240, 'Expanded Computer panel should fit inside the rounded workspace window');
  assert.ok(conversationBox && conversationBox.width >= 320, 'Opening the Computer panel should preserve useful chat width');
  assert.equal(await productShellPage.getByRole('separator', { name: 'Resize sidebar' }).getAttribute('aria-valuenow'), '84', 'The Computer panel opens with the reference Bot icon rail');
  const sidebarResizeWhileOpen = productShellPage.getByRole('separator', { name: 'Resize sidebar' });
  await sidebarResizeWhileOpen.press('ArrowRight');
  assert.equal(await sidebarResizeWhileOpen.getAttribute('aria-valuenow'), '100', 'The sidebar can still be expanded while the Computer panel is open');
  await sidebarResizeWhileOpen.press('Home');
  assert.equal(await sidebarResizeWhileOpen.getAttribute('aria-valuenow'), '84', 'Home restores the compact reference rail while Computer is open');
  assert.equal(await productShellPage.getByRole('heading', { name: 'Routines' }).isVisible(), true, 'The Computer panel should include the official Routines section');
  await productShellPage.getByText('Ask in chat to set a routine.', { exact: true }).waitFor();
  assert.equal(await productShellPage.getByText('Ask in chat to set a routine.', { exact: true }).isVisible(), true, 'An empty routine list should use the official chat-first guidance');
  demoRoutines.push({ id:'55555555-5555-4555-8555-555555555555',botId:'sales-outbound',requestId:'66666666-6666-4666-8666-666666666666',name:'Routine E2E',instruction:'Prepare drafts for review. Do not send.',schedule:{kind:'weekly',weekday:0,hour:23,minute:0},timezone:'UTC',paused:false,when:'Sundays at 11:00 PM',nextRunAt:new Date(Date.now()+86_400_000).toISOString(),runs:[] });
  await productShellPage.reload({ waitUntil: 'networkidle' });
  await computerPanelToggle.click();
  await computerPanel.waitFor({ state: 'visible' });
  const savedRoutine = productShellPage.getByRole('button', { name: 'Routine E2E, Sundays at 11:00 PM' });
  await savedRoutine.waitFor();
  await savedRoutine.click();
  await productShellPage.getByRole('region', { name: 'Routine Routine E2E' }).waitFor();
  await productShellPage.getByRole('button', { name: 'Pause', exact: true }).click();
  await productShellPage.getByText('Paused', { exact: true }).waitFor();
  await productShellPage.getByRole('button', { name: 'Resume', exact: true }).click();
  await productShellPage.getByRole('button', { name: 'Test', exact: true }).click();
  await productShellPage.getByRole('region', { name: 'Run history' }).getByText('Queued', { exact: true }).waitFor();
  await productShellPage.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await productShellPage.getByLabel('Message Sales Outbound').inputValue(), 'Edit your routine: Routine E2E', 'Routine edit should return to the official chat workflow');
  await computerPanelToggle.click();
  await computerPanel.waitFor({ state: 'visible' });
  await productShellPage.getByRole('button', { name: 'Routine E2E, Sundays at 11:00 PM' }).click();
  await productShellPage.getByRole('button', { name: 'Delete routine', exact: true }).click();
  await productShellPage.getByRole('button', { name: 'Delete routine', exact: true }).click();
  await productShellPage.getByText('Ask in chat to set a routine.', { exact: true }).waitFor();
  const openScreen = productShellPage.getByRole('button', { name: 'Open screen' });
  await openScreen.click();
  const computerScreenDialog = productShellPage.getByRole('dialog', { name: "Sales Outbound's computer screen" });
  await computerScreenDialog.waitFor({ state: 'visible' });
  const screenBounds = await computerScreenDialog.boundingBox();
  const productViewport = await productShellPage.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(screenBounds && screenBounds.x === 0 && screenBounds.y === 0 && screenBounds.width === productViewport.width && screenBounds.height === productViewport.height, 'The computer screen should fill the browser viewport');
  await computerScreenDialog.getByRole('img', { name: 'Current computer screen' }).waitFor();
  await productShellPage.waitForFunction(() => { const image = document.querySelector('.computer-large-screen img'); return Boolean(image && image.complete && image.naturalWidth === 464 && image.naturalHeight === 290); });
  await mkdir('artifacts/ui', { recursive: true });
  await computerScreenDialog.screenshot({ path: 'artifacts/ui/authenticated-product-computer-fullscreen-20261105.png' });
  await computerScreenDialog.getByRole('button', { name: 'Enter computer full screen' }).click();
  await productShellPage.waitForFunction(() => document.fullscreenElement === document.querySelector('.computer-screen-dialog'));
  await computerScreenDialog.getByRole('button', { name: 'Exit computer full screen' }).click();
  await productShellPage.waitForFunction(() => document.fullscreenElement === null);
  await computerScreenDialog.getByRole('button', { name: 'Close screen' }).click();
  await computerScreenDialog.waitFor({ state: 'hidden' });
  await productShellPage.getByRole('button', { name: 'Agent settings' }).click();
  assert.equal(await productShellPage.getByLabel('Name', { exact: true }).inputValue(), 'Sales Outbound');
  assert.equal(await productShellPage.getByLabel('Title (optional)', { exact: true }).inputValue(), 'Sales');
  await productShellPage.getByRole('button', { name: 'Back to computer' }).click();
  assert.equal(await openScreen.isVisible(), true, 'Settings should return to the live Computer panel');
  await productShellPage.screenshot({ path: 'artifacts/ui/authenticated-product-computer-panel-20261102.png' });
  await productShellPage.getByRole('button', { name: 'Close computer' }).click();
  await computerPanel.waitFor({ state: 'hidden' });
  const sidebarResize = productShellPage.getByRole('separator', { name: 'Resize sidebar' });
  assert.equal(await sidebarResize.getAttribute('aria-valuenow'), '280');
  await sidebarResize.press('Home');
  assert.equal(await sidebarResize.getAttribute('aria-valuenow'), '84', 'Home should collapse the sidebar to the Bot icon rail');
  assert.equal(await productShellPage.locator('.app.product-shell').evaluate(element => element.classList.contains('sidebar-collapsed')), true);
  assert.equal(await productShellPage.getByLabel('Search bots').isVisible(), false);
  assert.equal(await productShellPage.locator('.bot-row').count(), 7, 'Collapsing should keep the Bot and group navigation available');
  assert.equal(await productShellPage.locator('.bot-row-content:visible').count(), 0, 'The compact rail should show Bot icons without list text');
  assert.equal(await productShellPage.getByRole('button', { name: 'New chat' }).count(), 1, 'The compact rail keeps one reachable new-chat action');
  await mkdir('artifacts/ui', { recursive: true });
  await productShellPage.screenshot({ path: 'artifacts/ui/authenticated-product-sidebar-rail-20261102.png' });
  const railHandleBox = await sidebarResize.boundingBox();
  assert.ok(railHandleBox);
  const dragStartX = railHandleBox.x + railHandleBox.width / 2;
  const dragY = railHandleBox.y + Math.min(220, railHandleBox.height / 2);
  await productShellPage.mouse.move(dragStartX, dragY);
  await productShellPage.mouse.down();
  await productShellPage.mouse.move(dragStartX + 180, dragY, { steps: 8 });
  await productShellPage.mouse.up();
  const expandedWidth = Number(await sidebarResize.getAttribute('aria-valuenow'));
  assert.ok(expandedWidth > 220, 'Dragging the splitter should widen the sidebar');
  await sidebarResize.press('ArrowLeft');
  assert.equal(Number(await sidebarResize.getAttribute('aria-valuenow')), expandedWidth - 16, 'Arrow keys should resize the sidebar in 16 px steps');
  await productShellPage.waitForFunction(expected => localStorage.getItem('coke-grok-bot:sidebar-width:v1:visual-tenant:visual-user') === String(expected), expandedWidth - 16);
  await productShellPage.reload({ waitUntil: 'networkidle' });
  const persistedSidebarResize = productShellPage.getByRole('separator', { name: 'Resize sidebar' });
  await persistedSidebarResize.waitFor();
  assert.equal(Number(await persistedSidebarResize.getAttribute('aria-valuenow')), expandedWidth - 16, 'The sidebar width should persist across refreshes for this account');
  const mentionedComposer=productShellPage.getByRole('textbox',{name:'Message Sales Outbound'});
  await mentionedComposer.fill('Please ask @C');
  const mentionOptions=productShellPage.getByRole('listbox',{name:'Mention a Bot'});
  await mentionOptions.waitFor();
  await mentionOptions.getByRole('option',{name:/Chief.*Bot/}).click();
  await mentionedComposer.pressSequentially('to check the schedule.');
  assert.equal(await mentionedComposer.inputValue(),'Please ask @Chief to check the schedule.');
  await productShellPage.getByRole('button',{name:'Send task'}).click();
  await productShellPage.getByText('Please ask @Chief to check the schedule.',{exact:true}).waitFor();
  assert.deepEqual(postedMentionBody,{requestId:postedMentionBody.requestId,prompt:'Please ask @Chief to check the schedule.',files:[],mentionBotIds:['chief']});
  await productShellContext.close();
  authChild.kill('SIGTERM');
  authChild = undefined;
  const reference = await context.newPage();
  reference.on('pageerror', error => errors.push(error.message));
  await reference.goto(`${base}/?reference=101-new-bot`, { waitUntil: 'networkidle' });
  await reference.getByText('What do you want me helping with most right now?', { exact: true }).waitFor();
  await reference.mouse.move(699, 293);
  for (const [selector, expected] of [
    ['.sidebar', { x: 0, y: 0, width: 350, height: 994 }],
    ['.message-bubble', { x: 370, y: 148, width: 704, height: 70 }],
    ['.onboarding-card', { x: 370, y: 224, width: 704, height: 383 }],
    ['.composer', { x: 370, y: 919, width: 1194, height: 56 }],
  ]) {
    const actual = await reference.locator(selector).first().boundingBox();
    assert.ok(actual, `Missing reference element ${selector}`);
    for (const [key, value] of Object.entries(expected)) assert.ok(Math.abs(actual[key] - value) <= 1, `${selector}.${key}: ${actual[key]} versus ${value}`);
  }
  await mkdir('artifacts/ui', { recursive: true });
  await reference.screenshot({ path: 'artifacts/ui/reference-101-actual.png' });
  await reference.getByRole('button', { name: 'New Bot', exact: true }).first().click();
  await reference.getByLabel('Bot name').waitFor();
  await reference.screenshot({ path: 'artifacts/ui/reference-101-details.png' });
  await reference.getByRole('button', { name: 'New Bot', exact: true }).first().click();
  await reference.getByRole('button', { name: 'New chat' }).click();
  await reference.mouse.move(610, 103);
  assert.equal(await reference.locator('.new-chat-menu .menu-option').count(), 11);
  assert.equal(await reference.getByLabel('Message Bot').isDisabled(), true);
  await reference.screenshot({ path: 'artifacts/ui/reference-101-new-chat.png' });
  const recipient = reference.getByLabel('Start a chat with');
  assert.equal(await recipient.evaluate(element => element === document.activeElement), true);
  await recipient.fill('missing recipient');
  assert.equal(await reference.locator('.new-chat-menu').getByText('New Bot', { exact: true }).count(), 0);
  await recipient.fill('maya');
  assert.equal(await reference.locator('.new-chat-menu').getByText('maya', { exact: true }).count(), 1);
  await recipient.press('Escape');

  const websiteDemoContext = await browser.newContext({ viewport: { width: 1470, height: 864 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  progress('static website demo');
  const websiteDemo = await websiteDemoContext.newPage();
  websiteDemo.on('pageerror', error => errors.push(error.message));
  await websiteDemo.goto(`${base}/?reference=website-demo`, { waitUntil: 'networkidle' });
  const demoWindow = websiteDemo.locator('.grok-demo-window');
  await websiteDemo.locator('.site-demo-user-message').first().waitFor();
  assert.match(await websiteDemo.locator('.site-demo-user-message').first().innerText(), /Overnight pipeline generation and outbound\./);
  const demoConversation = websiteDemo.locator('.site-demo-message-scroll');
  const conversationBounds = await demoConversation.boundingBox();
  const taskBounds = await websiteDemo.locator('.site-demo-user-message').first().boundingBox();
  assert.ok(conversationBounds && taskBounds && Math.abs(taskBounds.y - conversationBounds.y - 14) <= 2, 'the initial chat viewport should begin at the task message');
  assert.equal(await websiteDemo.getByRole('button', { name: /Sales Outbound, Done\./ }).count(), 1);
  assert.equal(await websiteDemo.locator('.site-demo-agent-row').count(), 7);
  assert.equal(await websiteDemo.locator('.site-demo-chat-name .site-demo-title-mark').count(), 1);
  assert.equal(await websiteDemo.locator('.site-demo-chat-name .site-demo-avatar').count(), 0);
  assert.equal(await websiteDemo.locator('.site-demo-agent-row').nth(0).getAttribute('aria-label'), 'Chief, booked the venue and sent the confirmation around.');
  assert.equal(await websiteDemo.locator('.site-demo-agent-row').nth(2).getAttribute('aria-label'), 'Inbox Manager, sent. inbox at zero, 5 drafts parked for tomorrow.');
  const clockOffsets = await websiteDemo.locator('.site-demo-agent-row time').evaluateAll(rows => {
    const minutes = rows.map(row => { const [hour, minute] = (row.textContent || '').split(':').map(Number); return hour * 60 + minute; });
    return [2, 3, 4, 5, 6].map(index => (minutes[1] - minutes[index] + 1440) % 1440);
  });
  assert.deepEqual(clockOffsets, [181, 301, 481, 241, 361]);
  assert.deepEqual(await websiteDemo.locator('.site-demo-agent-row time').allTextContents(), ['Yesterday', '16:35', '13:34', '11:34', '8:34', '12:34', '10:34']);
  await mkdir('artifacts/ui', { recursive: true });
  await demoWindow.screenshot({ path: 'artifacts/ui/grok-bot-website-demo-window.png', scale: 'device' });
  assert.equal(await websiteDemo.locator('.site-demo-waveform').count(), 0, 'the official completed conversation has no floating waveform control');
  assert.equal(await websiteDemo.getByRole('button', { name: 'Voice message' }).count(), 1, 'the composer should use the single official voice-message button');
  assert.equal(await websiteDemo.getByRole('button', { name: 'Start voice chat' }).count(), 0);

  await websiteDemo.getByRole('button', { name: "Open Sales Outbound's computer" }).click();
  await websiteDemo.waitForTimeout(320);
  assert.equal(await websiteDemo.getByRole('complementary', { name: 'Computer and routines' }).count(), 1);
  assert.equal(await websiteDemo.locator('.site-demo-sidebar').evaluate(element => element.classList.contains('collapsed')), true);
  assert.equal(await websiteDemo.getByRole('img', { name: 'Armand Segall' }).count(), 1);
  assert.equal(await websiteDemo.getByText('Sundays at 11:00 PM', { exact: true }).count(), 1);
  await websiteDemo.getByRole('button', { name: 'Agent settings' }).click();
  const settingsPanel = websiteDemo.locator('.site-demo-computer-panel');
  await settingsPanel.getByRole('heading', { name: 'Settings' }).waitFor();
  assert.equal(await settingsPanel.getByRole('textbox', { name: 'Name' }).inputValue(), 'Sales Outbound');
  assert.equal(await settingsPanel.getByRole('textbox', { name: 'Title (optional)' }).inputValue(), 'Sales');
  assert.equal(await settingsPanel.getByRole('switch', { name: 'Notifications' }).getAttribute('aria-checked'), 'true');
  assert.equal(await settingsPanel.locator('.site-demo-profile-avatar .site-demo-avatar > g').getAttribute('transform'), null, 'the settings avatar eyes should stay upright');
  await settingsPanel.screenshot({ path: 'artifacts/ui/grok-bot-website-demo-settings.png', scale: 'device' });
  await settingsPanel.getByRole('textbox', { name: 'Name' }).fill('Outbound Research');
  await settingsPanel.getByRole('textbox', { name: 'Title (optional)' }).fill('Growth');
  await settingsPanel.getByRole('textbox', { name: 'Description' }).fill('Research accounts and prepare drafts.');
  await settingsPanel.getByRole('switch', { name: 'Notifications' }).click();
  assert.equal(await settingsPanel.getByRole('switch', { name: 'Notifications' }).getAttribute('aria-checked'), 'false');
  await settingsPanel.getByRole('textbox', { name: 'Name' }).fill('Sales Outbound');
  await settingsPanel.getByRole('textbox', { name: 'Title (optional)' }).fill('Sales');
  await settingsPanel.getByRole('textbox', { name: 'Description' }).fill('Works the pipeline overnight: researches the prospects worth a look, pulls their context together, and leaves sequences drafted for the morning.');
  await settingsPanel.getByRole('switch', { name: 'Notifications' }).click();
  await settingsPanel.getByRole('button', { name: 'Back to computer' }).click();
  assert.equal(await websiteDemo.getByText('Sales Outbound’s screen', { exact: true }).count(), 1);
  await demoWindow.screenshot({ path: 'artifacts/ui/grok-bot-website-demo-computer.png', scale: 'device' });
  await websiteDemo.getByRole('button', { name: 'Open screen' }).first().click();
  const screenDialog = websiteDemo.getByRole('dialog', { name: 'Sales Outbound computer screen' });
  await screenDialog.waitFor();
  assert.equal(await screenDialog.getByText('36 drafts queued', { exact: true }).count(), 1);
  await websiteDemo.locator('.site-demo-screen-overlay').screenshot({ path: 'artifacts/ui/grok-bot-website-demo-screen.png', scale: 'device' });
  await websiteDemo.getByRole('button', { name: 'Hide Drafts queue' }).click();
  assert.equal(await screenDialog.locator('.site-demo-window-front').count(), 0);
  await websiteDemo.getByRole('button', { name: 'Hide CRM portal' }).click();
  assert.equal(await screenDialog.locator('.site-demo-window-back').count(), 0);
  await websiteDemo.getByRole('button', { name: 'Show CRM portal' }).click();
  assert.equal(await screenDialog.locator('.site-demo-window-back').count(), 1);
  await websiteDemo.getByRole('button', { name: 'Show Drafts queue' }).click();
  assert.equal(await screenDialog.locator('.site-demo-window-front').count(), 1);
  assert.equal(await screenDialog.getByText('36 drafts queued', { exact: true }).count(), 1);
  await websiteDemo.getByRole('button', { name: 'Close screen' }).click();
  await demoConversation.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await websiteDemo.getByLabel('Task results').getByText('52 accounts', { exact: false }).waitFor();
  await websiteDemo.getByText(/Messages from/).waitFor();
  await websiteDemo.getByText(/The 36 drafts are sitting in the LinkedIn queue/).waitFor();
  await websiteDemo.getByText('The top 10 look good. Send it. Run this every week.', { exact: true }).waitFor();
  assert.equal(await websiteDemo.getByRole('button', { name: 'Thumbs up reaction' }).count(), 1);
  await websiteDemo.getByText(/Created routine/).waitFor();
  assert.equal(await websiteDemo.getByText('Done.', { exact: true }).count(), 1);
  await demoConversation.screenshot({ path: 'artifacts/ui/grok-bot-website-demo-later-conversation.png', scale: 'device' });

  await websiteDemo.getByRole('button', { name: 'Hide computer' }).click();
  await websiteDemo.waitForTimeout(320);
  await websiteDemo.getByRole('button', { name: 'New agent', exact: true }).click();
  const agentPicker = websiteDemo.getByRole('dialog', { name: 'Search or create agents' });
  await agentPicker.waitFor();
  assert.equal(await websiteDemo.getByRole('textbox', { name: 'Search or create agents' }).getAttribute('placeholder'), 'Search or create agents');
  assert.equal(await websiteDemo.getByRole('textbox', { name: 'Message agent' }).getAttribute('placeholder'), 'Message agent');
  assert.equal(await websiteDemo.getByText(/Overnight pipeline generation and outbound\./).count(), 0, 'opening the agent picker should show a blank draft conversation');
  assert.equal(await websiteDemo.locator('.site-demo-waveform').count(), 0, 'the voice waveform should be absent while choosing an agent');
  const pickerBounds = await agentPicker.boundingBox();
  const demoBounds = await demoWindow.boundingBox();
  assert.ok(pickerBounds && demoBounds && pickerBounds.width > demoBounds.width * .65, 'the agent chooser should span most of the conversation pane');
  await demoWindow.screenshot({ path: 'artifacts/ui/grok-bot-website-demo-agent-picker.png', scale: 'device' });
  await agentPicker.getByRole('button', { name: 'Create new agent' }).click();
  await websiteDemo.getByRole('textbox', { name: 'Message New agent' }).waitFor();
  assert.equal(await websiteDemo.locator('.site-demo-empty-chat').count(), 0, 'a created Bot opens a blank conversation without an invented empty-state message');
  assert.equal(await websiteDemo.locator('.site-demo-chat-name .site-demo-avatar circle').getAttribute('fill'), '#111110');
  assert.equal(await websiteDemo.locator('.site-demo-agent-row').first().getAttribute('aria-label'), 'New agent', 'a newly created agent should be inserted at the top of the list');
  assert.match(await websiteDemo.locator('.site-demo-agent-row').first().locator('time').innerText(), /^\d{2}:\d{2}$/);
  await websiteDemo.locator('.grok-demo-window').screenshot({ path: 'artifacts/ui/grok-bot-website-demo-new-agent.png', scale: 'device' });
  await websiteDemo.getByRole('button', { name: /Sales Outbound, Done\./ }).click();
  assert.equal(await websiteDemo.locator('.site-demo-agent-row[aria-label="New agent"]').count(), 1);
  await websiteDemo.locator('.site-demo-agent-row[aria-label="New agent"]').click();
  await websiteDemo.getByRole('textbox', { name: 'Message New agent' }).waitFor();
  await websiteDemo.locator('.site-demo-new-agent').click();
  await websiteDemo.getByRole('textbox', { name: 'Search or create agents' }).fill('Chief');
  await websiteDemo.getByRole('button', { name: 'Chief', exact: true }).click();
  assert.equal(await websiteDemo.getByRole('button', { name: 'Open Chief\'s computer' }).count(), 1);
  assert.equal(await websiteDemo.getByText(/Morning briefing/).count(), 1);
  assert.equal(await websiteDemo.locator('.site-demo-chief-briefing').count(), 1);
  assert.equal(await websiteDemo.getByText("take the venue, i'll do the deck", { exact: true }).count(), 1);
  assert.equal(await websiteDemo.getByText('booked the venue and sent the confirmation around. you\'re clear until the 2pm deck review.', { exact: true }).count(), 1);
  const chiefShortMessage = await websiteDemo.locator('.site-demo-chief-user-message').boundingBox();
  const chiefApprovalMessage = await websiteDemo.locator('.site-demo-chief-approval-wrap .site-demo-approval-message').boundingBox();
  assert.ok(chiefShortMessage && chiefShortMessage.width < 300, 'short Chief replies should size to their text instead of stretching to the task-message width');
  assert.ok(chiefApprovalMessage && chiefApprovalMessage.width < 150, 'the short book-it approval should remain a compact user bubble');
  await demoWindow.screenshot({ path: 'artifacts/ui/grok-bot-website-demo-chief-conversation.png', scale: 'device' });
  await websiteDemo.locator('.site-demo-agent-row[aria-label="New agent"]').click();
  await websiteDemo.getByRole('button', { name: "Open New agent's computer" }).click();
  assert.equal(await websiteDemo.getByRole('complementary', { name: 'Computer and routines' }).count(), 1);
  await websiteDemoContext.close();
  progress('manual website demo passed');

  const animatedDemoContext = await browser.newContext({ viewport: { width: 1470, height: 864 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  progress('autoplay website demo opened');
  const animatedDemo = await animatedDemoContext.newPage();
  animatedDemo.on('pageerror', error => errors.push(error.message));
  await animatedDemo.goto(`${base}/?reference=website-demo`, { waitUntil: 'networkidle' });
  const animatedWindow = animatedDemo.locator('.grok-demo-window');
  const animatedConversation = animatedDemo.locator('.site-demo-message-scroll');
  assert.equal(await animatedWindow.getAttribute('data-demo-phase'), 'intro');
  assert.equal(await animatedDemo.getByRole('status').innerText(), 'Thinking');
  assert.equal(await animatedDemo.locator('.site-demo-computer-card').count(), 0);
  for (const phase of ['connections', 'action-needed', 'takeover', 'computer-working', 'computer', 'results', 'collaboration', 'approval', 'complete']) {
    await animatedWindow.waitFor({ state: 'visible' });
    await animatedDemo.waitForFunction(expected => document.querySelector('.grok-demo-window')?.getAttribute('data-demo-phase') === expected, phase, { timeout: 4_000 });
    progress(`autoplay phase: ${phase}`);
    if (phase === 'computer-working') {
      await animatedDemo.waitForTimeout(280);
      assert.equal(await animatedDemo.locator('.site-demo-status').innerText(), 'Working');
      assert.equal(await animatedDemo.locator('.site-demo-computer-card .site-demo-open-screen').count(), 1);
      assert.equal(await animatedDemo.locator('.site-demo-computer-card .site-demo-agent-pointer').count(), 1);
      assert.equal(await animatedDemo.locator('.site-demo-title-mark circle').getAttribute('fill'), '#895af2');
      await animatedWindow.screenshot({ path: 'artifacts/ui/grok-bot-website-demo-autoplay-working.png' });
    }
    if (phase === 'action-needed') {
      assert.equal(await animatedDemo.locator('.site-demo-status').innerText(), 'Action needed');
      assert.equal(await animatedDemo.locator('.site-demo-salesforce-login').count(), 1);
      assert.equal(await animatedDemo.getByRole('button', { name: 'Take over' }).count(), 1);
      assert.equal(await animatedDemo.getByRole('button', { name: 'I’m done' }).count(), 1);
      await animatedWindow.screenshot({ path: 'artifacts/ui/grok-bot-website-demo-autoplay-action-needed.png' });
    }
    if (phase === 'takeover') {
      const takeoverDialog = animatedDemo.getByRole('dialog', { name: 'Salesforce computer takeover' });
      await takeoverDialog.waitFor({ state: 'visible' });
      assert.equal(await animatedDemo.locator('.site-demo-status').innerText(), "You're in control");
      assert.equal(await takeoverDialog.getByRole('button', { name: 'I’m done, continue' }).count(), 1);
      assert.equal(await takeoverDialog.getByRole('toolbar', { name: 'Applications' }).getByRole('button', { name: 'Safari' }).count(), 1);
      assert.equal(await takeoverDialog.locator('.site-demo-human-pointer').count(), 1);
      await animatedWindow.screenshot({ path: 'artifacts/ui/grok-bot-website-demo-autoplay-takeover.png' });
    }
    if (phase === 'computer') {
      assert.equal(await animatedDemo.locator('.site-demo-status').innerText(), 'Done');
      assert.equal(await animatedDemo.locator('.site-demo-computer-card .site-demo-agent-pointer').count(), 0);
      assert.equal(await animatedDemo.locator('.site-demo-title-mark circle').getAttribute('fill'), '#f19d39');
      await animatedWindow.screenshot({ path: 'artifacts/ui/grok-bot-website-demo-autoplay-computer.png' });
    }
    if (phase === 'results') {
      await animatedDemo.waitForTimeout(280);
      assert.equal(await animatedDemo.getByLabel('Task results').getByText('52 accounts', { exact: false }).count(), 1);
      assert.equal(await animatedDemo.getByLabel('Task results').getByText('3 lookalike segments pulled', { exact: false }).count(), 1);
      assert.equal(await animatedDemo.getByLabel('Task results').getByText('4 profiles skipped · recently contacted', { exact: false }).count(), 1);
      await animatedWindow.screenshot({ path: 'artifacts/ui/grok-bot-website-demo-autoplay-results.png' });
    }
    if (phase === 'collaboration') {
      assert.equal(await animatedDemo.getByText(/Messages from/).count(), 1);
      assert.equal(await animatedDemo.getByText(/The 36 drafts are sitting in the LinkedIn queue/).count(), 1);
    }
    if (phase === 'approval') assert.equal(await animatedDemo.getByRole('button', { name: 'Thumbs up reaction' }).count(), 1);
    if (['results', 'collaboration', 'approval', 'complete'].includes(phase)) {
      const scrollState = await animatedConversation.evaluate(element => ({ scrollTop: element.scrollTop, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
      assert.ok(scrollState.scrollHeight - (scrollState.scrollTop + scrollState.clientHeight) <= 2, `autoplay should keep the latest message visible during ${phase}`);
    }
  }
  const finalMessage = animatedDemo.locator('.site-demo-done-message');
  assert.equal(await finalMessage.getByText('Done.', { exact: true }).count(), 1);
  const finalMessageBounds = await finalMessage.boundingBox();
  const composerBounds = await animatedDemo.locator('.site-demo-composer').boundingBox();
  assert.ok(finalMessageBounds && composerBounds && finalMessageBounds.y + finalMessageBounds.height <= composerBounds.y, 'the final Done reply should remain reachable below the conversation history');
  assert.equal(await animatedDemo.locator('.site-demo-waveform').count(), 0, 'the completed conversation should not show a floating waveform');
  const voiceButtonBounds = await animatedDemo.getByRole('button', { name: 'Voice message' }).boundingBox();
  assert.ok(voiceButtonBounds && composerBounds && voiceButtonBounds.x >= composerBounds.x && voiceButtonBounds.x + voiceButtonBounds.width <= composerBounds.x + composerBounds.width, 'the microphone control should remain inside the composer');
  await animatedDemo.waitForTimeout(300);
  await mkdir('artifacts/ui', { recursive: true });
  await animatedWindow.screenshot({ path: 'artifacts/ui/grok-bot-website-demo-autoplay-done.png' });
  await animatedDemoContext.close();

  progress('autoplay website demo passed');

  const takeoverContext = await browser.newContext({ viewport: { width: 1470, height: 864 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  const takeoverPage = await takeoverContext.newPage();
  takeoverPage.on('pageerror', error => errors.push(error.message));
  await takeoverPage.goto(`${base}/?reference=website-demo`, { waitUntil: 'networkidle' });
  const takeoverWindow = takeoverPage.locator('.grok-demo-window');
  await takeoverPage.waitForFunction(() => document.querySelector('.grok-demo-window')?.getAttribute('data-demo-phase') === 'action-needed', undefined, { timeout: 4_000 });
  await takeoverPage.getByRole('button', { name: 'Take over' }).click();
  await takeoverPage.waitForFunction(() => document.querySelector('.grok-demo-window')?.getAttribute('data-demo-phase') === 'takeover');
  const manualTakeoverDialog = takeoverPage.getByRole('dialog', { name: 'Salesforce computer takeover' });
  await manualTakeoverDialog.getByRole('button', { name: 'I’m done, continue' }).click();
  await takeoverPage.waitForFunction(() => document.querySelector('.grok-demo-window')?.getAttribute('data-demo-phase') === 'computer-working');
  assert.equal(await takeoverPage.getByRole('dialog', { name: 'Salesforce computer takeover' }).count(), 0);
  await takeoverContext.close();
  progress('manual computer takeover passed');

  assert.deepEqual(errors, []);
  await context.close();
  console.log('UI E2E passed: local preview, authenticated two-column workspace, live computer activity card and screenshot, activity time, on-demand Computer panel, create/rename, messages, reload, switching, browser-profile isolation, narrow-layout sanity, 101 reference screenshot, Grok Bot website-demo static/manual states, homepage animation including takeover through Done, automatic latest-message scrolling, no page errors.');
} finally {
  if (browser) await browser.close();
  if (authChild) authChild.kill('SIGTERM');
  child.kill('SIGTERM');
}
