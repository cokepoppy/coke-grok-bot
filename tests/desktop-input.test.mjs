import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile, writeFile } from 'node:fs/promises';
import { captureDesktopScreen, clickDesktop, createDesktopActionGate, pressDesktopKey, typeDesktop, withFocusedDesktopPage } from '../deploy/desktop/desktop-input.mjs';

test('desktop screenshot captures only the Bot screen rectangle as PNG bytes', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let call, capturePath;
  const result = await captureDesktopScreen(async (...args) => { call = args; capturePath = args[1][2]; await writeFile(capturePath, png); return { stdout: Buffer.alloc(0) }; }, { left: 1472, top: 0, width: 1440, height: 900 });
  assert.deepEqual(result, png);
  assert.equal(call[0], 'scrot');
  assert.deepEqual(call[1].slice(0, 2), ['-a', '1472,0,1440,900']);
  assert.match(capturePath, /\/coke-grok-screenshot-[^/]+\/capture\.png$/);
  assert.equal(call[2].timeout, 5_000);
  await assert.rejects(readFile(capturePath), { code: 'ENOENT' });
});

test('desktop click routes image coordinates to the Bot X11 region', async () => {
  let call;
  await clickDesktop(async (...args) => { call = args; }, { left: 2944, top: 0, width: 1440, height: 900 }, 72, 91);
  assert.deepEqual(call.slice(0, 2), ['xdotool', ['mousemove', '--sync', '3016', '91', 'click', '1']]);
  await assert.rejects(clickDesktop(async () => {}, { left: 0, top: 0, width: 1440, height: 900 }, 1440, 0), /outside the Bot screen/);
});

test('desktop typing uses xdotool stdin so typed values are not placed in command arguments', async () => {
  let args, typed = '';
  const spawnProcess = (command, parameters) => {
    assert.equal(command, 'xdotool');
    args = parameters;
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdin.on('data', chunk => { typed += chunk.toString('utf8'); });
    child.stdin.on('finish', () => setImmediate(() => child.emit('close', 0, null)));
    return child;
  };
  await typeDesktop(spawnProcess, 'a private value');
  assert.deepEqual(args, ['type', '--clearmodifiers', '--delay', '1', '--file', '-']);
  assert.equal(args.includes('a private value'), false);
  assert.equal(typed, 'a private value');
  assert.throws(() => typeDesktop(spawnProcess, 'bad\u0000value'), /input is invalid/);
});

test('desktop key mapping uses the Linux X key names', async () => {
  const calls = [];
  const run = async (...args) => calls.push(args);
  await pressDesktopKey(run, 'Enter');
  await pressDesktopKey(run, 'ArrowDown');
  assert.deepEqual(calls.map(call => call[1]), [['key', '--clearmodifiers', 'Return'], ['key', '--clearmodifiers', 'Down']]);
  await assert.rejects(pressDesktopKey(run, 'Meta+A'), /Unsupported desktop key/);
});

test('desktop X11 actions serialize focus plus input while allowing async completion', async () => {
  const gate = createDesktopActionGate(), events = [];
  let release;
  const first = gate(async () => { events.push('first-start'); await new Promise(resolve => { release = resolve; }); events.push('first-end'); });
  const second = gate(async () => { events.push('second-start'); });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['first-start']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second-start']);
});

test('desktop typing and keys activate the current Bot page before emitting X11 input', async () => {
  const events=[];
  const page={async bringToFront(){events.push('focus-bot-page')}};
  await withFocusedDesktopPage(page, async()=>events.push('type'));
  await withFocusedDesktopPage(page, async()=>events.push('press'));
  assert.deepEqual(events,['focus-bot-page','type','focus-bot-page','press']);
  await assert.rejects(withFocusedDesktopPage({},async()=>{}),/Bot browser page and desktop action/);
});
