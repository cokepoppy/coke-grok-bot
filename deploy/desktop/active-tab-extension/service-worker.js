importScripts('runtime-config.js');

const endpoint = 'http://127.0.0.1:8082/v1/internal/active-tabs';
let syncTimer;
let syncInFlight = Promise.resolve();

async function syncActiveTabs() {
  const [tabs, targets] = await Promise.all([
    chrome.tabs.query({ active: true }),
    chrome.debugger.getTargets(),
  ]);
  const targetByTab = new Map(targets
    .filter(target => target.type === 'page' && Number.isSafeInteger(target.tabId) && typeof target.id === 'string')
    .map(target => [target.tabId, target.id]));
  const windows = tabs
    .filter(tab => Number.isSafeInteger(tab.id) && Number.isSafeInteger(tab.windowId) && tab.windowId >= 0)
    .map(tab => ({ windowId: tab.windowId, targetId: targetByTab.get(tab.id) || null }));
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${self.COKE_GROK_ACTIVE_TAB_BRIDGE_TOKEN}`,
    },
    body: JSON.stringify({ windows }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('active tab snapshot was rejected');
}

function scheduleSync() {
  if (syncTimer !== undefined) return;
  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    syncInFlight = syncInFlight.then(syncActiveTabs).catch(() => {
      setTimeout(scheduleSync, 1000);
    });
  }, 30);
}

chrome.tabs.onActivated.addListener(scheduleSync);
chrome.tabs.onCreated.addListener(scheduleSync);
chrome.tabs.onRemoved.addListener(scheduleSync);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.url) scheduleSync();
});
chrome.windows.onCreated.addListener(scheduleSync);
chrome.windows.onRemoved.addListener(scheduleSync);
chrome.windows.onFocusChanged.addListener(scheduleSync);
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'active-tabs-refresh') scheduleSync();
});
chrome.alarms.create('active-tabs-refresh', { periodInMinutes: 1 });
chrome.runtime.onInstalled.addListener(scheduleSync);
chrome.runtime.onStartup.addListener(scheduleSync);
scheduleSync();
