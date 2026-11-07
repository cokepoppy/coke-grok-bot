import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { BrowserContextNotReadyError, getBrowserPage, waitForDefaultBrowserContext } from './browser-context.mjs';
import { createRendererHealthMonitor, RendererUnresponsiveError } from './renderer-health.mjs';
import { BotScreenCapacityError, BotScreenPages } from './bot-screen-pages.mjs';
import { createDesktopScreenLayout, parseDesktopScreenSlots } from './desktop-screen-layout.mjs';
import { captureOwnedDesktopScreen, clickDesktop, createDesktopActionGate, pressDesktopKey, typeDesktop, withFocusedDesktopPage } from './desktop-input.mjs';
import { ensureSharedComputerRoots } from './shared-computer-root.mjs';
import { createGuardedComputer } from '/opt/coke-grok/guarded-computer.mjs';

const exec = promisify(execFile);
const token = String(process.env.LINUX_DESKTOP_WORKER_TOKEN || '');
const port = Number(process.env.COKE_DESKTOP_WORKER_PORT || 8082);
const guardedMode = process.env.COKE_GROK_GUARDED_MODE === '1';
const controlToken = String(process.env.COKE_GROK_CONTROL_TOKEN || '');
if (guardedMode && (!controlToken || controlToken === token)) throw new Error('A distinct control token is required in guarded mode');
const screenIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const agentEndpoint = new URL(process.env.COKE_GROK_AGENT_URL || `http://127.0.0.1:${process.env.DOTS_AGENT_RUNTIME_PORT || 8083}/`);
if (agentEndpoint.protocol !== 'http:' || agentEndpoint.username || agentEndpoint.password || agentEndpoint.search || agentEndpoint.hash || agentEndpoint.pathname !== '/' || !(agentEndpoint.hostname === '127.0.0.1' || /^agent\.grok-user-[a-f0-9]{32}\.svc\.cluster\.local$/.test(agentEndpoint.hostname)) || agentEndpoint.port !== '8083') throw new Error('Invalid agent endpoint');
const screenLayout = createDesktopScreenLayout(
  process.env.COKE_DESKTOP_RESOLUTION || '1440x900',
  parseDesktopScreenSlots(process.env.COKE_DESKTOP_SCREEN_SLOTS || '8'),
);
let browser;
let browserConnectPromise;
let pageInitialization;
const screenOwners = new Map();
const guardedComputers = new Map();
const rendererTimeoutMs = 3_000;
const rendererHealth = createRendererHealthMonitor(rendererTimeoutMs);
let rendererProbeFailures = 0;
let rendererRecovery = null;
const desktopActionGate = createDesktopActionGate();
const screenPages = new BotScreenPages(async () => waitForDefaultBrowserContext(await connectedBrowser()), {
  layout: screenLayout,
  createWindow: createBrowserWindow,
  placeWindow: placeBrowserWindow,
});

if (!token) throw new Error('LINUX_DESKTOP_WORKER_TOKEN is required');

async function connectedBrowser() {
  if (browser && !browser.isConnected()) { browser = undefined; browserConnectPromise = undefined; }
  if (!browserConnectPromise) {
    browserConnectPromise = chromium.connectOverCDP('http://127.0.0.1:9222').then(connected => {
      browser = connected;
      connected.on('disconnected', () => {
        if (browser === connected) {
          browser = undefined;
          browserConnectPromise = undefined;
          pageInitialization = undefined;
        }
      });
      return connected;
    }).catch(error => { browserConnectPromise = undefined; throw error; });
  }
  browser = await browserConnectPromise;
  return browser;
}

async function placeBrowserWindow(browserPage, bounds) {
  const session = await browserPage.context().newCDPSession(browserPage);
  try {
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, windowState: 'normal' },
    });
  } finally { await session.detach().catch(() => undefined); }
}

async function createBrowserWindow(context, bounds) {
  const connected = await connectedBrowser();
  const session = await connected.newBrowserCDPSession();
  const pagePromise = context.waitForEvent('page', { timeout: 10_000 });
  try {
    const { targetId } = await session.send('Target.createTarget', {
      url: 'about:blank', newWindow: true, left: bounds.left, top: bounds.top,
      width: bounds.width, height: bounds.height,
    });
    const browserPage = await pagePromise;
    const { windowId } = await session.send('Browser.getWindowForTarget', { targetId });
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, windowState: 'normal' },
    });
    return browserPage;
  } catch (error) {
    await pagePromise.catch(() => undefined);
    throw error;
  } finally { await session.detach().catch(() => undefined); }
}

async function createPageWithContextRecovery() {
  const connected = await connectedBrowser();
  const context = await waitForDefaultBrowserContext(connected);
  try { return await getBrowserPage(context); }
  catch (error) {
    if (!(error instanceof BrowserContextNotReadyError)) throw error;
    process.stderr.write(`${JSON.stringify({ event: 'dots_browser_context_unavailable', at: new Date().toISOString(), recoveryAttempt: 1 })}\n`);
    browser = undefined;
    browserConnectPromise = undefined;
    await new Promise(resolve => setTimeout(resolve, 100));
    const reconnected = await connectedBrowser();
    const refreshedContext = await waitForDefaultBrowserContext(reconnected);
    return getBrowserPage(refreshedContext);
  }
}

async function page() {
  if (pageInitialization) return pageInitialization;
  const pending = createPageWithContextRecovery();
  pageInitialization = pending;
  try { return await pending; }
  finally { if (pageInitialization === pending) pageInitialization = undefined; }
}

async function rendererResponds() {
  const ok = await rendererHealth.check(async () => {
    const browserPage = await page();
    const readyState = await browserPage.evaluate(() => document.readyState);
    if (typeof readyState !== 'string') throw new Error('Chromium page did not return its document state');
  });
  if (ok) {
    rendererProbeFailures = 0;
    return true;
  }
  rendererProbeFailures += 1;
  if (rendererHealth.unresponsive || rendererProbeFailures >= 3) {
    rendererHealth.fail();
    void recoverChromium();
  }
  return false;
}

function clearBrowserHandles() {
  browser = undefined;
  browserConnectPromise = undefined;
  pageInitialization = undefined;
  screenPages.clear();
}

async function recoverChromium() {
  if (rendererRecovery) return rendererRecovery;
  rendererRecovery = (async () => {
    const previousPid = (await fs.readFile('/tmp/dots-chrome.pid', 'utf8')).trim();
    if (!/^\d+$/.test(previousPid)) throw new Error('Chromium supervisor PID is unavailable');
    process.kill(process.ppid, 'SIGUSR1');

    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const nextPid = (await fs.readFile('/tmp/dots-chrome.pid', 'utf8').catch(() => '')).trim();
      if (/^\d+$/.test(nextPid) && nextPid !== previousPid) {
        clearBrowserHandles();
        rendererHealth.reset();
        rendererProbeFailures = 0;
        try {
          const browserPage = await page();
          await rendererHealth.run(() => browserPage.evaluate(() => document.readyState));
          process.stdout.write(`${JSON.stringify({ event: 'dots_chromium_renderer_recovered', at: new Date().toISOString() })}\n`);
          return;
        } catch {
          clearBrowserHandles();
          rendererHealth.reset();
        }
      }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 500));
    }
    throw new Error('Chromium did not recover within 45 seconds');
  })().catch(error => {
    const message = error instanceof Error ? error.message : 'unknown recovery error';
    process.stderr.write(`${JSON.stringify({ event: 'dots_chromium_renderer_recovery_failed', at: new Date().toISOString(), message: message.slice(0, 180) })}\n`);
  }).finally(() => { rendererRecovery = null; });
  return rendererRecovery;
}

function send(res, status, value, type = 'application/json; charset=utf-8') {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': type, 'content-length': body.length, 'cache-control': 'no-store' });
  res.end(body);
}

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('request body is too large');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

const workspace = path.resolve(process.env.DOTS_AGENT_WORKSPACE || '/workspace');
async function pageForScreen(screenId) {
  if (!screenIdPattern.test(screenId)) throw new Error('Invalid Bot screen id');
  try {
    return await screenPages.get(screenId);
  } catch (error) {
    if (!(error instanceof BrowserContextNotReadyError)) throw error;
    process.stderr.write(`${JSON.stringify({ event: 'dots_browser_context_unavailable', at: new Date().toISOString(), recoveryAttempt: 1 })}\n`);
    clearBrowserHandles();
    await new Promise(resolve => setTimeout(resolve, 100));
    return screenPages.get(screenId);
  }
}

async function screenOwner(screenId) {
  if (!screenIdPattern.test(screenId)) throw new Error('Invalid Bot screen id');
  const root = await ensureSharedComputerRoots(workspace);
  if (screenOwners.has(screenId)) return screenOwners.get(screenId);
  const file = path.join(root, `${screenId}.json`);
  const raw = await fs.readFile(file, 'utf8').catch(error => error?.code === 'ENOENT' ? '' : Promise.reject(error));
  let value = 'agent';
  if (raw) {
    try { const saved = JSON.parse(raw); if (saved?.screenId !== screenId || !['agent','user'].includes(saved.owner)) throw new Error(); value = saved.owner; }
    catch { throw new Error('Computer screen control state is invalid'); }
  }
  screenOwners.set(screenId, value);
  return value;
}

async function setScreenOwner(screenId, value) {
  if (!['agent','user'].includes(value)) throw new Error('Invalid control owner');
  const root = await ensureSharedComputerRoots(workspace);
  const file = path.join(root, `${screenId}.json`), temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ screenId, owner: value }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, file);
  screenOwners.set(screenId, value);
}

function screenIdFromRequest(req) {
  const value = req.headers['x-coke-grok-screen-id'];
  if (typeof value !== 'string' || !screenIdPattern.test(value)) throw new Error('A valid Bot screen scope is required');
  return value.toLowerCase();
}

async function screenshot(screenId) {
  const browserPage = await pageForScreen(screenId);
  const bounds = await screenPages.geometry(screenId);
  return desktopActionGate(async () => captureOwnedDesktopScreen(exec, browserPage, bounds, await screenOwner(screenId)));
}

const artifactTaskId = /^[a-f0-9-]{36}$/i;
const maxArtifactBytes = 25 * 1024 * 1024;
const maxArtifactCount = 100;
const artifactTypes = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.wasm': 'application/wasm',
}));
const previewTypes = new Set(['text/html', 'text/css', 'text/javascript', 'application/json', 'text/markdown', 'text/plain', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);

async function artifactRoot(taskId) {
  if (!artifactTaskId.test(taskId)) throw new Error('invalid task id');
  const workspaceRoot = await fs.realpath(workspace);
  const taskRoot = path.join(workspaceRoot, 'tasks');
  const base = await fs.realpath(taskRoot);
  if (base !== taskRoot) throw new Error('task directory root is not a workspace directory');
  const expectedRoot = path.join(base, taskId);
  const root = await fs.realpath(expectedRoot);
  if (root !== expectedRoot) throw new Error('task directory is not isolated to this task');
  return root;
}

function artifactMediaType(filePath) {
  return artifactTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

async function listArtifacts(taskId) {
  let root;
  try { root = await artifactRoot(taskId); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  const artifacts = [];
  const pending = [root];
  while (pending.length && artifacts.length < maxArtifactCount) {
    const directory = pending.pop();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) { pending.push(absolute); continue; }
      if (!entry.isFile()) continue;
      const real = await fs.realpath(absolute);
      if (!real.startsWith(`${root}${path.sep}`)) continue;
      const stats = await fs.stat(real);
      if (!stats.isFile() || stats.size > maxArtifactBytes) continue;
      const relative = path.relative(root, real).split(path.sep).join('/');
      const mediaType = artifactMediaType(real).split(';', 1)[0];
      artifacts.push({ path: relative, name: path.basename(real), mediaType, size: stats.size, previewable: previewTypes.has(mediaType) });
      if (artifacts.length >= maxArtifactCount) break;
    }
  }
  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
}

async function readArtifact(taskId, relativePath) {
  const resolved = await resolveArtifact(taskId, relativePath);
  return { bytes: await fs.readFile(resolved.real), mediaType: resolved.mediaType, name: path.basename(resolved.real), previewable: previewTypes.has(resolved.mediaType.split(';', 1)[0]) };
}

async function resolveArtifact(taskId, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.length > 500 || relativePath.includes('\\') || path.posix.isAbsolute(relativePath)
      || relativePath.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('invalid artifact path');
  const root = await artifactRoot(taskId);
  const real = await fs.realpath(path.resolve(root, ...relativePath.split('/')));
  if (!real.startsWith(`${root}${path.sep}`)) throw new Error('artifact is outside the task directory');
  const stats = await fs.stat(real);
  if (!stats.isFile() || stats.size > maxArtifactBytes) throw new Error('artifact is not available for preview');
  const mediaType = artifactMediaType(real);
  return { real, mediaType };
}

async function command(input, screenId) {
  const action = String(input.action || '');
  const actor = input.actor === 'user' ? 'user' : 'agent', owner = await screenOwner(screenId);
  if (actor !== owner && action !== 'open') throw new Error(owner === 'user' ? 'The user currently controls this computer' : 'The agent currently controls this computer');
  if (action === 'open') {
    return rendererHealth.run(async () => {
      const browserPage = await pageForScreen(screenId);
      await browserPage.title();
      return { ready: true };
    });
  }
  if (['click', 'type', 'press'].includes(action)) {
    return desktopActionGate(async () => {
      const browserPage = await pageForScreen(screenId);
      const bounds = await screenPages.geometry(screenId);
      if (action === 'click') {
        const x = Number(input.x), y = Number(input.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Click coordinates are invalid');
        await withFocusedDesktopPage(browserPage, () => clickDesktop(exec, bounds, Math.round(x), Math.round(y)));
      } else if (action === 'type') {
        await withFocusedDesktopPage(browserPage, () => typeDesktop(spawn, String(input.text || '')));
      } else {
        await withFocusedDesktopPage(browserPage, () => pressDesktopKey(exec, String(input.key || '')));
      }
      const currentOwner = await screenOwner(screenId);
      if (actor !== currentOwner) throw new Error('Computer ownership changed');
      return {
        ready: true,
        url: browserPage.url(),
        title: await rendererHealth.run(() => browserPage.title()),
      };
    });
  }
  const browserPage = await pageForScreen(screenId);
  if (action === 'open-artifact') {
    if (actor !== 'user') throw new Error('Only a user can open a task artifact in the cloud browser');
    const resolved = await resolveArtifact(String(input.taskId || ''), String(input.path || ''));
    if (!resolved.mediaType.startsWith('text/html')) throw new Error('Only HTML task files can open in the cloud browser');
    await browserPage.goto(pathToFileURL(resolved.real).href, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } else if (action === 'navigate') {
    const url = new URL(String(input.url || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only credential-free HTTP and HTTPS URLs are allowed');
    await browserPage.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else throw new Error('Unsupported desktop command');
  await desktopActionGate(() => withFocusedDesktopPage(browserPage, async () => undefined));
  const currentOwner = await screenOwner(screenId);
  if (actor !== currentOwner) throw new Error('Computer ownership changed');
  return {
    ready: true,
    url: browserPage?.url() || '',
    title: browserPage ? await rendererHealth.run(() => browserPage.title()) : '',
  };
}

function safePageUrl(value) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

function browserLocator(browserPage, input) {
  const target = typeof input.target === 'string' ? input.target.trim() : '';
  const by = String(input.by || '');
  if (!target || target.length > 500) throw new Error('A visible browser control target is required');
  if (by === 'role') {
    const role = String(input.role || '');
    const roles = new Set(['alert', 'button', 'checkbox', 'combobox', 'dialog', 'heading', 'link', 'listbox', 'menuitem', 'option', 'radio', 'searchbox', 'slider', 'spinbutton', 'tab', 'textbox']);
    if (!roles.has(role)) throw new Error('Unsupported accessible role');
    return browserPage.getByRole(role, { name: target, exact: true });
  }
  if (by === 'text') return browserPage.getByText(target, { exact: true });
  if (by === 'label') return browserPage.getByLabel(target, { exact: true });
  if (by === 'placeholder') return browserPage.getByPlaceholder(target, { exact: true });
  if (by === 'css') return browserPage.locator(target);
  throw new Error('A supported browser locator type is required');
}

async function agentBrowserAction(input, screenId) {
  if (await screenOwner(screenId) !== 'agent') throw new Error('The user currently controls this computer');
  const action = String(input.action || '');
  const browserPage = await pageForScreen(screenId);
  if (action === 'navigate') {
    const url = new URL(String(input.url || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) throw new Error('Only credential-free HTTP and HTTPS URLs are allowed');
    if (await screenOwner(screenId) !== 'agent') throw new Error('The user currently controls this computer');
    // Real sites can take longer than the short renderer health probe. Keep
    // the explicit 30s navigation timeout without latching the renderer as
    // unresponsive after the probe's 3s deadline.
    await browserPage.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await desktopActionGate(() => withFocusedDesktopPage(browserPage, async () => undefined));
    return { ready: true, action, url: safePageUrl(browserPage.url()), title: await rendererHealth.run(() => browserPage.title()) };
  }
  return rendererHealth.run(async () => {
    if (await screenOwner(screenId) !== 'agent') throw new Error('The user currently controls this computer');
    if (action === 'inspect') {
      const snapshot = await browserPage.evaluate(() => {
        const visible = element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const controls = Array.from(document.querySelectorAll('button,a,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="combobox"]'))
          .filter(visible)
          .slice(0, 120)
          .map(element => {
            const labels = Array.from(element.labels || []).map(label => label.innerText).filter(Boolean);
            const name = element.getAttribute('aria-label') || labels.join(' ').trim() || element.innerText?.trim() || element.getAttribute('title') || element.getAttribute('placeholder') || element.getAttribute('name') || '';
            const tag = element.tagName.toLowerCase();
            return {
              role: element.getAttribute('role') || ({ button: 'button', a: 'link', input: element.getAttribute('type') === 'checkbox' ? 'checkbox' : element.getAttribute('type') === 'radio' ? 'radio' : 'textbox', textarea: 'textbox', select: 'combobox' }[tag] || tag),
              name: String(name).replace(/\s+/g, ' ').slice(0, 160),
              type: tag === 'input' ? element.getAttribute('type') || 'text' : tag,
              placeholder: element.getAttribute('placeholder') || undefined,
              disabled: Boolean(element.disabled),
            };
          });
        const visibleH1 = Array.from(document.querySelectorAll('h1'))
          .filter(visible)
          .slice(0, 20)
          .map(element => String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        return {
          title: document.title.slice(0, 300),
          text: (document.body?.innerText || '').slice(0, 12_000),
          visibleH1,
          controls,
        };
      });
      return { ready: true, action, url: safePageUrl(browserPage.url()), title: snapshot.title, text: snapshot.text, visibleH1: snapshot.visibleH1, controls: snapshot.controls };
    }

    if (action === 'open_artifact') {
      const taskId = String(input.taskId || '');
      if (!/^[a-f0-9-]{36}$/i.test(taskId)) throw new Error('Task id is invalid');
      const resolved = await resolveArtifact(taskId, String(input.path || ''));
      if (!resolved.mediaType.startsWith('text/html')) throw new Error('Only HTML task files can open in the cloud browser');
      if (await screenOwner(screenId) !== 'agent') throw new Error('The user currently controls this computer');
      await browserPage.goto(pathToFileURL(resolved.real).href, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    } else if (['click', 'fill', 'select', 'check', 'uncheck', 'press'].includes(action)) {
      const locator = browserLocator(browserPage, input);
      const count = await locator.count();
      if (count !== 1) throw new Error(`Browser target matched ${count} controls; inspect the page and choose a unique label or selector`);
      if (await screenOwner(screenId) !== 'agent') throw new Error('The user currently controls this computer');
      if (action === 'click') await locator.click({ timeout: 10_000 });
      else if (action === 'fill') {
        const value = String(input.value ?? '');
        if (value.length > 10_000) throw new Error('Browser input is too long');
        await locator.fill(value, { timeout: 10_000 });
      } else if (action === 'select') {
        const value = String(input.value ?? '');
        if (!value || value.length > 256) throw new Error('Select value is invalid');
        await locator.selectOption(value, { timeout: 10_000 });
      } else if (action === 'check') await locator.check({ timeout: 10_000 });
      else if (action === 'uncheck') await locator.uncheck({ timeout: 10_000 });
      else {
        const key = String(input.key || '');
        const allowedKeys = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Space', 'Control+A', 'Meta+A']);
        if (!allowedKeys.has(key)) throw new Error('Unsupported browser key');
        await locator.press(key, { timeout: 10_000 });
      }
    } else throw new Error('Unsupported Agent browser action');

    const title = await browserPage.title();
    await desktopActionGate(() => withFocusedDesktopPage(browserPage, async () => undefined));
    return { ready: true, action, url: safePageUrl(browserPage.url()), title: title.slice(0, 300) };
  });
}

function guardedComputerFor(screenId) {
  let computer = guardedComputers.get(screenId);
  if (computer) return computer;
  computer = createGuardedComputer({
    readOwner: () => screenOwners.get(screenId) || 'agent',
    readPageUrl: async () => (await pageForScreen(screenId)).url(),
    readScreenshot: () => screenshot(screenId),
    perform: async input => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid guarded action');
      const { kind, taskId, ...parameters } = input;
      if (kind === 'browser' && /^[a-f0-9-]{36}$/i.test(String(taskId || '')) && ['navigate','open_artifact','click','fill','select','check','uncheck','press'].includes(parameters.action)) return agentBrowserAction({ ...parameters, taskId }, screenId);
      if (kind === 'desktop' && ['click','type','press'].includes(parameters.action)) return command({ ...parameters, actor:'agent' }, screenId);
      throw new Error('Unsupported guarded action');
    },
  });
  guardedComputers.set(screenId, computer);
  return computer;
}

http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    if (req.method === 'GET' && pathname === '/healthz') return send(res, 200, { ok: true });
    if (req.method === 'GET' && pathname === '/readyz') {
      try {
        if (!await rendererResponds()) return send(res, 503, { ok: false, code: 'DOTS_RENDERER_UNRESPONSIVE', error: '云电脑里的 Chromium 页面无响应，系统正在自动恢复' });
        await exec('xdpyinfo', ['-display', process.env.DISPLAY || ':1'], { timeout: 1500 });
        const agent = await fetch(new URL('/healthz',agentEndpoint), { signal: AbortSignal.timeout(1500) });
        if (!agent.ok) return send(res, 503, { ok: false });
        return send(res, 200, { ok: true });
      } catch (error) {
        const contextUnavailable = error instanceof BrowserContextNotReadyError;
        return send(res, 503, { ok: false, ...(contextUnavailable ? { code: error.code, error: error.message } : {}) });
      }
    }
    const isControl = guardedMode && req.headers.authorization === `Bearer ${controlToken}`;
    const isWorker = req.headers.authorization === `Bearer ${token}`;
    if (!isControl && !isWorker) return send(res, 401, { error: 'worker token is required' });
    if (guardedMode && !isControl && !(req.method === 'GET' && pathname === '/v1/control')) return send(res, 403, { error: 'control authorization is required' });
    const needsScreen = pathname.startsWith('/v1/guarded/') || ['/v1/control','/v1/state','/v1/screenshot','/v1/commands','/v1/browser'].includes(pathname);
    const screenId = needsScreen ? screenIdFromRequest(req) : null;
    const guardedComputer = screenId ? guardedComputerFor(screenId) : null;
    if (screenId) await screenOwner(screenId);
    if (guardedMode && isControl && req.method === 'GET' && pathname === '/v1/guarded/control') return send(res, 200, {owner:await screenOwner(screenId)});
    if (guardedMode && isControl && req.method === 'GET' && pathname === '/v1/guarded/viewport') {
      if (await screenOwner(screenId) !== 'user') throw new Error('The user does not control this computer');
      const {left,top,width,height}=await screenPages.geometry(screenId);
      return send(res, 200, {left,top,width,height});
    }
    if (guardedMode && isControl && req.method === 'GET' && pathname === '/v1/guarded/snapshot') return send(res, 200, await guardedComputer.snapshot());
    if (guardedMode && isControl && req.method === 'GET' && pathname === '/v1/guarded/snapshot-image') return send(res, 200, await guardedComputer.snapshotWithImage());
    if (guardedMode && isControl && req.method === 'GET' && pathname === '/v1/guarded/inspect') return await guardedComputer.locked(async () => send(res, 200, await agentBrowserAction({action:'inspect'}, screenId)));
    if (guardedMode && isControl && req.method === 'GET' && pathname === '/v1/guarded/screenshot') return await guardedComputer.locked(async () => {
      if (await screenOwner(screenId) !== 'agent') throw new Error('The user currently controls this computer');
      return send(res, 200, await screenshot(screenId), 'image/png');
    });
    if (guardedMode && isControl && req.method === 'POST' && pathname === '/v1/guarded/execute') {
      const input = await body(req);
      return send(res, 200, await guardedComputer.execute(input.action, input.expected));
    }
    if (req.method === 'GET' && pathname === '/v1/artifacts') {
      const taskId = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('taskId') || '';
      return send(res, 200, { artifacts: await listArtifacts(taskId) });
    }
    if (req.method === 'GET' && pathname === '/v1/artifact') {
      const query = new URL(req.url || '/', 'http://127.0.0.1').searchParams;
      const artifact = await readArtifact(query.get('taskId') || '', query.get('path') || '');
      const safeName = encodeURIComponent(artifact.name);
      res.writeHead(200, {
        'content-type': artifact.mediaType, 'content-length': artifact.bytes.length, 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'x-dots-artifact-name': safeName, 'x-dots-artifact-previewable': String(artifact.previewable),
      });
      res.end(artifact.bytes);
      return;
    }
    if (req.method === 'GET' && pathname === '/v1/control') return send(res, 200, { owner:await screenOwner(screenId) });
    if (req.method === 'POST' && pathname === '/v1/control') {
      const input = await body(req);
      if (input.owner !== 'agent' && input.owner !== 'user') return send(res, 400, { error: 'invalid control owner' });
      return await guardedComputer.locked(async () => {
        await desktopActionGate(() => setScreenOwner(screenId, input.owner));
        if (input.owner === 'user') {
          await fetch(new URL('/v1/tasks/pause',agentEndpoint), {
            method: 'POST', headers: { authorization: `Bearer ${process.env.DOTS_AGENT_RUNTIME_TOKEN}`,'content-type':'application/json' }, body:JSON.stringify({botId:screenId}), signal: AbortSignal.timeout(1500),
          }).catch(() => undefined);
        }
        return send(res, 200, { owner:input.owner });
      });
    }
    if (req.method === 'GET' && pathname === '/v1/state') {
      const state = await rendererHealth.run(async () => {
        const browserPage = await pageForScreen(screenId);
        return { ready: true, owner:await screenOwner(screenId), url: browserPage.url(), title: await browserPage.title() };
      });
      return send(res, 200, state);
    }
    if (req.method === 'GET' && pathname === '/v1/screenshot') return send(res, 200, await screenshot(screenId), 'image/png');
    if (req.method === 'POST' && pathname === '/v1/commands') {
      const input=await body(req);
      if (guardedMode && input.actor !== 'user') return send(res, 403, {error:'Guarded actions require approval'});
      return await guardedComputer.locked(async () => send(res, 200, await command(input,screenId)));
    }
    if (req.method === 'POST' && pathname === '/v1/browser') {
      if (guardedMode) return send(res, 403, {error:'Guarded actions require approval'});
      return await guardedComputer.locked(async () => send(res, 200, await agentBrowserAction(await body(req),screenId)));
    }
    return send(res, 404, { error: 'not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'computer command failed';
    const contextUnavailable = error instanceof BrowserContextNotReadyError;
    const rendererUnresponsive = error instanceof RendererUnresponsiveError;
    const screenCapacity = error instanceof BotScreenCapacityError;
    if (rendererUnresponsive) {
      rendererHealth.fail();
      void recoverChromium();
    }
    return send(res, contextUnavailable || rendererUnresponsive || screenCapacity ? 503 : 400, {
      error: message.slice(0, 240),
      ...(contextUnavailable || rendererUnresponsive || screenCapacity ? { code: error.code } : {}),
    });
  }
}).listen(port, '0.0.0.0', () => process.stdout.write(`Dots desktop worker listening on ${port}\n`));
