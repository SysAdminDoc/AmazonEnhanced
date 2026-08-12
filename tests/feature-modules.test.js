const test = require('node:test');
const assert = require('node:assert/strict');
const { getFiles, filterAllowedFiles } = require('../feature-modules.js');

test('maps active flags to deduplicated feature bundles', () => {
  assert.deepEqual(getFiles({ priceHistory: true, dealBadgeNormalizer: true, orderExport: true }), [
    'price-history.js',
    'price-history-io.js',
    'invoice-export.js',
    'zip-store.js',
    'receipt-markdown.js'
  ]);
  assert.deepEqual(getFiles({ pricePerUnit: false, variantPriceMap: false }), []);
});

test('rejects files outside the packaged feature allowlist', () => {
  assert.deepEqual(filterAllowedFiles(['unit-price.js', 'content.js', 'unit-price.js', '../background.js']), ['unit-price.js']);
});
