import { spawn } from 'node:child_process';

const maxScreenshotBytes = 32 * 1024 * 1024;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const desktopKeys = new Map([
  ['Enter', 'Return'], ['Tab', 'Tab'], ['Escape', 'Escape'], ['Backspace', 'BackSpace'], ['Delete', 'Delete'],
  ['ArrowUp', 'Up'], ['ArrowDown', 'Down'], ['ArrowLeft', 'Left'], ['ArrowRight', 'Right'],
  ['PageUp', 'Page_Up'], ['PageDown', 'Page_Down'], ['Home', 'Home'], ['End', 'End'], ['Space', 'space'],
]);

export async function captureDesktopScreen(run, bounds) {
  const rectangle = `${bounds.left},${bounds.top},${bounds.width},${bounds.height}`;
  const result = await run('scrot', ['-a', rectangle, '-'], { encoding: 'buffer', maxBuffer: maxScreenshotBytes, timeout: 5_000 });
  if (!Buffer.isBuffer(result.stdout) || result.stdout.length < pngSignature.length || result.stdout.length > maxScreenshotBytes || !result.stdout.subarray(0, pngSignature.length).equals(pngSignature)) throw new Error('Desktop screenshot is unavailable');
  return result.stdout;
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

export async function withFocusedDesktopPage(page, action) {
  if (!page || typeof page.bringToFront !== 'function' || typeof action !== 'function') throw new Error('A Bot browser page and desktop action are required');
  await page.bringToFront();
  return action();
}

export async function clickDesktop(run, bounds, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) throw new Error('Click coordinates are outside the Bot screen');
  await run('xdotool', ['mousemove', '--sync', String(bounds.left + x), String(bounds.top + y), 'click', '1'], { timeout: 5_000 });
}

export function typeDesktop(spawnProcess, text) {
  if (typeof text !== 'string' || text.length > 2_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('Desktop input is invalid');
  return new Promise((resolve, reject) => {
    const child = spawnProcess('xdotool', ['type', '--clearmodifiers', '--delay', '1', '--file', '-'], { stdio: ['pipe', 'ignore', 'ignore'] });
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve();
    };
    child.once('error', () => finish(new Error('Desktop keyboard input failed')));
    child.once('close', code => finish(code === 0 ? undefined : new Error('Desktop keyboard input failed')));
    child.stdin.once('error', () => finish(new Error('Desktop keyboard input failed')));
    child.stdin.end(text, 'utf8');
  });
}

export async function pressDesktopKey(run, key) {
  const mapped = desktopKeys.get(key);
  if (!mapped) throw new Error('Unsupported desktop key');
  await run('xdotool', ['key', '--clearmodifiers', mapped], { timeout: 5_000 });
}
