import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

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
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByText('本地界面预览', { exact: false }).waitFor();
  assert.equal(await page.locator('.bot-row').count(), 1);
  await page.getByRole('button', { name: 'New chat' }).click();
  const recipient = page.getByLabel('Start a chat with');
  assert.equal(await recipient.evaluate(element => element === document.activeElement), true);
  await recipient.fill('missing recipient');
  assert.equal(await page.locator('.new-chat-menu').getByText('New Bot', { exact: true }).count(), 0);
  await recipient.fill('New Bot');
  assert.equal(await page.locator('.new-chat-menu').getByText('New Bot', { exact: true }).count(), 1);
  await recipient.press('Escape');
  await page.keyboard.press('Control+N');
  assert.equal(await recipient.inputValue(), '');
  await page.getByRole('button', { name: 'Create new Bot' }).click();
  assert.equal(await page.locator('.bot-row').count(), 2);
  await page.getByText('What do you want me helping with most right now?', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Show bot details' }).click();
  await page.getByLabel('Bot name').fill('Local Research');
  await page.getByLabel('Bot label').fill('analyst');
  await page.getByLabel('Bot label').press('Enter');
  assert.equal(await page.locator('.bot-row.selected').getByText('analyst').count(), 1);
  await page.getByRole('button', { name: 'Change Bot picture' }).click();
  assert.equal(await page.locator('.avatar-shapes button').count(), 8);
  assert.equal(await page.locator('.avatar-colors button').count(), 11);
  await page.getByRole('button', { name: 'Shape square' }).click();
  await page.getByRole('button', { name: 'Color #959595' }).click();
  await mkdir('artifacts/ui', { recursive: true });
  await page.locator('.avatar-dialog').screenshot({ path: 'artifacts/ui/avatar-picker.png' });
  await page.getByRole('button', { name: 'Shape triangle' }).click();
  await page.getByRole('button', { name: 'Color #1cc3b0' }).click();
  await page.getByRole('button', { name: 'Set avatar' }).click();
  assert.equal(await page.locator('.bot-row.selected .avatar path').first().getAttribute('fill'), '#1cc3b0');
  await page.getByRole('button', { name: 'Hide bot details' }).click();
  await page.getByLabel('Message Local Research').fill('Local-only test message');
  await page.getByRole('button', { name: 'Save local message' }).click();
  await page.getByText('No message was sent to an Agent', { exact: false }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('.bot-row.selected').getByText('analyst').count(), 1);
  assert.equal(await page.locator('.bot-row.selected .avatar path').first().getAttribute('fill'), '#1cc3b0');
  assert.equal(await page.locator('.conversation').getByText('Local-only test message', { exact: true }).count(), 1);
  await page.getByRole('button', { name: /New Bot.*Ready for a conversation/ }).click();
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
  assert.deepEqual(errors, []);
  await context.close();
  console.log('UI E2E passed: local preview labeling, create/rename, messages, reload, switching, browser-profile isolation, narrow-layout sanity, reference screenshot, no page errors.');
} finally {
  if (browser) await browser.close();
  child.kill('SIGTERM');
}
