(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeSessionState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'amzeSessionScanState';
  const MAX_PAGES = 8;
  const MAX_PROCESSED_KEYS = 240;
  const PERSIST_DELAY_MS = 120;

  function clampKey(value, max = 240) {
    return String(value || '').slice(0, max);
  }

  function callStorage(storage, method, args) {
    if (!storage || typeof storage[method] !== 'function') return Promise.reject(new Error('session_storage_unavailable'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      const callback = value => finish(resolve, value);
      try {
        const result = storage[method](...args, callback);
        if (result && typeof result.then === 'function') result.then(value => finish(resolve, value), error => finish(reject, error));
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  function normalizePage(page) {
    const source = page && typeof page === 'object' ? page : {};
    return {
      processed: Array.isArray(source.processed)
        ? source.processed.map(key => clampKey(key)).filter(Boolean).slice(-MAX_PROCESSED_KEYS)
        : [],
      scans: Number.isFinite(source.scans) ? source.scans : 0,
      lastScanAt: Number.isFinite(source.lastScanAt) ? source.lastScanAt : 0,
      lastScanKind: clampKey(source.lastScanKind, 40)
    };
  }

  function normalizeState(value) {
    const pages = {};
    const source = value && typeof value === 'object' && value.pages && typeof value.pages === 'object'
      ? value.pages
      : {};
    Object.entries(source).slice(-MAX_PAGES).forEach(([key, page]) => {
      const pageKey = clampKey(key);
      if (pageKey) pages[pageKey] = normalizePage(page);
    });
    return { pages };
  }

  function createSessionState(storage, pageKey, options = {}) {
    const key = clampKey(pageKey || 'page');
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const persistDelayMs = Math.max(0, Number(options.persistDelayMs ?? PERSIST_DELAY_MS));
    let state = { pages: {} };
    let page = normalizePage();
    let ready = false;
    let persistTimer = null;
    let queue = Promise.resolve();

    function ensurePage() {
      if (!state.pages[key]) state.pages[key] = normalizePage();
      page = state.pages[key];
      const keys = Object.keys(state.pages);
      if (keys.length > MAX_PAGES) keys.slice(0, keys.length - MAX_PAGES).forEach(oldKey => delete state.pages[oldKey]);
    }

    function persistNow() {
      if (persistTimer !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      queue = queue.then(() => callStorage(storage, 'set', [{ [STORAGE_KEY]: state }])).catch(() => null);
      return queue;
    }

    function schedulePersist() {
      if (persistTimer !== null) return;
      if (!persistDelayMs) {
        persistNow();
        return;
      }
      persistTimer = setTimeout(() => persistNow(), persistDelayMs);
    }

    async function hydrate() {
      try {
        const result = await callStorage(storage, 'get', [STORAGE_KEY]);
        state = normalizeState(result && result[STORAGE_KEY]);
      } catch (e) {
        state = { pages: {} };
      }
      ensurePage();
      ready = true;
      return snapshot();
    }

    function hasProcessed(elementKey) {
      return ready && page.processed.includes(clampKey(elementKey));
    }

    function markProcessed(elementKey) {
      const normalized = clampKey(elementKey);
      if (!normalized || page.processed.includes(normalized)) return;
      page.processed.push(normalized);
      if (page.processed.length > MAX_PROCESSED_KEYS) page.processed.splice(0, page.processed.length - MAX_PROCESSED_KEYS);
      schedulePersist();
    }

    function markScan(kind) {
      page.scans += 1;
      page.lastScanAt = now();
      page.lastScanKind = clampKey(kind || 'scan', 40);
      schedulePersist();
    }

    function resetProcessed() {
      page.processed = [];
      schedulePersist();
    }

    function snapshot() {
      return {
        pageKey: key,
        ready,
        processedCount: page.processed.length,
        scans: page.scans,
        lastScanAt: page.lastScanAt,
        lastScanKind: page.lastScanKind
      };
    }

    return {
      hydrate,
      hasProcessed,
      markProcessed,
      markScan,
      resetProcessed,
      flush: persistNow,
      snapshot
    };
  }

  return {
    STORAGE_KEY,
    MAX_PAGES,
    MAX_PROCESSED_KEYS,
    createSessionState,
    normalizeState
  };
});
