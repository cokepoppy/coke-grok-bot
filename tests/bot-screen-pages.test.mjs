import test from 'node:test';
import assert from 'node:assert/strict';
import { BotScreenPages } from '../deploy/desktop/bot-screen-pages.mjs';
import { randomUUID } from 'node:crypto';

class FakePage {
  constructor() { this.name = ''; this.href = 'about:blank'; this.closed = false; }
  isClosed() { return this.closed; }
  url() { return this.href; }
  handlers = new Map();
  on(event, handler) { const listeners=this.handlers.get(event)||[];listeners.push(handler);this.handlers.set(event,listeners); }
  mainFrame() { return this; }
  close() { this.closed=true;for(const handler of this.handlers.get('close')||[])handler(); }
  async navigate(href) { this.href=href;this.name='';for(const handler of this.handlers.get('framenavigated')||[])await handler(this); }
  async evaluate(_fn, value) { if (value !== undefined) this.name = value; return this.name; }
}

test('Bot screen IDs bind to distinct pages in one persistent browser context and survive manager restart', async () => {
  const pages = [new FakePage()];
  const context = { pages: () => [...pages], async newPage() { const page = new FakePage(); pages.push(page); return page; } };
  const placed = [], created = [];
  const manager = new BotScreenPages(async () => context, {
    layout: { width: 1440, height: 900, slots: 2, stride: 1472 },
    async createWindow(_context, bounds) { created.push(bounds.slot); return context.newPage(); },
    async placeWindow(page, bounds) { placed.push({ page, slot: bounds.slot, left: bounds.left, width: bounds.width }); },
  }), botA = randomUUID(), botB = randomUUID();
  const [a, b] = await Promise.all([manager.get(botA), manager.get(botB)]);
  assert.notEqual(a, b);
  assert.equal(pages.length, 2);
  assert.deepEqual(created, [1]);
  assert.deepEqual(placed.map(({ slot }) => slot).sort(), [0, 1]);
  assert.equal((await manager.geometry(botA)).left, 0);
  assert.equal((await manager.geometry(botB)).left, 1472);
  a.href = 'https://example.test/a'; b.href = 'https://example.test/b';
  manager.clear();
  assert.equal(await manager.get(botA), a);
  assert.equal(await manager.get(botB), b);
  assert.equal((await manager.get(botA)).url(), 'https://example.test/a');
  assert.equal((await manager.get(botB)).url(), 'https://example.test/b');
  await a.navigate('https://other-origin.example/');
  assert.equal(await manager.get(botA),a,'cross-site navigation must not lose the Bot page binding');
  assert.equal(await a.evaluate(()=>window.name),`coke-grok-screen:${botA}:0`);
});

test('Bot screens fail closed when all configured desktop windows are occupied', async () => {
  const pages = [new FakePage()];
  const context = { pages: () => [...pages], async newPage() { const page = new FakePage(); pages.push(page); return page; } };
  const manager = new BotScreenPages(async () => context, { layout: { width: 1440, height: 900, slots: 1, stride: 1472 } });
  await manager.get(randomUUID());
  await assert.rejects(manager.get(randomUUID()), { code: 'BOT_SCREEN_CAPACITY' });
});

test('a closed Bot screen releases its slot so the same Bot can reopen at full capacity', async () => {
  const pages = [new FakePage()];
  const context = { pages: () => [...pages], async newPage() { const page = new FakePage(); pages.push(page); return page; } };
  const manager = new BotScreenPages(async () => context, { layout: { width: 1440, height: 900, slots: 1, stride: 1472 } });
  const botId = randomUUID();
  const first = await manager.get(botId);
  first.closed = true;

  const reopened = await manager.get(botId);
  assert.notEqual(reopened, first);
  assert.equal((await manager.geometry(botId)).slot, 0);
});

test('a different Bot can use a slot after its prior page closes without another request from that Bot', async () => {
  const pages = [new FakePage()];
  const context = { pages: () => [...pages], async newPage() { const page = new FakePage(); pages.push(page); return page; } };
  const manager = new BotScreenPages(async () => context, { layout: { width: 1440, height: 900, slots: 1, stride: 1472 } });
  const firstBot = randomUUID(), nextBot = randomUUID();
  const firstPage = await manager.get(firstBot);
  firstPage.close();

  const nextPage = await manager.get(nextBot);
  assert.notEqual(nextPage, firstPage);
  assert.equal((await manager.geometry(nextBot)).slot, 0);
});

test('Bot screen manager rejects malformed IDs before accessing a browser context', async () => {
  let calls = 0;
  const manager = new BotScreenPages(async () => { calls++; return { pages: () => [], newPage: async () => new FakePage() }; });
  await assert.rejects(manager.get('not-a-bot'), /Invalid Bot screen id/);
  assert.equal(calls, 0);
});
