const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../network-rules.js');

test('recognizes only supported Amazon marketplace hosts', () => {
  assert.equal(rules.isAmazonHost('www.amazon.com'), true);
  assert.equal(rules.isAmazonHost('smile.amazon.co.uk'), true);
  assert.equal(rules.isAmazonHost('amazon.com.evil.example'), false);
  assert.equal(rules.isAmazonHost('foo.amazon.invalid'), false);
  assert.equal(rules.isAmazonHost('amazon-example.com'), false);
});

test('tracking cleanup keeps product and search state', () => {
  for (const key of ['keywords', 'psc', 'sr', 'th']) {
    assert.equal(rules.STRIP_PARAMS.includes(key), false, `${key} must be preserved`);
  }
  for (const key of ['tag', 'pd_rd_wg', 'pd_rd_plhdr', 'pf_rd_p']) {
    assert.equal(rules.STRIP_PARAMS.includes(key), true, `${key} should be removed`);
  }
});

test('builds precise affiliate rules for every supported marketplace', () => {
  const built = rules.buildAffiliateRules(true);
  assert.equal(built.length, rules.AMAZON_DOMAINS.length);
  assert.deepEqual(new Set(built.map(rule => rule.id)).size, built.length);
  assert.ok(built.every(rule => rule.condition.urlFilter.startsWith('||amazon.')));
  assert.equal(rules.buildAffiliateRules(false).length, 0);
});

test('ad rules are scoped to observed ad endpoints and Amazon initiators', () => {
  const built = rules.buildAdBlockRules(true);
  assert.equal(built.length, rules.AD_FILTERS.length);
  assert.ok(built.every(rule => rule.action.type === 'block'));
  const siteScoped = built.filter(rule => rule.condition.urlFilter !== '||advertising.amazon.dev/');
  assert.ok(siteScoped.every(rule => rule.condition.initiatorDomains.includes('amazon.com')));
  assert.ok(siteScoped.every(rule => rule.condition.initiatorDomains.includes('primevideo.com')));
  assert.ok(built.some(rule => rule.condition.urlFilter === '||amazon-adsystem.com/'));
  assert.ok(built.some(rule => rule.condition.urlFilter === '||advertising.amazon.dev/'
    && !rule.condition.initiatorDomains));
  assert.ok(!built.some(rule => rule.condition.urlFilter.includes('fls-na.amazon.com')));
  assert.equal(rules.buildAdBlockRules(false).length, 0);
});

test('dynamic rule ids remain unique across rule families', () => {
  const built = rules.buildDynamicRules({ stripAffiliate: true, hideSponsored: true });
  assert.equal(new Set(built.map(rule => rule.id)).size, built.length);
  assert.deepEqual(
    new Set(built.map(rule => rule.id)),
    new Set(rules.MANAGED_RULE_IDS)
  );
});
