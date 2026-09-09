const test = require('node:test');
const assert = require('node:assert/strict');
const { isRecommendedUpgradePrompt, isSafeSkipAction } = require('../upgrade-skip.js');

test('recognizes recommended-upgrade prompt text without matching normal recommendations', () => {
  assert.equal(isRecommendedUpgradePrompt('Recommended upgrade for your cart'), true);
  assert.equal(isRecommendedUpgradePrompt('Recommended for you'), false);
  assert.equal(isRecommendedUpgradePrompt('Upgrade your current plan'), false);
});

test('allows only explicit non-upgrade actions', () => {
  assert.equal(isSafeSkipAction('No thanks'), true);
  assert.equal(isSafeSkipAction('Continue without the upgrade'), true);
  assert.equal(isSafeSkipAction('Skip upgrade'), true);
  assert.equal(isSafeSkipAction('Continue'), false);
  assert.equal(isSafeSkipAction('Upgrade now'), false);
});
