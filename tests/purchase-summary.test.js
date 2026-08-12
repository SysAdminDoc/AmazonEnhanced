const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAsin,
  mergePurchaseSummary,
  summarizeEntries
} = require('../purchase-summary.js');

test('normalizes ASINs from direct values and product URLs', () => {
  assert.equal(normalizeAsin('b000000001'), 'B000000001');
  assert.equal(normalizeAsin('https://www.amazon.com/dp/B000000002'), 'B000000002');
});

test('deduplicates repeated order cards while counting quantities', () => {
  const orders = [{
    orderId: '111-1111111-1111111',
    date: 'January 1, 2026',
    items: [{ asin: 'B000000001', title: 'Coffee', quantity: 2, subscription: true }]
  }];
  const first = mergePurchaseSummary([], orders, 10);
  const repeated = mergePurchaseSummary(first, orders, 20);
  assert.equal(first[0].purchaseCount, 2);
  assert.equal(first[0].subscriptionCount, 2);
  assert.equal(repeated[0].purchaseCount, 2);
});

test('summarizes only repeated products with cleanup suggestions', () => {
  const summary = summarizeEntries([
    { asin: 'B000000001', title: 'Coffee', purchaseCount: 3, subscriptionCount: 3, orderIds: [] },
    { asin: 'B000000002', title: 'One-off', purchaseCount: 1, subscriptionCount: 0, orderIds: [] }
  ]);
  assert.equal(summary.length, 1);
  assert.match(summary[0].suggestion, /Subscribe & Save/);
});
