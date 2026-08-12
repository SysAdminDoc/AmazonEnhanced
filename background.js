importScripts('price-history-io.js');
importScripts('wishlist-import.js');
importScripts('feature-modules.js');
importScripts('service-worker-warm.js');

/**
 * AmazonEnhanced — background.js (MV3 service worker)
 *
 * Responsibilities:
 *   - Seed default settings on install.
 *   - Relay popup <-> active-tab messages.
 */

let defaultSettingsPromise = null;
let localePatternsPromise = null;

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
  merged.settingsVersion = defaults.settingsVersion;
  return merged;
}

// -------------------------------------------------------------------
// Structured settings migration
//
// Each entry in SETTINGS_MIGRATIONS maps a version number to a
// migration function: (settings) => settings. Migrations run
// sequentially from the saved settingsVersion up to the current one.
// This enables safe renames, removals, and structural changes.
// -------------------------------------------------------------------

const SETTINGS_MIGRATIONS = {
  // Version 0 → 1: initial schema version stamp. No structural changes
  // needed; the mergeSettings forward-merge covers new flags.
};

function migrateSettings(settings, targetVersion) {
  let v = (settings && typeof settings.settingsVersion === 'number')
    ? settings.settingsVersion
    : 0;
  while (v < targetVersion) {
    const fn = SETTINGS_MIGRATIONS[v];
    if (typeof fn === 'function') {
      settings = fn(settings);
    }
    v++;
    settings.settingsVersion = v;
  }
  return settings;
}

async function getAmazonUrlPatterns() {
  if (!localePatternsPromise) {
    localePatternsPromise = fetch(chrome.runtime.getURL('locales.json'))
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load locales.json');
        return res.json();
      })
      .then((data) => {
        const patterns = (data.locales || []).map(entry => entry.pattern).filter(Boolean);
        return patterns.length ? patterns : ['*://*.amazon.com/*'];
      })
      .catch(() => ['*://*.amazon.com/*']);
  }
  return localePatternsPromise;
}

const DB_NAME = 'AmazonEnhancedDB';
const DB_VERSION = 2;
const PRICE_HISTORY_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const WATCHED_ORDER_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const SELLER_LOOKUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SELLER_LOOKUP_MIN_INTERVAL_MS = 15 * 1000;
let dbPromise = null;
let legacyStorageMigrationPromise = null;
let retentionPurgePromise = null;
let lastSellerLookupAt = 0;

const WISHLIST_IMPORT_DELAY_MS = 1800;
const WISHLIST_IMPORT_RESPONSE_TIMEOUT_MS = 12000;
const WISHLIST_IMPORT_MAX_DISPATCH_ATTEMPTS = 5;
const wishlistImportJobs = new Map();

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
        if (!db.objectStoreNames.contains('sellerLookups')) {
          db.createObjectStore('sellerLookups', { keyPath: 'key' });
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

function normalizeSellerLookupKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|store|shop|seller|official|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function normalizeSellerLookupName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function mapJurisdictionCountry(code) {
  const normalized = String(code || '').toLowerCase();
  if (!normalized) return '';
  const first = normalized.split('_')[0].split('-')[0];
  const countries = {
    au: 'Australia',
    br: 'Brazil',
    ca: 'Canada',
    de: 'Germany',
    es: 'Spain',
    fr: 'France',
    gb: 'United Kingdom',
    ie: 'Ireland',
    in: 'India',
    it: 'Italy',
    jp: 'Japan',
    mx: 'Mexico',
    nl: 'Netherlands',
    pl: 'Poland',
    se: 'Sweden',
    sg: 'Singapore',
    tr: 'Turkey',
    us: 'United States'
  };
  return countries[first] || first.toUpperCase();
}

function mapOpenCorporatesCompany(company, sellerName) {
  const c = company || {};
  const jurisdictionCode = String(c.jurisdiction_code || '');
  return {
    sellerName: normalizeSellerLookupName(sellerName),
    companyName: String(c.name || '').slice(0, 180),
    jurisdictionCode,
    country: mapJurisdictionCountry(jurisdictionCode),
    status: String(c.current_status || '').slice(0, 80),
    companyType: String(c.company_type || '').slice(0, 80),
    url: String(c.opencorporates_url || '').slice(0, 300),
    fetchedAt: Date.now()
  };
}

async function readSellerLookup(sellerName) {
  const key = normalizeSellerLookupKey(sellerName);
  if (!key) return null;
  const record = await idbGet('sellerLookups', key);
  if (!record || !record.fetchedAt) return null;
  if ((Date.now() - record.fetchedAt) > SELLER_LOOKUP_RETENTION_MS) return null;
  return record;
}

async function writeSellerLookup(sellerName, result) {
  const key = normalizeSellerLookupKey(sellerName);
  if (!key) return;
  await idbPut('sellerLookups', Object.assign({ key }, result, { fetchedAt: Date.now() }));
}

async function lookupSellerEntity(sellerName) {
  const normalizedName = normalizeSellerLookupName(sellerName);
  const key = normalizeSellerLookupKey(normalizedName);
  if (key.length < 3) return { ok: false, reason: 'short_name' };

  const cached = await readSellerLookup(normalizedName);
  if (cached) return { ok: true, cached: true, result: cached };

  const defaults = await getDefaultSettings();
  const { amzeSettings } = await chrome.storage.local.get(['amzeSettings']);
  const settings = mergeSettings(defaults, migrateSettings(amzeSettings || defaults, defaults.settingsVersion));
  if (!settings.flags || !settings.flags.sellerLookup) return { ok: false, reason: 'disabled' };

  const token = String(settings.openCorporatesToken || '').trim();
  if (!token) return { ok: false, reason: 'missing_token' };

  const now = Date.now();
  const waitMs = SELLER_LOOKUP_MIN_INTERVAL_MS - (now - lastSellerLookupAt);
  if (waitMs > 0) {
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  lastSellerLookupAt = Date.now();

  const url = new URL('https://api.opencorporates.com/v0.4/companies/search');
  url.searchParams.set('q', normalizedName);
  url.searchParams.set('per_page', '3');
  url.searchParams.set('inactive', 'false');
  url.searchParams.set('normalise_company_name', 'true');
  url.searchParams.set('api_token', token);

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!response.ok) return { ok: false, reason: 'http_' + response.status };

  const payload = await response.json();
  const companies = payload && payload.results && Array.isArray(payload.results.companies)
    ? payload.results.companies
    : [];
  const first = companies.map(item => item && item.company).find(Boolean);
  const result = first
    ? mapOpenCorporatesCompany(first, normalizedName)
    : { sellerName: normalizedName, noMatch: true, fetchedAt: Date.now() };
  await writeSellerLookup(normalizedName, result);
  return { ok: true, cached: false, result };
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

// -------------------------------------------------------------------
// declarativeNetRequest — affiliate/tracking param stripping at the
// network layer. Uses a single dynamic rule (ID 1) that strips
// tag, ref, ref_, pd_rd_*, pf_rd_*, and other tracking params from
// Amazon URLs before navigation completes. This prevents Amazon's
// own JS from re-adding params that content-script stripping misses.
// -------------------------------------------------------------------

const DNR_AFFILIATE_RULE_ID = 1;
const DNR_STRIP_PARAMS = [
  'tag', 'ref', 'ref_', 'pd_rd_w', 'pd_rd_r', 'pd_rd_i',
  'pf_rd_p', 'pf_rd_r', 'pf_rd_s', 'pf_rd_t', 'pf_rd_i',
  'content-id', 'psc', 'qid', 'sr', '_encoding',
  'dib', 'dib_tag', 'keywords', 'sprefix', 'linkCode', 'th'
];

async function syncAffiliateStripRule(enabled) {
  if (typeof chrome.declarativeNetRequest === 'undefined') return;
  try {
    if (enabled) {
      const patterns = await getAmazonUrlPatterns();
      const rule = {
        id: DNR_AFFILIATE_RULE_ID,
        priority: 1,
        action: {
          type: 'redirect',
          redirect: {
            transform: {
              queryTransform: {
                removeParams: DNR_STRIP_PARAMS
              }
            }
          }
        },
        condition: {
          urlFilter: '*://*.amazon.*/*',
          resourceTypes: ['main_frame', 'sub_frame']
        }
      };
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [DNR_AFFILIATE_RULE_ID],
        addRules: [rule]
      });
    } else {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [DNR_AFFILIATE_RULE_ID],
        addRules: []
      });
    }
  } catch (e) {}
}

async function warmStartServiceWorker() {
  const [defaults, stored] = await Promise.all([
    getDefaultSettings().catch(() => null),
    chrome.storage.local.get(['amzeSettings'])
  ]);
  const settings = defaults
    ? mergeSettings(defaults, stored.amzeSettings)
    : stored.amzeSettings;
  await Promise.all([
    scheduleRetentionPurge(),
    syncAffiliateStripRule(!!(settings && settings.flags && settings.flags.stripAffiliate))
  ]);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  globalThis.AmzeWarmStart.scheduleWarmStartAlarm(chrome.alarms);
  const defaults = await getDefaultSettings();
  const { amzeSettings } = await chrome.storage.local.get(['amzeSettings']);
  if (!amzeSettings) {
    await chrome.storage.local.set({ amzeSettings: defaults });
  } else {
    // Run structured migrations, then forward-merge new flags.
    const migrated = migrateSettings(amzeSettings, defaults.settingsVersion);
    const merged = mergeSettings(defaults, migrated);
    await chrome.storage.local.set({ amzeSettings: merged });
  }
  // Sync DNR affiliate-strip rule with current setting
  const settings = (await chrome.storage.local.get(['amzeSettings'])).amzeSettings;
  await syncAffiliateStripRule(!!(settings && settings.flags && settings.flags.stripAffiliate));
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
    idbClear('sellerLookups'),
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

// -------------------------------------------------------------------
// Price alerts — check stored price history against user-set thresholds
// -------------------------------------------------------------------

async function readPriceAlerts() {
  const r = await chrome.storage.local.get(['amzePriceAlerts']);
  return r.amzePriceAlerts || {};
}

async function writePriceAlerts(map) {
  await chrome.storage.local.set({ amzePriceAlerts: map });
}

async function checkPriceAlerts() {
  const { amzeSettings } = await chrome.storage.local.get(['amzeSettings']);
  if (!amzeSettings || !amzeSettings.flags || !amzeSettings.flags.priceAlert) return;
  const alerts = await readPriceAlerts();
  if (!Object.keys(alerts).length) return;

  for (const [asin, alert] of Object.entries(alerts)) {
    if (alert.notified) continue;
    const record = await idbGet('priceHistory', normalizeAsin(asin));
    if (!record || !Array.isArray(record.points) || !record.points.length) continue;
    const latest = record.points[record.points.length - 1];
    if (latest && latest.p <= alert.target) {
      alert.notified = true;
      try {
        chrome.notifications.create('amze-price-' + asin, {
          type: 'basic',
          iconUrl: 'icons/128.png',
          title: 'Price drop alert',
          message: `${alert.title || asin} is now $${latest.p.toFixed(2)} (target: $${alert.target.toFixed(2)})`,
          priority: 2
        });
      } catch (e) {}
    }
  }
  await writePriceAlerts(alerts);
}

chrome.alarms.create('amze-late-watch', { periodInMinutes: 60 * 6, delayInMinutes: 5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (globalThis.AmzeWarmStart.isWarmStartAlarm(a)) {
    warmStartServiceWorker().catch(() => {});
    return;
  }
  if (a.name === 'amze-late-watch') {
    scheduleRetentionPurge()
      .finally(() => scanLateOrders())
      .finally(() => checkPriceAlerts());
  }
});

chrome.runtime.onStartup.addListener(async () => {
  globalThis.AmzeWarmStart.scheduleWarmStartAlarm(chrome.alarms);
  scheduleRetentionPurge();
  // Sync DNR affiliate-strip rule on browser start
  const { amzeSettings } = await chrome.storage.local.get(['amzeSettings']);
  await syncAffiliateStripRule(!!(amzeSettings && amzeSettings.flags && amzeSettings.flags.stripAffiliate));
});

globalThis.AmzeWarmStart.scheduleWarmStartAlarm(chrome.alarms);
scheduleRetentionPurge();

// -------------------------------------------------------------------
// Wishlist import — user-started, visible-control queue
//
// Amazon does not provide a stable extension API for importing a wishlist.
// Each queued ASIN therefore opens in a background tab and lets the content
// script use the visible Add to List controls. The source wishlist tab stays
// in charge of the job, and a deliberate delay limits request/navigation rate.
// -------------------------------------------------------------------

function createWishlistImportJobId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch (e) {}
  return 'wl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function sendWishlistImportProgress(job, status, extra = {}) {
  const message = Object.assign({
    type: 'AMZE_WISHLIST_IMPORT_PROGRESS',
    jobId: job.id,
    status,
    total: job.items.length,
    completed: job.completed,
    succeeded: job.succeeded,
    failed: job.failed
  }, extra);
  try {
    chrome.tabs.sendMessage(job.sourceTabId, message, () => {
      void chrome.runtime.lastError;
    });
  } catch (e) {}
}

function clearWishlistImportTimers(job) {
  if (job.dispatchTimer) clearTimeout(job.dispatchTimer);
  if (job.responseTimer) clearTimeout(job.responseTimer);
  if (job.advanceTimer) clearTimeout(job.advanceTimer);
  job.dispatchTimer = null;
  job.responseTimer = null;
  job.advanceTimer = null;
}

function closeWishlistImportTab(job) {
  const tabId = job.activeTabId;
  job.activeTabId = null;
  if (tabId === null || tabId === undefined) return;
  try { chrome.tabs.remove(tabId, () => { void chrome.runtime.lastError; }); } catch (e) {}
}

function finishWishlistImportJob(job) {
  if (wishlistImportJobs.get(job.id) !== job) return;
  clearWishlistImportTimers(job);
  closeWishlistImportTab(job);
  wishlistImportJobs.delete(job.id);
  sendWishlistImportProgress(job, 'complete');
}

function recordWishlistImportResult(job, result) {
  if (wishlistImportJobs.get(job.id) !== job || job.resultHandled) return;
  job.resultHandled = true;
  clearWishlistImportTimers(job);
  const item = job.items[job.index];
  const ok = !!(result && result.ok && result.asin === item.asin);
  if (ok) job.succeeded++;
  else job.failed++;
  job.completed++;
  const reason = ok ? (result.reason || '') : (result && result.reason) || 'item_failed';
  closeWishlistImportTab(job);
  sendWishlistImportProgress(job, job.completed >= job.items.length ? 'running' : 'running', {
    asin: item.asin,
    current: item.title || item.asin,
    result: ok ? 'added' : 'failed',
    reason
  });
  job.index++;
  if (job.index >= job.items.length) {
    finishWishlistImportJob(job);
    return;
  }
  job.advanceTimer = setTimeout(() => advanceWishlistImport(job), WISHLIST_IMPORT_DELAY_MS);
}

function retryWishlistImportDispatch(job, reason) {
  if (wishlistImportJobs.get(job.id) !== job || job.resultHandled) return;
  job.awaitingResponse = false;
  if (job.dispatchAttempts >= WISHLIST_IMPORT_MAX_DISPATCH_ATTEMPTS) {
    recordWishlistImportResult(job, { ok: false, asin: job.items[job.index].asin, reason });
    return;
  }
  job.dispatchTimer = setTimeout(() => dispatchWishlistImportItem(job), 900);
}

function dispatchWishlistImportItem(job) {
  if (wishlistImportJobs.get(job.id) !== job || job.resultHandled || job.activeTabId === null) return;
  if (job.awaitingResponse) return;
  const item = job.items[job.index];
  job.dispatchAttempts++;
  job.awaitingResponse = true;
  const message = {
    type: 'AMZE_WISHLIST_IMPORT_ITEM',
    asin: item.asin,
    targetListId: job.targetListId,
    targetListName: job.targetListName
  };
  const callback = (response) => {
    const lastError = chrome.runtime.lastError;
    if (wishlistImportJobs.get(job.id) !== job || job.resultHandled || !job.awaitingResponse) return;
    if (lastError || !response) {
      retryWishlistImportDispatch(job, lastError ? 'content_script_unavailable' : 'empty_response');
      return;
    }
    recordWishlistImportResult(job, response);
  };
  try {
    chrome.tabs.sendMessage(job.activeTabId, message, callback);
  } catch (e) {
    retryWishlistImportDispatch(job, 'message_failed');
    return;
  }
  job.responseTimer = setTimeout(() => {
    if (job.awaitingResponse) retryWishlistImportDispatch(job, 'item_timeout');
  }, WISHLIST_IMPORT_RESPONSE_TIMEOUT_MS);
}

function advanceWishlistImport(job) {
  if (wishlistImportJobs.get(job.id) !== job) return;
  job.advanceTimer = null;
  if (job.index >= job.items.length) {
    finishWishlistImportJob(job);
    return;
  }
  job.resultHandled = false;
  job.awaitingResponse = false;
  job.dispatchAttempts = 0;
  const item = job.items[job.index];
  let productUrl = '';
  try {
    productUrl = globalThis.AmzeWishlistImport.buildProductUrl(job.targetHost, item.asin);
  } catch (e) {}
  if (!productUrl) {
    recordWishlistImportResult(job, { ok: false, asin: item.asin, reason: 'invalid_product_url' });
    return;
  }
  sendWishlistImportProgress(job, 'running', { asin: item.asin, current: item.title || item.asin });
  try {
    chrome.tabs.create({ url: productUrl, active: false }, (tab) => {
      const lastError = chrome.runtime.lastError;
      if (wishlistImportJobs.get(job.id) !== job) {
        if (tab && tab.id !== undefined) closeWishlistImportTab(Object.assign(job, { activeTabId: tab.id }));
        return;
      }
      if (lastError || !tab || tab.id === undefined) {
        recordWishlistImportResult(job, { ok: false, asin: item.asin, reason: 'tab_create_failed' });
        return;
      }
      job.activeTabId = tab.id;
      job.loadDispatchScheduled = false;
      job.dispatchTimer = setTimeout(() => dispatchWishlistImportItem(job), 6000);
    });
  } catch (e) {
    recordWishlistImportResult(job, { ok: false, asin: item.asin, reason: 'tab_create_failed' });
  }
}

function startWishlistImport(msg, sender, sendResponse) {
  const sourceTab = sender && sender.tab;
  if (!sourceTab || sourceTab.id === undefined || !sourceTab.url) {
    sendResponse({ ok: false, reason: 'wishlist_tab_required' });
    return;
  }
  if (Array.from(wishlistImportJobs.values()).some(job => job.sourceTabId === sourceTab.id)) {
    sendResponse({ ok: false, reason: 'import_already_running' });
    return;
  }
  let sourceUrl;
  try { sourceUrl = new URL(sourceTab.url); } catch (e) {
    sendResponse({ ok: false, reason: 'invalid_wishlist_url' });
    return;
  }
  if (!/amazon\./i.test(sourceUrl.hostname)) {
    sendResponse({ ok: false, reason: 'amazon_wishlist_required' });
    return;
  }
  let items;
  try {
    items = globalThis.AmzeWishlistImport.normalizeWishlistItems(msg && msg.items);
  } catch (e) {
    sendResponse({ ok: false, reason: e && e.message ? e.message : 'invalid_wishlist_items' });
    return;
  }
  const wishlist = msg && msg.wishlist || {};
  const job = {
    id: createWishlistImportJobId(),
    sourceTabId: sourceTab.id,
    targetHost: sourceUrl.hostname,
    targetListId: String(wishlist.listId || '').slice(0, 120),
    targetListName: String(wishlist.listName || 'Wish List').replace(/\s+/g, ' ').trim().slice(0, 120),
    items,
    index: 0,
    completed: 0,
    succeeded: 0,
    failed: 0,
    activeTabId: null,
    dispatchAttempts: 0,
    awaitingResponse: false,
    resultHandled: false,
    dispatchTimer: null,
    responseTimer: null,
    advanceTimer: null
  };
  wishlistImportJobs.set(job.id, job);
  sendResponse({ ok: true, jobId: job.id, total: items.length });
  sendWishlistImportProgress(job, 'running', { asin: items[0].asin, current: items[0].title || items[0].asin });
  advanceWishlistImport(job);
}

function cancelWishlistImport(job) {
  clearWishlistImportTimers(job);
  wishlistImportJobs.delete(job.id);
  job.completed = Math.min(job.completed, job.items.length);
  closeWishlistImportTab(job);
  sendWishlistImportProgress(job, 'canceled');
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  for (const job of wishlistImportJobs.values()) {
    if (job.activeTabId !== tabId || job.resultHandled) continue;
    if (job.dispatchTimer) clearTimeout(job.dispatchTimer);
    job.dispatchTimer = setTimeout(() => dispatchWishlistImportItem(job), 700);
    break;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const job of wishlistImportJobs.values()) {
    if (job.sourceTabId === tabId) {
      cancelWishlistImport(job);
    } else if (job.activeTabId === tabId && !job.resultHandled) {
      recordWishlistImportResult(job, { ok: false, asin: job.items[job.index].asin, reason: 'tab_closed' });
    }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'AMZE_LOAD_FEATURE_MODULES') {
    const tabId = sender && sender.tab && sender.tab.id;
    const active = globalThis.AmzeFeatureModules.getFiles(msg.flags || {});
    const requestedFiles = globalThis.AmzeFeatureModules.filterAllowedFiles(msg.files);
    const requested = (requestedFiles.length ? requestedFiles : active).filter(file => active.includes(file));
    if (tabId === undefined || !requested.length) {
      sendResponse({ ok: true, files: [] });
      return false;
    }
    try {
      chrome.scripting.executeScript({ target: { tabId }, files: requested }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, files: [], reason: chrome.runtime.lastError.message || 'feature_injection_failed' });
        } else {
          sendResponse({ ok: true, files: requested });
        }
      });
    } catch (e) {
      sendResponse({ ok: false, files: [], reason: 'feature_injection_failed' });
    }
    return true;
  }

  if (msg.type === 'AMZE_START_WISHLIST_IMPORT') {
    startWishlistImport(msg, sender, sendResponse);
    return false;
  }

  if (msg.type === 'AMZE_CANCEL_WISHLIST_IMPORT') {
    const job = wishlistImportJobs.get(String(msg.jobId || ''));
    if (!job || !sender.tab || sender.tab.id !== job.sourceTabId) {
      sendResponse({ ok: false, reason: 'import_job_not_found' });
      return false;
    }
    cancelWishlistImport(job);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'AMZE_WISHLIST_IMPORT_RESULT') {
    const job = wishlistImportJobs.get(String(msg.jobId || ''));
    if (!job || !sender.tab || sender.tab.id !== job.activeTabId || msg.asin !== job.items[job.index].asin) {
      sendResponse({ ok: false, reason: 'import_result_rejected' });
      return false;
    }
    recordWishlistImportResult(job, msg);
    sendResponse({ ok: true });
    return false;
  }

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

  if (msg.type === 'AMZE_IDB_GET_ALL_PRICE_HISTORY') {
    (async () => {
      await migrateLegacyStorageToIndexedDb();
      const entries = await idbGetAll('priceHistory');
      sendResponse({ ok: true, entries: entries || [] });
    })().catch(() => sendResponse({ ok: false, entries: [] }));
    return true;
  }

  if (msg.type === 'AMZE_IDB_MERGE_PRICE_HISTORY') {
    (async () => {
      await migrateLegacyStorageToIndexedDb();
      const existing = await idbGetAll('priceHistory');
      const merged = globalThis.AmzePriceHistoryIO.mergeHistoryEntries(existing, msg.entries);
      for (const entry of merged) await idbPut('priceHistory', entry);
      sendResponse({ ok: true, imported: merged.length });
    })().catch(() => sendResponse({ ok: false, imported: 0 }));
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
      sendResponse({ ok: true, cleared: ['priceHistory', 'origins', 'sellerLookups', 'watchedOrders'] });
    })().catch(() => sendResponse({ ok: false, cleared: [] }));
    return true;
  }

  if (msg.type === 'AMZE_GET_PRICE_ALERTS') {
    (async () => {
      const alerts = await readPriceAlerts();
      sendResponse({ ok: true, alerts });
    })().catch(() => sendResponse({ ok: false, alerts: {} }));
    return true;
  }

  if (msg.type === 'AMZE_SET_PRICE_ALERT') {
    (async () => {
      const alerts = await readPriceAlerts();
      const key = normalizeAsin(msg.asin);
      if (!key) { sendResponse({ ok: false }); return; }
      if (msg.target === null || msg.target === undefined) {
        delete alerts[key];
      } else {
        alerts[key] = {
          target: Number(msg.target),
          title: String(msg.title || key).slice(0, 100),
          createdAt: Date.now(),
          notified: false
        };
      }
      await writePriceAlerts(alerts);
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'AMZE_LOOKUP_SELLER') {
    (async () => {
      const result = await lookupSellerEntity(msg.sellerName);
      sendResponse(result);
    })().catch(() => sendResponse({ ok: false, reason: 'lookup_failed' }));
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
    (async () => {
      // Sync DNR affiliate-strip rule with updated settings
      const stripEnabled = !!(msg.settings && msg.settings.flags && msg.settings.flags.stripAffiliate);
      await syncAffiliateStripRule(stripEnabled);
      const url = await getAmazonUrlPatterns();
      chrome.tabs.query({ url }, (tabs) => {
        for (const t of tabs) {
          chrome.tabs.sendMessage(t.id, { type: 'AMZE_SETTINGS_UPDATED', settings: msg.settings }).catch(() => {});
        }
        sendResponse({ ok: true, count: tabs.length });
      });
    })().catch(() => sendResponse({ ok: false, count: 0 }));
    return true;
  }
});
