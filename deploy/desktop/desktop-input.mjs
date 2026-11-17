import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const maxScreenshotBytes = 32 * 1024 * 1024;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const desktopKeyAliases = new Map([
  ['Enter', 'Return'], ['Tab', 'Tab'], ['Escape', 'Escape'], ['Backspace', 'BackSpace'], ['Delete', 'Delete'],
  ['ArrowUp', 'Up'], ['ArrowDown', 'Down'], ['ArrowLeft', 'Left'], ['ArrowRight', 'Right'],
  ['PageUp', 'Page_Up'], ['PageDown', 'Page_Down'], ['Home', 'Home'], ['End', 'End'], ['Space', 'space'],
  ['Control', 'ctrl'], ['Ctrl', 'ctrl'], ['Meta', 'super'], ['Super', 'super'], ['Alt', 'alt'], ['Shift', 'shift'],
]);

export async function captureDesktopScreen(run, bounds) {
  const rectangle = `${bounds.left},${bounds.top},${bounds.width},${bounds.height}`;
  const directory = await mkdtemp(join(tmpdir(), 'coke-grok-screenshot-'));
  const file = join(directory, 'capture.png');
  try {
    await run('scrot', ['-a', rectangle, file], { timeout: 5_000 });
    const image = await readFile(file);
    if (image.length < pngSignature.length || image.length > maxScreenshotBytes || !image.subarray(0, pngSignature.length).equals(pngSignature)) throw new Error('Desktop screenshot is unavailable');
    return image;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function captureFocusedDesktopScreen(run, page, bounds, focus = operation => operation()) {
  return withFocusedDesktopPage(page, () => captureDesktopScreen(run, bounds), focus);
}

/** Never raise Chromium while the owner is actively using its desktop. */
export async function captureOwnedDesktopScreen(run, page, bounds, owner, focus = operation => operation()) {
  if (owner === 'user') return captureDesktopScreen(run, bounds);
  if (owner === 'agent') return captureFocusedDesktopScreen(run, page, bounds, focus);
  throw new Error('Computer owner is invalid');
}

export function createDesktopActionGate() {
  let tail = Promise.resolve();
  return async function withGate(action) {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await action(); }
    finally { release(); }
  };
}

/** Share a single physical-screen capture among overlapping readers of one Bot screen. */
export function createScreenCaptureCoalescer(capture) {
  if (typeof capture !== 'function') throw new Error('A screen capture function is required');
  const inFlight = new Map();
  return function captureScreen(screenId) {
    const active = inFlight.get(screenId);
    if (active) return active;
    let request;
    request = Promise.resolve().then(() => capture(screenId)).finally(() => {
      if (inFlight.get(screenId) === request) inFlight.delete(screenId);
    });
    inFlight.set(screenId, request);
    return request;
  };
}

export async function withFocusedDesktopPage(page, action, focus = operation => operation()) {
  if (!page || typeof page.bringToFront !== 'function' || typeof action !== 'function') throw new Error('A Bot browser page and desktop action are required');
  if (typeof focus !== 'function') throw new Error('A Bot page focus guard is required');
  await focus(() => page.bringToFront());
  return action();
}

export async function clickDesktop(run, bounds, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) throw new Error('Click coordinates are outside the Bot screen');
  // xdotool --sync waits for a pointer-moved event. When a click targets the
  // current pointer position no event is emitted, so the otherwise valid click
  // stalls until the command timeout. A single xdotool process preserves
  // request ordering without --sync, including for same-coordinate clicks.
  await run('xdotool', ['mousemove', String(bounds.left + x), String(bounds.top + y), 'click', '1'], { timeout: 5_000 });
}

export function typeDesktop(spawnProcess, text, { timeoutMs = 10_000, killGraceMs = 1_000 } = {}) {
  if (typeof text !== 'string' || text.length > 2_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('Desktop input is invalid');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(killGraceMs) || killGraceMs < 1) throw new Error('Desktop keyboard timeout is invalid');
  return new Promise((resolve, reject) => {
    const child = spawnProcess('xdotool', ['type', '--clearmodifiers', '--delay', '1', '--file', '-'], { stdio: ['pipe', 'ignore', 'ignore'] });
    let settled = false, failure, timeout, killTimeout;
    const clearTimers = () => {
      if (timeout) clearTimeout(timeout);
      if (killTimeout) clearTimeout(killTimeout);
    };
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (error) reject(error); else resolve();
    };
    const terminate = error => {
      if (failure) return;
      failure = error;
      try { child.kill('SIGTERM'); } catch { /* Wait for close, then report the original failure. */ }
      killTimeout = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* The child may already have exited. */ }
      }, killGraceMs);
    };
    timeout = setTimeout(() => {
      terminate(new Error('Desktop keyboard input timed out'));
    }, timeoutMs);
    child.once('error', () => terminate(new Error('Desktop keyboard input failed')));
    child.once('close', code => finish(failure || (code === 0 ? undefined : new Error('Desktop keyboard input failed'))));
    child.stdin.once('error', () => terminate(new Error('Desktop keyboard input failed')));
    child.stdin.end(text, 'utf8');
  });
}

export async function pressDesktopKey(run, key) {
  if (typeof key !== 'string' || key.length < 1 || key.length > 256 || /[\u0000-\u001f\u007f]/.test(key)) throw new Error('Desktop key is invalid');
  const mapped = key.split('+').map(part => desktopKeyAliases.get(part) || part).join('+');
  await run('xdotool', ['key', '--clearmodifiers', mapped], { timeout: 5_000 });
}
