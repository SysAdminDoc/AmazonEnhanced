const test = require('node:test');
const assert = require('node:assert/strict');
const locales = require('../locales.json');
const selectorPack = require('../selectors.json');
const fixtures = require('./fixtures/amazon-marketplaces.json');
const health = require('../health-report.js');
const { DEFAULT_LABELS, isSponsoredLabelText } = require('../sponsored-detection.js');

function createDocument(entries) {
  const nodes = new Map(Object.entries(entries));
  return {
    querySelector(selector) {
      return (nodes.get(selector) || [])[0] || null;
    },
    querySelectorAll(selector) {
      return nodes.get(selector) || [];
    }
  };
}

function auditTemplate(marketplace, templateName) {
  const template = fixtures.templates[templateName];
  const labelNode = { textContent: marketplace.labels[0] };
  const entries = templateName === 'search'
    ? {
        [template.root]: [{}],
        [template.core]: [{}],
        [template.sponsored]: [{}],
        [template.label]: [labelNode]
      }
    : {
        [template.root]: [{}],
        [template.title]: [{}],
        [template.purchase]: [{}],
        [template.sponsored]: [{}],
        [template.label]: [labelNode]
      };
  return health.auditDocument({
    document: createDocument(entries),
    pathname: template.pathname,
    locale: marketplace.tld,
    selectorPack,
    selectorPackSource: 'catalog',
    isSponsoredLabelText: value => isSponsoredLabelText(value, marketplace.labels),
    now: 1000
  });
}

test('declares exact-label fixtures for all 20 marketplace patterns', () => {
  assert.equal(fixtures.marketplaces.length, 20);
  assert.deepEqual(
    fixtures.marketplaces.map(({ domain, tld }) => ({ domain, tld })),
    locales.locales.map(({ domain, tld }) => ({ domain, tld }))
  );
  for (const marketplace of fixtures.marketplaces) {
    assert.deepEqual(selectorPack.localeLabels[marketplace.tld], marketplace.labels, marketplace.tld);
    assert.ok(marketplace.labels.length >= 2, `${marketplace.tld} needs native/English ad labels`);
    for (const label of marketplace.labels) {
      assert.equal(isSponsoredLabelText(label, marketplace.labels), true, `${marketplace.tld}: ${label}`);
      assert.ok(DEFAULT_LABELS.includes(label), `${label} is missing from the safe fallback set`);
    }
    assert.equal(
      isSponsoredLabelText(`${marketplace.labels[0]} product details`, marketplace.labels),
      false,
      `${marketplace.tld} must reject partial text matches`
    );
  }
});

test('marketplace fixtures use stable search and PDP hooks', () => {
  for (const [templateName, template] of Object.entries(fixtures.templates)) {
    for (const [name, selector] of Object.entries(template).filter(([name]) => name !== 'pathname')) {
      assert.doesNotMatch(selector, /[*^$]=|:nth-|\bclass\*|\bid\*/i, `${templateName}.${name}`);
      assert.match(selector, /^(?:#[a-z][\w-]*|\[data-component-type="[a-z-]+"\]|\.[a-z][\w-]*)$/i);
    }
  }
});

test('all marketplaces pass representative search and PDP structural audits', () => {
  for (const marketplace of fixtures.marketplaces) {
    for (const templateName of ['search', 'pdp']) {
      const snapshot = auditTemplate(marketplace, templateName);
      assert.equal(snapshot.status, 'healthy', `${marketplace.tld} ${templateName}`);
      assert.deepEqual(snapshot.missingCriticalHooks, [], `${marketplace.tld} ${templateName}`);
      assert.equal(snapshot.observed.sponsoredContainers, 1, `${marketplace.tld} ${templateName}`);
      assert.equal(snapshot.observed.sponsoredLabelNodes, 1, `${marketplace.tld} ${templateName}`);
      assert.equal(snapshot.observed.recognizedTextLabels, 1, `${marketplace.tld} ${templateName}`);
    }
  }
});
