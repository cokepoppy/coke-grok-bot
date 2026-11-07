const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class BotScreenCapacityError extends Error {
  constructor() { super('This user computer has no free Bot screen slot'); this.name = 'BotScreenCapacityError'; this.code = 'BOT_SCREEN_CAPACITY'; }
}

export class ActiveTabResolutionError extends Error {
  constructor() { super('The active Chrome tab could not be identified safely'); this.name = 'ActiveTabResolutionError'; this.code = 'ACTIVE_TAB_UNRESOLVED'; }
}

/** Separate Bot browser windows inside one persistent browser context/profile. */
export class BotScreenPages {
  constructor(contextProvider, options = {}) {
    const { marker = 'coke-grok-screen:', layout = { width: 1440, height: 900, slots: 1, stride: 1472 }, createWindow, placeWindow, getWindowId = browserWindowId, getTargetId = browserTargetId, getActiveTarget = noActiveTarget, getFocusedWindow = noFocusedWindow } = options;
    if (typeof contextProvider !== 'function' || typeof marker !== 'string' || !marker || !Number.isSafeInteger(layout?.slots) || layout.slots < 1 || layout.slots > 16 || !Number.isSafeInteger(layout.width) || !Number.isSafeInteger(layout.height) || typeof getWindowId !== 'function' || typeof getTargetId !== 'function' || typeof getActiveTarget !== 'function' || typeof getFocusedWindow !== 'function') throw new Error('Invalid Bot screen page manager');
    this.contextProvider = contextProvider;
    this.marker = marker;
    this.layout = layout;
    this.createWindow = createWindow;
    this.placeWindow = placeWindow;
    this.getWindowId = getWindowId;
    this.getTargetId = getTargetId;
    this.getActiveTarget = getActiveTarget;
    this.getFocusedWindow = getFocusedWindow;
    this.pages = new Map();
    this.slots = new Map();
    this.pending = new Map();
    this.boundPages = new WeakSet();
    this.windowIds = new WeakMap();
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

  /** Return the selected Chrome tab in this Bot's window, preserving per-Bot window isolation. */
  async active(screenId) {
    const mapped = await this.get(screenId);
    const context = await this.contextProvider();
    const windowId = await this.windowId(mapped);
    if (windowId === null || windowId === undefined) return mapped;

    const candidates = [];
    for (const candidate of context.pages()) {
      if (candidate.isClosed()) continue;
      if (await this.windowId(candidate) === windowId) candidates.push(candidate);
    }

    let selected = null;
    const activeTarget = await this.getActiveTarget(windowId);
    if (activeTarget !== undefined) {
      if (typeof activeTarget !== 'string') throw new ActiveTabResolutionError();
      for (const candidate of candidates) {
        try {
          if (await this.getTargetId(candidate) === activeTarget) { selected = candidate; break; }
        } catch { /* A closing or navigating page is not selectable. */ }
      }
      if (!selected) throw new ActiveTabResolutionError();
    }

    const slot = this.slots.get(screenId);
    if (!selected && Number.isSafeInteger(slot)) {
      let focusedWindow;
      try { focusedWindow = await this.getFocusedWindow(); } catch { /* CDP and page activity remain the fallback. */ }
      if (focusedWindowMatchesScreen(focusedWindow, this.bounds(slot))) {
        const focusedTitle = String(focusedWindow.title || '').trim().toLocaleLowerCase();
        if (focusedTitle) {
          const matches = [];
          for (const candidate of candidates) {
            let title = '';
            try { title = await candidate.title(); } catch { /* A closing tab has no usable title. */ }
            if (title && focusedTitle.includes(title.trim().toLocaleLowerCase())) matches.push(candidate);
          }
          if (matches.length === 1) selected = matches[0];
        }
      }
    }

    if (!selected && candidates.length === 1) selected = candidates[0];
    if (!selected) throw new ActiveTabResolutionError();

    if (selected !== mapped) {
      const slot = this.slots.get(screenId);
      if (!Number.isSafeInteger(slot)) return mapped;
      const markerValue = `${this.marker}${screenId}:${slot}`;
      this.bind(selected, markerValue);
      await selected.evaluate(value => { window.name = value; }, markerValue).catch(() => {});
      this.pages.set(screenId, selected);
    }
    return selected;
  }

  async windowId(page) {
    if (this.windowIds.has(page)) return this.windowIds.get(page);
    let id = null;
    try { id = await this.getWindowId(page); } catch { /* Fall back to the Bot's original page if CDP cannot identify this tab. */ }
    if (id !== null && id !== undefined) this.windowIds.set(page, id);
    return id;
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
    this.windowIds = new WeakMap();
  }
}

async function browserWindowId(page) {
  const context = page.context();
  const session = await context.newCDPSession(page);
  try {
    const result = await session.send('Browser.getWindowForTarget');
    return Number.isSafeInteger(result?.windowId) ? result.windowId : null;
  } finally { await session.detach().catch(() => undefined); }
}

async function browserTargetId(page) {
  const session = await page.context().newCDPSession(page);
  try {
    const result = await session.send('Target.getTargetInfo');
    return typeof result?.targetInfo?.targetId === 'string' ? result.targetInfo.targetId : null;
  } finally { await session.detach().catch(() => undefined); }
}

async function noFocusedWindow() { return null; }
async function noActiveTarget() { return undefined; }

function focusedWindowMatchesScreen(windowInfo, bounds) {
  if (!windowInfo || ![windowInfo.x, windowInfo.y, windowInfo.width, windowInfo.height].every(Number.isFinite) || windowInfo.width <= 0 || windowInfo.height <= 0) return false;
  const overlapX = Math.max(0, Math.min(windowInfo.x + windowInfo.width, bounds.left + bounds.width) - Math.max(windowInfo.x, bounds.left));
  const overlapY = Math.max(0, Math.min(windowInfo.y + windowInfo.height, bounds.top + bounds.height) - Math.max(windowInfo.y, bounds.top));
  return overlapX >= bounds.width * 0.65 && overlapY >= bounds.height * 0.65;
}
