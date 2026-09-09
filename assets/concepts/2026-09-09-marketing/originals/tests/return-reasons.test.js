const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isFrequentlyReturnedText,
  isLikelyReturnReason,
  extractReturnReasons
} = require('../return-reasons.js');

test('recognizes Amazon frequent-return disclosures only', () => {
  assert.equal(isFrequentlyReturnedText('This item is frequently returned'), true);
  assert.equal(isFrequentlyReturnedText('This product is returned more often than similar items'), true);
  assert.equal(isFrequentlyReturnedText('Easy returns within 30 days'), false);
});

test('extracts a bounded, deduplicated reason breakdown', () => {
  assert.equal(isLikelyReturnReason('Smaller than expected'), true);
  assert.equal(isLikelyReturnReason('Returns'), false);
  assert.deepEqual(extractReturnReasons([
    'Top reason: Smaller than expected',
    'Quality did not meet expectations',
    'Top reason: smaller than expected',
    'Returns'
  ]), ['Smaller than expected', 'Quality did not meet expectations']);
});
