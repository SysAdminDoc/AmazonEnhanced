const test = require('node:test');
const assert = require('node:assert/strict');
const health = require('../health-report.js');
const networkRules = require('../network-rules.js');
const { isSponsoredLabelText } = require('../sponsored-detection.js');

const SELECTOR_PACK = {
  version: 1,
  sponsored: ['[data-component-type="sp-sponsored-result"]', '.AdHolder'],
  sponsoredLabels: ['.puis-sponsored-label-text', '[aria-label*="Sponsored" i]']
};

function createFixture(initial = {}) {
  const matches = new Map(Object.entries(initial));
  return {
    document: {
      querySelector(selector) {
        if (selector === '[') throw new SyntaxError('invalid selector');
        const nodes = matches.get(selector) || [];
        return nodes[0] || null;
      },
      querySelectorAll(selector) {
        if (selector === '[') throw new SyntaxError('invalid selector');
        return matches.get(selector) || [];
      }
    },
    set(selector, nodes) {
      matches.set(selector, nodes);
    }
  };
}

function createStorage() {
  const values = {};
  return {
    values,
    get(key, callback) { callback({ [key]: values[key] }); },
    set(next, callback) { Object.assign(values, next); callback(); },
    remove(key, callback) { delete values[key]; callback(); }
  };
}

test('classifies supported route families without retaining a URL', () => {
  assert.equal(health.classifyRoute('/s?k=headphones'), 'search');
  assert.equal(health.classifyRoute('/dp/B000000000/ref=something'), 'pdp');
  assert.equal(health.classifyRoute('/gp/product/B000000000'), 'pdp');
  assert.equal(health.classifyRoute('/gp/cart/view.html'), 'cart');
  assert.equal(health.classifyRoute('/hz/wishlist/ls/example'), 'other');
});

test('audits a healthy search fixture and refreshes delayed label counts', () => {
  const fixture = createFixture({
    '#search': [{}],
    '[data-component-type="s-search-result"]': [{}]
  });
  const initial = health.auditDocument({
    document: fixture.document,
    pathname: '/s?k=private-search-term',
    locale: 'com',
    selectorPack: SELECTOR_PACK,
    isSponsoredLabelText,
    now: 100
  });
  assert.equal(initial.status, 'healthy');
  assert.deepEqual(initial.missingCriticalHooks, []);
  assert.equal(initial.observed.sponsoredLabelNodes, 0);
  assert.equal(initial.observed.recognizedTextLabels, 0);

  fixture.set('.puis-sponsored-label-text', [{ textContent: 'Sponsored' }]);
  const delayed = health.auditDocument({
    document: fixture.document,
    pathname: '/s?k=private-search-term',
    locale: 'com',
    selectorPack: SELECTOR_PACK,
    isSponsoredLabelText,
    now: 200
  });
  assert.equal(delayed.status, 'healthy');
  assert.equal(delayed.observed.sponsoredLabelNodes, 1);
  assert.equal(delayed.observed.recognizedTextLabels, 1);
  assert.notEqual(
    health.selectorSnapshotFingerprint(initial),
    health.selectorSnapshotFingerprint(delayed)
  );
  assert.equal(JSON.stringify(delayed).includes('private-search-term'), false);
  assert.equal(JSON.stringify(delayed).includes('Sponsored'), false);
});

test('audits a complete PDP fixture', () => {
  const fixture = createFixture({
    '#dp': [{}],
    '#productTitle': [{}],
    '#buybox': [{}]
  });
  const snapshot = health.auditDocument({
    document: fixture.document,
    pathname: '/dp/B000000000',
    locale: 'co.uk',
    selectorPack: SELECTOR_PACK,
    isSponsoredLabelText,
    now: 300
  });
  assert.equal(snapshot.route, 'pdp');
  assert.equal(snapshot.status, 'healthy');
  assert.deepEqual(snapshot.missingCriticalHooks, []);
});

test('reports stable hook and selector IDs when a fixture is deliberately incomplete', () => {
  const fixture = createFixture({ '#dp-container': [{}], '#desktop_buybox': [{}] });
  const snapshot = health.auditDocument({
    document: fixture.document,
    pathname: '/dp/B000000000',
    locale: 'com',
    selectorPack: {
      version: 1,
      sponsored: [SELECTOR_PACK.sponsored[0], '['],
      sponsoredLabels: SELECTOR_PACK.sponsoredLabels
    },
    isSponsoredLabelText,
    now: 400
  });
  assert.equal(snapshot.status, 'degraded');
  assert.deepEqual(snapshot.missingCriticalHooks, ['pdp_title']);
  assert.deepEqual(snapshot.selectorPack.invalidSelectorIds, ['sponsored:1']);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('#productTitle'), false);
  assert.equal(serialized.includes('B000000000'), false);
  assert.equal(serialized.includes('['), true); // JSON arrays only; the invalid selector itself is absent.
  assert.equal(serialized.includes('"["'), false);
});

test('detects missing, stale, and structurally mismatched managed request rules', () => {
  const expected = networkRules.buildDynamicRules({ stripAffiliate: true, hideSponsored: true });
  const actual = expected
    .filter(rule => rule.id !== networkRules.AD_RULE_IDS.at(-1))
    .map(rule => rule.id === networkRules.AFFILIATE_RULE_IDS[0]
      ? Object.assign({}, rule, { priority: rule.priority + 1 })
      : rule);
  const audit = health.auditRequestRules(
    actual,
    expected,
    networkRules.MANAGED_RULE_IDS,
    { lastSync: { attemptedAt: 500, status: 'ok', expectedCount: 27, installedCount: 27 } }
  );
  assert.equal(audit.status, 'degraded');
  assert.equal(audit.expectedCount, 27);
  assert.equal(audit.installedCount, 26);
  assert.deepEqual(audit.missingRuleIds, [networkRules.AD_RULE_IDS.at(-1)]);
  assert.deepEqual(audit.mismatchedRuleIds, [networkRules.AFFILIATE_RULE_IDS[0]]);

  const disabledAudit = health.auditRequestRules(
    expected,
    [],
    networkRules.MANAGED_RULE_IDS
  );
  assert.equal(disabledAudit.status, 'degraded');
  assert.equal(disabledAudit.expectedCount, 0);
  assert.equal(disabledAudit.unexpectedRuleIds.length, 27);
});

test('stores only the latest bounded structural snapshot per route', async () => {
  const storage = createStorage();
  await health.writeSelectorSnapshot(storage, {
    route: 'search',
    locale: 'com',
    observedAt: 600,
    missingCriticalHooks: [],
    selectorPack: {
      source: 'catalog', version: 1, sponsoredCount: 16, sponsoredLabelCount: 4,
      invalidSelectorIds: []
    },
    observed: { sponsoredContainers: 2, sponsoredLabelNodes: 2, recognizedTextLabels: 1 },
    url: 'https://www.amazon.com/s?k=secret',
    pageText: 'secret account name'
  });
  await health.writeSelectorSnapshot(storage, {
    route: 'search',
    locale: 'com',
    observedAt: 700,
    missingCriticalHooks: ['search_results'],
    selectorPack: {
      source: 'catalog', version: 1, sponsoredCount: 16, sponsoredLabelCount: 4,
      invalidSelectorIds: []
    },
    observed: {}
  });
  await health.writeRuleSync(storage, {
    attemptedAt: 800,
    status: 'failed',
    failureCode: 'update_failed',
    expectedCount: 27,
    installedCount: 0,
    error: 'private failure text'
  });

  const state = await health.read(storage);
  assert.equal(Object.keys(state.selectorRoutes).length, 1);
  assert.equal(state.selectorRoutes.search.observedAt, 700);
  assert.deepEqual(state.selectorRoutes.search.missingCriticalHooks, ['search_results']);
  assert.equal(state.lastRuleSync.failureCode, 'update_failed');
  const report = health.createDiagnosticReport(
    { entries: [], extensionVersion: '2.0.17' },
    state,
    health.unavailableRequestRuleAudit(state.lastRuleSync, 'read_failed'),
    { generatedAt: 900, extensionVersion: '2.0.17' }
  );
  assert.equal(report.health.selectors.status, 'degraded');
  assert.equal(report.health.requestRules.status, 'unavailable');
  assert.deepEqual(report.privacy, {
    healthData: 'structural-only',
    healthIncludesPageText: false,
    healthIncludesUrls: false,
    healthIncludesAccountData: false
  });
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('amazon.com'), false);
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('private failure text'), false);

  await health.clear(storage);
  assert.equal(storage.values[health.STORAGE_KEY], undefined);
});
