/**
 * AmazonEnhanced — background.js (MV3 service worker)
 *
 * Responsibilities:
 *   - Seed default settings on install.
 *   - Relay popup <-> active-tab messages.
 */

let defaultSettingsPromise = null;

async function getDefaultSettings() {
  if (!defaultSettingsPromise) {
    defaultSettingsPromise = fetch(chrome.runtime.getURL('defaults.json')).then((res) => {
      if (!res.ok) throw new Error('Failed to load defaults.json');
      return res.json();
    });
  }
  return structuredClone(await defaultSettingsPromise);
}

function mergeSettings(defaults, saved) {
  const merged = Object.assign({}, defaults, saved || {});
  merged.flags = Object.assign({}, defaults.flags, (saved && saved.flags) || {});
  return merged;
}

const DB_NAME = 'AmazonEnhancedDB';
const DB_VERSION = 1;
const PRICE_HISTORY_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const WATCHED_ORDER_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
let dbPromise = null;
let legacyStorageMigrationPromise = null;
let retentionPurgePromise = null;

function normalizeAsin(asin) {
  return String(asin || '').toUpperCase();
}

function toFiniteTimestamp(value) {
  const ts = Number(value);
  return Number.isFinite(ts) && ts > 0 ? ts : 0;
}

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('priceHistory')) {
          db.createObjectStore('priceHistory', { keyPath: 'asin' });
        }
        if (!db.objectStoreNames.contains('origins')) {
          db.createObjectStore('origins', { keyPath: 'asin' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTransactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function idbGet(storeName, key) {
  const db = await openDb();
  return idbRequest(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
}

async function idbGetAll(storeName) {
  const db = await openDb();
  return idbRequest(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

async function idbPut(storeName, value) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  return idbTransactionDone(tx);
}

async function idbClear(storeName) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  return idbTransactionDone(tx);
}

async function migrateLegacyStorageToIndexedDb() {
  if (!legacyStorageMigrationPromise) {
    legacyStorageMigrationPromise = (async () => {
      const legacy = await chrome.storage.local.get(['amzePriceHistory', 'amzeOrigins']);
      const keysToRemove = [];
      if (legacy.amzePriceHistory && typeof legacy.amzePriceHistory === 'object') {
        for (const [asin, points] of Object.entries(legacy.amzePriceHistory)) {
          if (Array.isArray(points)) {
            await idbPut('priceHistory', { asin: normalizeAsin(asin), points });
          }
        }
        keysToRemove.push('amzePriceHistory');
      }
      if (legacy.amzeOrigins && typeof legacy.amzeOrigins === 'object') {
        for (const [asin, entry] of Object.entries(legacy.amzeOrigins)) {
          if (entry && entry.country) {
            await idbPut('origins', {
              asin: normalizeAsin(asin),
              country: String(entry.country),
              ts: entry.ts || Date.now()
            });
          }
        }
        keysToRemove.push('amzeOrigins');
      }
      if (keysToRemove.length) await chrome.storage.local.remove(keysToRemove);
    })().catch(() => {});
  }
  return legacyStorageMigrationPromise;
}

async function readOriginCache() {
  await migrateLegacyStorageToIndexedDb();
  const entries = await idbGetAll('origins');
  return entries.reduce((map, entry) => {
    map[entry.asin] = { country: entry.country, ts: entry.ts };
    return map;
  }, {});
}

async function writeOriginCache(asin, country) {
  const key = normalizeAsin(asin);
  if (!key || !country) return;
  await migrateLegacyStorageToIndexedDb();
  await idbPut('origins', {
    asin: key,
    country: String(country),
    ts: Date.now()
  });
}

async function readPriceHistory(asin) {
  const key = normalizeAsin(asin);
  if (!key) return [];
  await migrateLegacyStorageToIndexedDb();
  const record = await idbGet('priceHistory', key);
  return record && Array.isArray(record.points) ? record.points : [];
}

async function writePriceHistory(asin, points) {
  const key = normalizeAsin(asin);
  if (!key) return;
  await migrateLegacyStorageToIndexedDb();
  await idbPut('priceHistory', {
    asin: key,
    points: Array.isArray(points) ? points : []
  });
}

async function purgePriceHistoryRetention(now = Date.now()) {
  await migrateLegacyStorageToIndexedDb();
  const cutoff = now - PRICE_HISTORY_RETENTION_MS;
  const entries = await idbGetAll('priceHistory');
  const entriesToPut = [];
  const keysToDelete = [];

  for (const entry of entries) {
    const key = normalizeAsin(entry && entry.asin);
    if (!key) continue;
    const points = Array.isArray(entry.points) ? entry.points : [];
    const retained = points.filter((point) => toFiniteTimestamp(point && point.t) >= cutoff);
    if (retained.length === points.length) continue;
    if (retained.length) {
      entriesToPut.push({ asin: key, points: retained });
    } else {
      keysToDelete.push(key);
    }
  }

  if (!entriesToPut.length && !keysToDelete.length) return;

  const db = await openDb();
  const tx = db.transaction('priceHistory', 'readwrite');
  const store = tx.objectStore('priceHistory');
  for (const entry of entriesToPut) store.put(entry);
  for (const key of keysToDelete) store.delete(key);
  await idbTransactionDone(tx);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const defaults = await getDefaultSettings();
  const { amzeSettings } = await chrome.storage.local.get(['amzeSettings']);
  if (!amzeSettings) {
    await chrome.storage.local.set({ amzeSettings: defaults });
  } else {
    // Forward-migrate: ensure all flags exist.
    const merged = mergeSettings(defaults, amzeSettings);
    await chrome.storage.local.set({ amzeSettings: merged });
  }
  await scheduleRetentionPurge();
});

// -------------------------------------------------------------------
// v2.0: Late-delivery watcher
//
// Content script on /your-orders sends AMZE_SEED_ORDERS with each
// visible order's promised delivery date. We persist those to
// chrome.storage.local and a daily alarm checks for any whose
// promise date has passed without appearing as "Delivered" in a
// subsequent visit. Notification fires once per order.
// -------------------------------------------------------------------

async function readWatchedOrders() {
  const r = await chrome.storage.local.get(['amzeWatchedOrders']);
  return r.amzeWatchedOrders || {};
}
async function writeWatchedOrders(map) {
  await chrome.storage.local.set({ amzeWatchedOrders: map });
}

function parsePromisedDate(text) {
  if (!text) return null;
  // Common formats: "Arriving Monday, Apr 14", "Delivered Apr 8",
  // "Expected delivery: Apr 14", "Arriving by Wed, Apr 16".
  const now = new Date();
  const m = text.match(/([A-Z][a-z]+)\s+(\d{1,2})(?:\s*,\s*(\d{4}))?/);
  if (!m) return null;
  const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
    .indexOf(m[1].toLowerCase().slice(0, 3));
  if (month < 0) return null;
  const day = parseInt(m[2], 10);
  let year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
  const d = new Date(year, month, day);
  // If parsed date is in the past by more than 6 months, assume next year.
  if ((now - d) > 1000 * 60 * 60 * 24 * 180) d.setFullYear(year + 1);
  return d;
}

function getWatchedOrderRetentionTimestamp(rec) {
  const seenAt = toFiniteTimestamp(rec && rec.seenAt);
  if (seenAt) return seenAt;
  const promised = parsePromisedDate(rec && rec.promise);
  return promised ? promised.getTime() : 0;
}

async function purgeWatchedOrderRetention(now = Date.now()) {
  const map = await readWatchedOrders();
  const cutoff = now - WATCHED_ORDER_RETENTION_MS;
  let dirty = false;

  for (const [id, rec] of Object.entries(map)) {
    if (getWatchedOrderRetentionTimestamp(rec) >= cutoff) continue;
    delete map[id];
    dirty = true;
  }

  if (dirty) await writeWatchedOrders(map);
}

async function purgeRetainedData(now = Date.now()) {
  await Promise.all([
    purgePriceHistoryRetention(now),
    purgeWatchedOrderRetention(now)
  ]);
}

async function clearLocalDataCaches() {
  await Promise.all([
    idbClear('priceHistory'),
    idbClear('origins'),
    chrome.storage.local.remove(['amzePriceHistory', 'amzeOrigins', 'amzeWatchedOrders'])
  ]);
}

function scheduleRetentionPurge() {
  if (!retentionPurgePromise) {
    retentionPurgePromise = purgeRetainedData()
      .catch(() => {})
      .finally(() => { retentionPurgePromise = null; });
  }
  return retentionPurgePromise;
}

async function scanLateOrders() {
  const { amzeSettings } = await chrome.storage.local.get(['amzeSettings']);
  if (!amzeSettings || !amzeSettings.flags || !amzeSettings.flags.lateDeliveryWatch) return;
  const map = await readWatchedOrders();
  const now = Date.now();
  const dirty = [];
  for (const [id, rec] of Object.entries(map)) {
    if (rec.notified) continue;
    const promised = parsePromisedDate(rec.promise);
    if (!promised) continue;
    // Late if promised +1 day and status doesn't contain "delivered"
    if (now > promised.getTime() + 86400000 && !/delivered/i.test(rec.status || '')) {
      rec.notified = true;
      dirty.push(id);
      try {
        chrome.notifications.create('amze-late-' + id, {
          type: 'basic',
          iconUrl: 'icons/128.png',
          title: 'Amazon order is late',
          message: `Order ${id} was promised by ${rec.promise}. You may be eligible for Prime credit.`,
          priority: 2
        });
      } catch (e) {}
    }
  }
  if (dirty.length) await writeWatchedOrders(map);
}

chrome.alarms.create('amze-late-watch', { periodInMinutes: 60 * 6, delayInMinutes: 5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'amze-late-watch') {
    scheduleRetentionPurge().finally(() => scanLateOrders());
  }
});

chrome.runtime.onStartup.addListener(() => {
  scheduleRetentionPurge();
});

scheduleRetentionPurge();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'AMZE_IDB_GET_ORIGINS') {
    (async () => {
      const origins = await readOriginCache();
      sendResponse({ ok: true, origins });
    })().catch(() => sendResponse({ ok: false, origins: {} }));
    return true;
  }

  if (msg.type === 'AMZE_IDB_PUT_ORIGIN') {
    (async () => {
      await writeOriginCache(msg.asin, msg.country);
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'AMZE_IDB_GET_PRICE_HISTORY') {
    (async () => {
      const points = await readPriceHistory(msg.asin);
      sendResponse({ ok: true, points });
    })().catch(() => sendResponse({ ok: false, points: [] }));
    return true;
  }

  if (msg.type === 'AMZE_IDB_PUT_PRICE_HISTORY') {
    (async () => {
      await writePriceHistory(msg.asin, msg.points);
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'AMZE_CLEAR_LOCAL_DATA') {
    (async () => {
      await clearLocalDataCaches();
      sendResponse({ ok: true, cleared: ['priceHistory', 'origins', 'watchedOrders'] });
    })().catch(() => sendResponse({ ok: false, cleared: [] }));
    return true;
  }

  if (msg.type === 'AMZE_SEED_ORDERS') {
    (async () => {
      const map = await readWatchedOrders();
      for (const o of (msg.orders || [])) {
        if (!o.orderId) continue;
        const existing = map[o.orderId];
        // Preserve existing notified flag; update promise/status.
        map[o.orderId] = {
          promise: o.promise,
          status: o.status,
          seenAt: o.seenAt || Date.now(),
          notified: existing ? existing.notified : false
        };
      }
      await writeWatchedOrders(map);
      sendResponse({ ok: true, count: (msg.orders || []).length });
    })();
    return true;
  }

  if (msg.type === 'AMZE_BROADCAST_SETTINGS') {
    // Popup requested broadcast to all Amazon tabs.
    chrome.tabs.query({ url: [
      '*://*.amazon.com/*', '*://*.amazon.co.uk/*', '*://*.amazon.ca/*',
      '*://*.amazon.de/*', '*://*.amazon.fr/*', '*://*.amazon.it/*',
      '*://*.amazon.es/*', '*://*.amazon.nl/*', '*://*.amazon.pl/*',
      '*://*.amazon.se/*', '*://*.amazon.com.tr/*', '*://*.amazon.in/*',
      '*://*.amazon.co.jp/*', '*://*.amazon.com.au/*', '*://*.amazon.com.mx/*',
      '*://*.amazon.com.br/*', '*://*.amazon.sg/*', '*://*.amazon.sa/*',
      '*://*.amazon.ae/*', '*://*.amazon.eg/*'
    ]}, (tabs) => {
      for (const t of tabs) {
        chrome.tabs.sendMessage(t.id, { type: 'AMZE_SETTINGS_UPDATED', settings: msg.settings }).catch(() => {});
      }
      sendResponse({ ok: true, count: tabs.length });
    });
    return true;
  }
});
