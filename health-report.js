(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeHealthReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'amzeHealthState';
  const STATE_VERSION = 1;
  const MAX_COUNT = 10000;
  const MAX_RULE_ID = 1000000;
  const ROUTES = Object.freeze(['search', 'pdp', 'cart']);
  const SYNC_FAILURE_CODES = new Set([
    'builder_unavailable', 'api_unavailable', 'update_failed', 'verification_failed'
  ]);
  const REQUEST_FAILURE_CODES = new Set(['api_unavailable', 'read_failed']);
  const CRITICAL_HOOKS = Object.freeze({
    search: Object.freeze({
      search_root: Object.freeze(['#search']),
      search_results: Object.freeze([
        '[data-component-type="s-search-result"]',
        '#search .s-result-item'
      ])
    }),
    pdp: Object.freeze({
      pdp_root: Object.freeze(['#dp', '#dp-container', '#ppd']),
      pdp_title: Object.freeze(['#productTitle']),
      pdp_purchase: Object.freeze([
        '#buybox', '#desktop_buybox', '#buybox-see-all-buying-choices'
      ])
    }),
    cart: Object.freeze({
      cart_root: Object.freeze([
        '#sc-active-cart', '#sc-retail-cart-container', '[data-name="Active Items"]'
      ])
    })
  });

  function clampCount(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(MAX_COUNT, Math.trunc(number)));
  }

  function normalizeTimestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
  }

  function normalizeRoute(value) {
    const route = String(value || '').toLowerCase();
    return ROUTES.includes(route) ? route : 'other';
  }

  function normalizeLocale(value) {
    const locale = String(value || '').trim().toLowerCase();
    return /^[a-z]{2,3}(?:\.[a-z]{2})?$/.test(locale) ? locale : '';
  }

  function classifyRoute(pathname) {
    const path = String(pathname || '/').toLowerCase();
    if (/\/(?:dp|gp\/product)\//.test(path)) return 'pdp';
    if (/^\/s(?:[/?]|$)/.test(path)) return 'search';
    if (/\/(?:gp\/)?cart(?:\/|$)/.test(path)) return 'cart';
    return 'other';
  }

  function normalizeSelectorArray(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map(selector => String(selector || '').trim())
      .filter(Boolean)
      .slice(0, 100);
  }

  function normalizeLabelArray(value) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
      .map(label => String(label || '').normalize('NFKC').trim())
      .filter(Boolean)))
      .slice(0, 50);
  }

  function resolveSelectorPack(pack, locale) {
    const source = pack && typeof pack === 'object' ? pack : {};
    const override = source.localeOverrides
      && typeof source.localeOverrides === 'object'
      && source.localeOverrides[locale]
      && typeof source.localeOverrides[locale] === 'object'
      ? source.localeOverrides[locale]
      : {};
    const sponsoredOverride = Array.isArray(override.sponsored);
    const labelOverride = Array.isArray(override.sponsoredLabels);
    return {
      version: clampCount(source.version),
      sponsored: normalizeSelectorArray(sponsoredOverride ? override.sponsored : source.sponsored),
      sponsoredLabels: normalizeSelectorArray(labelOverride ? override.sponsoredLabels : source.sponsoredLabels),
      localizedLabels: normalizeLabelArray(source.localeLabels && source.localeLabels[locale]),
      sponsoredSource: sponsoredOverride ? 'locale' : 'base',
      labelSource: labelOverride ? 'locale' : 'base'
    };
  }

  function selectorIsValid(documentLike, selector) {
    if (!documentLike || typeof documentLike.querySelector !== 'function') return false;
    try {
      documentLike.querySelector(selector);
      return true;
    } catch (error) {
      return false;
    }
  }

  function queryOne(documentLike, selectors) {
    if (!documentLike || typeof documentLike.querySelector !== 'function') return null;
    for (const selector of selectors) {
      try {
        const found = documentLike.querySelector(selector);
        if (found) return found;
      } catch (error) {}
    }
    return null;
  }

  function queryNodes(documentLike, selectors) {
    const nodes = new Set();
    if (!documentLike || typeof documentLike.querySelectorAll !== 'function') return nodes;
    selectors.forEach(selector => {
      try {
        Array.from(documentLike.querySelectorAll(selector) || []).forEach(node => nodes.add(node));
      } catch (error) {}
    });
    return nodes;
  }

  function normalizeTokenList(values, allowed) {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values
      .map(value => String(value || '').trim())
      .filter(value => allowed(value))))
      .slice(0, 100);
  }

  function normalizeSelectorSnapshot(snapshot) {
    const input = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const route = normalizeRoute(input.route);
    const hooks = CRITICAL_HOOKS[route] || {};
    const missingCriticalHooks = normalizeTokenList(
      input.missingCriticalHooks,
      value => Object.prototype.hasOwnProperty.call(hooks, value)
    );
    const packInput = input.selectorPack && typeof input.selectorPack === 'object'
      ? input.selectorPack
      : {};
    const invalidSelectorIds = normalizeTokenList(
      packInput.invalidSelectorIds,
      value => /^(?:sponsored|sponsoredLabels):\d{1,3}$/.test(value)
    );
    const selectorPack = {
      source: packInput.source === 'fallback' ? 'fallback' : 'catalog',
      version: clampCount(packInput.version),
      sponsoredCount: clampCount(packInput.sponsoredCount),
      sponsoredLabelCount: clampCount(packInput.sponsoredLabelCount),
      localizedLabelCount: clampCount(packInput.localizedLabelCount),
      invalidSelectorIds
    };
    const observedInput = input.observed && typeof input.observed === 'object'
      ? input.observed
      : {};
    const observed = {
      sponsoredContainers: clampCount(observedInput.sponsoredContainers),
      sponsoredLabelNodes: clampCount(observedInput.sponsoredLabelNodes),
      recognizedTextLabels: clampCount(observedInput.recognizedTextLabels)
    };
    const applicable = route !== 'other';
    const degraded = applicable && (
      missingCriticalHooks.length > 0
      || invalidSelectorIds.length > 0
      || selectorPack.source === 'fallback'
      || selectorPack.version === 0
      || selectorPack.sponsoredCount === 0
      || selectorPack.sponsoredLabelCount === 0
      || selectorPack.localizedLabelCount === 0
    );
    return {
      route,
      locale: normalizeLocale(input.locale),
      observedAt: normalizeTimestamp(input.observedAt),
      status: applicable ? (degraded ? 'degraded' : 'healthy') : 'not_applicable',
      criticalHookCount: Object.keys(hooks).length,
      missingCriticalHooks,
      selectorPack,
      observed
    };
  }

  function auditDocument(options = {}) {
    const documentLike = options.document;
    const route = classifyRoute(options.pathname);
    const locale = normalizeLocale(options.locale);
    const hooks = CRITICAL_HOOKS[route] || {};
    const resolved = resolveSelectorPack(options.selectorPack, locale);
    const invalidSelectorIds = [];
    const validSponsored = [];
    const validLabels = [];

    resolved.sponsored.forEach((selector, index) => {
      if (selectorIsValid(documentLike, selector)) validSponsored.push(selector);
      else invalidSelectorIds.push(`sponsored:${index}`);
    });
    resolved.sponsoredLabels.forEach((selector, index) => {
      if (selectorIsValid(documentLike, selector)) validLabels.push(selector);
      else invalidSelectorIds.push(`sponsoredLabels:${index}`);
    });

    const missingCriticalHooks = Object.entries(hooks)
      .filter(([, selectors]) => !queryOne(documentLike, selectors))
      .map(([name]) => name);
    const sponsoredNodes = queryNodes(documentLike, validSponsored);
    const labelNodes = queryNodes(documentLike, validLabels);
    const textCandidates = queryNodes(documentLike, [
      '.puis-sponsored-label-text', 'span.a-color-secondary'
    ]);
    labelNodes.forEach(node => textCandidates.add(node));
    const classifier = typeof options.isSponsoredLabelText === 'function'
      ? options.isSponsoredLabelText
      : () => false;
    let recognizedTextLabels = 0;
    textCandidates.forEach(node => {
      try {
        if (classifier(node && node.textContent || '')) recognizedTextLabels++;
      } catch (error) {}
    });

    return normalizeSelectorSnapshot({
      route,
      locale,
      observedAt: Number.isFinite(options.now) ? options.now : Date.now(),
      missingCriticalHooks,
      selectorPack: {
        source: options.selectorPackSource === 'fallback' ? 'fallback' : 'catalog',
        version: resolved.version,
        sponsoredCount: resolved.sponsored.length,
        sponsoredLabelCount: resolved.sponsoredLabels.length,
        localizedLabelCount: resolved.localizedLabels.length,
        invalidSelectorIds
      },
      observed: {
        sponsoredContainers: sponsoredNodes.size,
        sponsoredLabelNodes: labelNodes.size,
        recognizedTextLabels
      }
    });
  }

  function selectorSnapshotFingerprint(snapshot) {
    const normalized = normalizeSelectorSnapshot(snapshot);
    const comparable = Object.assign({}, normalized);
    delete comparable.observedAt;
    return JSON.stringify(comparable);
  }

  function normalizeRuleIds(values) {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value > 0 && value <= MAX_RULE_ID)))
      .sort((a, b) => a - b)
      .slice(0, 1000);
  }

  function normalizeRuleSync(sync) {
    if (!sync || typeof sync !== 'object') return null;
    const status = sync.status === 'failed' ? 'failed' : sync.status === 'ok' ? 'ok' : '';
    if (!status) return null;
    const normalized = {
      attemptedAt: normalizeTimestamp(sync.attemptedAt),
      status,
      expectedCount: clampCount(sync.expectedCount),
      installedCount: clampCount(sync.installedCount)
    };
    if (status === 'failed' && SYNC_FAILURE_CODES.has(sync.failureCode)) {
      normalized.failureCode = sync.failureCode;
    }
    return normalized;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }

  function ruleSignature(rule) {
    if (!rule || typeof rule !== 'object') return '';
    const copy = Object.assign({}, rule);
    delete copy.id;
    try { return JSON.stringify(stableValue(copy)); } catch (error) { return ''; }
  }

  function normalizeRequestRuleAudit(audit) {
    const input = audit && typeof audit === 'object' ? audit : {};
    const status = ['healthy', 'degraded', 'unavailable'].includes(input.status)
      ? input.status
      : 'unavailable';
    const normalized = {
      status,
      expectedCount: clampCount(input.expectedCount),
      installedCount: clampCount(input.installedCount),
      missingRuleIds: normalizeRuleIds(input.missingRuleIds),
      unexpectedRuleIds: normalizeRuleIds(input.unexpectedRuleIds),
      mismatchedRuleIds: normalizeRuleIds(input.mismatchedRuleIds),
      lastSync: normalizeRuleSync(input.lastSync)
    };
    if (status === 'unavailable' && REQUEST_FAILURE_CODES.has(input.failureCode)) {
      normalized.failureCode = input.failureCode;
    }
    return normalized;
  }

  function auditRequestRules(actualRules, expectedRules, managedRuleIds, options = {}) {
    const managed = new Set(normalizeRuleIds(managedRuleIds));
    const expected = new Map();
    const installed = new Map();
    (Array.isArray(expectedRules) ? expectedRules : []).forEach(rule => {
      const id = Number(rule && rule.id);
      if (managed.has(id)) expected.set(id, rule);
    });
    (Array.isArray(actualRules) ? actualRules : []).forEach(rule => {
      const id = Number(rule && rule.id);
      if (managed.has(id)) installed.set(id, rule);
    });
    const missingRuleIds = Array.from(expected.keys()).filter(id => !installed.has(id));
    const unexpectedRuleIds = Array.from(installed.keys()).filter(id => !expected.has(id));
    const mismatchedRuleIds = Array.from(expected.keys()).filter(id => (
      installed.has(id) && ruleSignature(expected.get(id)) !== ruleSignature(installed.get(id))
    ));
    const lastSync = normalizeRuleSync(options.lastSync);
    const degraded = missingRuleIds.length > 0
      || unexpectedRuleIds.length > 0
      || mismatchedRuleIds.length > 0
      || (lastSync && lastSync.status === 'failed');
    return normalizeRequestRuleAudit({
      status: degraded ? 'degraded' : 'healthy',
      expectedCount: expected.size,
      installedCount: installed.size,
      missingRuleIds,
      unexpectedRuleIds,
      mismatchedRuleIds,
      lastSync
    });
  }

  function unavailableRequestRuleAudit(lastSync, failureCode) {
    return normalizeRequestRuleAudit({
      status: 'unavailable',
      failureCode,
      lastSync
    });
  }

  function callStorage(storage, method, args) {
    if (!storage || typeof storage[method] !== 'function') {
      return Promise.reject(new Error('storage_unavailable'));
    }
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
        if (result && typeof result.then === 'function') {
          result.then(value => finish(resolve, value), error => finish(reject, error));
        }
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  function normalizeState(state) {
    const input = state && typeof state === 'object' ? state : {};
    const selectorRoutes = {};
    const sourceRoutes = input.selectorRoutes && typeof input.selectorRoutes === 'object'
      ? input.selectorRoutes
      : {};
    ROUTES.forEach(route => {
      const snapshot = normalizeSelectorSnapshot(sourceRoutes[route]);
      if (snapshot.route === route) selectorRoutes[route] = snapshot;
    });
    return {
      version: STATE_VERSION,
      updatedAt: normalizeTimestamp(input.updatedAt),
      selectorRoutes,
      lastRuleSync: normalizeRuleSync(input.lastRuleSync)
    };
  }

  function read(storage) {
    return callStorage(storage, 'get', [STORAGE_KEY])
      .then(result => normalizeState(result && result[STORAGE_KEY]));
  }

  let stateWriteQueue = Promise.resolve();

  function update(storage, updater) {
    const operation = stateWriteQueue.catch(() => {}).then(async () => {
      const state = await read(storage);
      const next = normalizeState(updater(state) || state);
      await callStorage(storage, 'set', [{ [STORAGE_KEY]: next }]);
      return next;
    });
    stateWriteQueue = operation.catch(() => {});
    return operation;
  }

  function writeSelectorSnapshot(storage, snapshot) {
    const normalized = normalizeSelectorSnapshot(snapshot);
    if (normalized.route === 'other') return Promise.resolve(null);
    return update(storage, state => {
      state.selectorRoutes[normalized.route] = normalized;
      state.updatedAt = Math.max(state.updatedAt, normalized.observedAt);
      return state;
    });
  }

  function writeRuleSync(storage, sync) {
    const normalized = normalizeRuleSync(sync);
    if (!normalized) return Promise.resolve(null);
    return update(storage, state => {
      state.lastRuleSync = normalized;
      state.updatedAt = Math.max(state.updatedAt, normalized.attemptedAt);
      return state;
    });
  }

  function clear(storage) {
    const operation = stateWriteQueue.catch(() => {})
      .then(() => callStorage(storage, 'remove', [STORAGE_KEY]));
    stateWriteQueue = operation.catch(() => {});
    return operation;
  }

  function createDiagnosticReport(errorReport, healthState, requestRuleAudit, metadata = {}) {
    const state = normalizeState(healthState);
    const routes = ROUTES
      .filter(route => state.selectorRoutes[route])
      .map(route => state.selectorRoutes[route]);
    const selectorStatus = !routes.length
      ? 'no_data'
      : routes.some(route => route.status === 'degraded') ? 'degraded' : 'healthy';
    return {
      format: 'AmazonEnhanced diagnostic report',
      version: 2,
      generatedAt: Number.isFinite(metadata.generatedAt) ? metadata.generatedAt : Date.now(),
      extensionVersion: String(metadata.extensionVersion || errorReport && errorReport.extensionVersion || '').slice(0, 40),
      privacy: {
        healthData: 'structural-only',
        healthIncludesPageText: false,
        healthIncludesUrls: false,
        healthIncludesAccountData: false
      },
      health: {
        selectors: { status: selectorStatus, routes },
        requestRules: normalizeRequestRuleAudit(requestRuleAudit)
      },
      entries: Array.isArray(errorReport && errorReport.entries) ? errorReport.entries : []
    };
  }

  return {
    STORAGE_KEY,
    STATE_VERSION,
    ROUTES,
    CRITICAL_HOOKS,
    classifyRoute,
    resolveSelectorPack,
    normalizeSelectorSnapshot,
    auditDocument,
    selectorSnapshotFingerprint,
    normalizeRuleSync,
    normalizeRequestRuleAudit,
    auditRequestRules,
    unavailableRequestRuleAudit,
    normalizeState,
    read,
    writeSelectorSnapshot,
    writeRuleSync,
    clear,
    createDiagnosticReport
  };
});
