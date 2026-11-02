const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class BotScreenCapacityError extends Error {
  constructor() { super('This user computer has no free Bot screen slot'); this.name = 'BotScreenCapacityError'; this.code = 'BOT_SCREEN_CAPACITY'; }
}

/** Separate Bot browser windows inside one persistent browser context/profile. */
export class BotScreenPages {
  constructor(contextProvider, options = {}) {
    const { marker = 'coke-grok-screen:', layout = { width: 1440, height: 900, slots: 1, stride: 1472 }, createWindow, placeWindow } = options;
    if (typeof contextProvider !== 'function' || typeof marker !== 'string' || !marker || !Number.isSafeInteger(layout?.slots) || layout.slots < 1 || layout.slots > 16 || !Number.isSafeInteger(layout.width) || !Number.isSafeInteger(layout.height)) throw new Error('Invalid Bot screen page manager');
    this.contextProvider = contextProvider;
    this.marker = marker;
    this.layout = layout;
    this.createWindow = createWindow;
    this.placeWindow = placeWindow;
    this.pages = new Map();
    this.slots = new Map();
    this.pending = new Map();
    this.boundPages = new WeakSet();
    this.allocation = Promise.resolve();
  }

  bind(page, markerValue) {
    if (this.boundPages.has(page)) return;
    this.boundPages.add(page);
    const screenId = markerValue.slice(this.marker.length).split(':', 1)[0];
    page.on('close', () => {
      if (this.pages.get(screenId) !== page) return;
      this.pages.delete(screenId);
      this.slots.delete(screenId);
    });
    // Chromium may clear window.name on a cross-site top-level navigation.
    // Reapply the non-secret screen marker so the page can be rediscovered
    // after a worker reconnect while preserving the user's shared profile.
    page.on('framenavigated', frame => {
      if (typeof page.mainFrame === 'function' && frame !== page.mainFrame()) return;
      void page.evaluate(value => { window.name = value; }, markerValue).catch(() => {});
    });
  }

  async get(screenId) {
    if (typeof screenId !== 'string' || !uuid.test(screenId)) throw new Error('Invalid Bot screen id');
    const cached = this.pages.get(screenId);
    if (cached && !cached.isClosed()) {
      const slot = this.slots.get(screenId);
      if (Number.isSafeInteger(slot)) await cached.evaluate(value => { window.name = value; }, `${this.marker}${screenId}:${slot}`).catch(() => {});
      return cached;
    }
    if (this.pending.has(screenId)) return this.pending.get(screenId);
    const pending = this.allocate(screenId).finally(() => {
      if (this.pending.get(screenId) === pending) this.pending.delete(screenId);
    });
    this.pending.set(screenId, pending);
    return pending;
  }

  async allocate(screenId) {
    let release;
    const previous = this.allocation;
    this.allocation = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const cached = this.pages.get(screenId);
      if (cached && !cached.isClosed()) return cached;
      if (cached) {
        this.pages.delete(screenId);
        this.slots.delete(screenId);
      }
      const context = await this.contextProvider();
      const pages = context.pages();
      const openPages = new Set(pages.filter(page => !page.isClosed()));
      const mappedPages = new Set();
      for (const [id, page] of this.pages) {
        if (page.isClosed() || !openPages.has(page)) {
          this.pages.delete(id);
          this.slots.delete(id);
          continue;
        }
        mappedPages.add(page);
        const mappedSlot = this.slots.get(id);
        if (Number.isSafeInteger(mappedSlot)) await page.evaluate(value => { window.name = value; }, `${this.marker}${id}:${mappedSlot}`).catch(() => {});
      }
      const markerValuePrefix = `${this.marker}${screenId}:`;
      for (const page of pages) {
        if (page.isClosed()) continue;
        let name;
        try {
          name = await page.evaluate(() => window.name);
        } catch { /* A closing page cannot be assigned to a screen. */ }
        if (typeof name !== 'string' || !name.startsWith(markerValuePrefix)) continue;
        const slot = Number(name.slice(markerValuePrefix.length));
        if (!Number.isSafeInteger(slot) || slot < 0 || slot >= this.layout.slots) throw new Error('Bot screen slot state is invalid');
        if ([...this.slots.entries()].some(([id, occupied]) => id !== screenId && occupied === slot)) throw new Error('Bot screen slots are duplicated');
        this.bind(page, name);
        await this.place(page, slot);
        this.pages.set(screenId, page);
        this.slots.set(screenId, slot);
        return page;
      }
      const occupied = new Set(this.slots.values());
      for (const candidate of pages) {
        if (candidate.isClosed()) continue;
        let name;
        try {
          name = await candidate.evaluate(() => window.name);
        } catch { /* A closing page cannot occupy a desktop slot. */ }
        if (typeof name !== 'string' || !name.startsWith(this.marker)) continue;
        const suffix = name.slice(this.marker.length);
        const split = suffix.lastIndexOf(':');
        if (split < 0 || !uuid.test(suffix.slice(0, split))) continue;
        const slot = Number(suffix.slice(split + 1));
        if (!Number.isSafeInteger(slot) || slot < 0 || slot >= this.layout.slots) throw new Error('Bot screen slot state is invalid');
        occupied.add(slot);
      }
      const slot = Array.from({ length: this.layout.slots }, (_, index) => index).find(index => !occupied.has(index));
      if (slot === undefined) throw new BotScreenCapacityError();
      let page = null;
      if (pages.length === 1 && !pages[0].isClosed() && !mappedPages.has(pages[0])) {
        try {
          const name = await pages[0].evaluate(() => window.name);
          if (!name || !String(name).startsWith(this.marker)) page = pages[0];
        } catch { /* A closing page cannot be assigned to a screen. */ }
      }
      if (!page && typeof this.createWindow === 'function') page = await this.createWindow(context, this.bounds(slot));
      if (!page) page = await context.newPage();
      const markerValue = `${this.marker}${screenId}:${slot}`;
      this.bind(page, markerValue);
      await this.place(page, slot);
      await page.evaluate(value => { window.name = value; }, markerValue);
      this.pages.set(screenId, page);
      this.slots.set(screenId, slot);
      return page;
    } finally { release(); }
  }

  bounds(slot) {
    return { slot, left: slot * this.layout.stride, top: 0, width: this.layout.width, height: this.layout.height };
  }

  async place(page, slot) {
    if (typeof this.placeWindow === 'function') await this.placeWindow(page, this.bounds(slot));
  }

  async geometry(screenId) {
    await this.get(screenId);
    const slot = this.slots.get(screenId);
    if (!Number.isSafeInteger(slot)) throw new Error('Bot screen layout is unavailable');
    return this.bounds(slot);
  }

  clear() {
    this.pages.clear();
    this.slots.clear();
    this.pending.clear();
  }
}
