const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractAsin,
  mergeVariantRecords,
  lowestLocalPrice,
  buildPriceIndex,
  decorateVariants
} = require('../variant-price.js');

test('extracts ASINs from Amazon variant URLs and attributes', () => {
  assert.equal(extractAsin('https://www.amazon.com/dp/B012345678?th=1'), 'B012345678');
  assert.equal(extractAsin('amzn1.asin.B012345678'), 'B012345678');
  assert.equal(extractAsin('B012345678'), 'B012345678');
  assert.equal(extractAsin('not-an-asin'), '');
});

test('merges repeated variant ASINs while retaining dimension labels', () => {
  assert.deepEqual(mergeVariantRecords([
    { asin: 'B012345678', label: 'Color: Black' },
    { asin: '/dp/B012345678', label: 'Size: Large' },
    { asin: 'B087654321', label: 'Color: White' }
  ]), [
    { asin: 'B012345678', label: 'Color: Black / Size: Large' },
    { asin: 'B087654321', label: 'Color: White' }
  ]);
});

test('indexes the lowest local price and falls back to the active price', () => {
  const entries = [{ asin: 'B012345678', points: [{ p: 18, t: 1 }, { p: 14, t: 2 }] }];
  assert.equal(lowestLocalPrice(entries[0].points), 14);
  assert.deepEqual(buildPriceIndex(entries), { B012345678: 14 });
  assert.deepEqual(decorateVariants([
    { asin: 'B012345678', label: 'Tracked' },
    { asin: 'B087654321', label: 'Current' }
  ], entries, 'B087654321', 22), [
    { asin: 'B012345678', label: 'Tracked', lowestPrice: 14, source: 'history' },
    { asin: 'B087654321', label: 'Current', lowestPrice: 22, source: 'current' }
  ]);
});
