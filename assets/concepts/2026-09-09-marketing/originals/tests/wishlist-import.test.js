const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_IMPORT_ITEMS,
  extractAsin,
  normalizeWishlistItems,
  parseWishlistImport,
  buildProductUrl
} = require('../wishlist-import.js');

test('extracts ASINs from exported product URLs and direct values', () => {
  assert.equal(extractAsin('B012345678'), 'B012345678');
  assert.equal(extractAsin('https://www.amazon.com/dp/b012345678?tag=old'), 'B012345678');
  assert.equal(extractAsin('/gp/product/B012345678/ref=foo'), 'B012345678');
  assert.equal(extractAsin('https://www.amazon.com/gp/aw/d/B012345678'), '');
});

test('normalizes the existing wishlist JSON export and deduplicates ASINs', () => {
  const items = parseWishlistImport(JSON.stringify([
    { asin: 'b012345678', title: ' First item ', price: '$12.00', url: 'https://amazon.com/dp/B012345678' },
    { url: 'https://amazon.com/dp/B012345678', title: 'Duplicate' },
    { asin: 'B087654321', name: 'Second item' },
    { asin: 'not-an-asin', title: 'Skip me' }
  ]));
  assert.deepEqual(items, [
    { asin: 'B012345678', title: 'First item', price: '$12.00', url: 'https://amazon.com/dp/B012345678' },
    { asin: 'B087654321', title: 'Second item', price: '', url: '' }
  ]);
});

test('accepts an object envelope and rejects invalid or oversized imports', () => {
  assert.deepEqual(normalizeWishlistItems({ items: [{ asin: 'B012345678' }] }), [
    { asin: 'B012345678', title: '', price: '', url: '' }
  ]);
  assert.throws(() => parseWishlistImport('{bad json'), /not valid/);
  assert.throws(() => normalizeWishlistItems({ items: [] }), /No valid/);
  assert.throws(() => normalizeWishlistItems(
    { items: Array.from({ length: MAX_IMPORT_ITEMS + 1 }, (_, i) => ({ asin: `B${String(i).padStart(9, '0')}` })) }
  ), /limited/);
});

test('builds a product URL on the current Amazon locale', () => {
  assert.equal(buildProductUrl('www.amazon.co.uk', 'b012345678'), 'https://www.amazon.co.uk/dp/B012345678');
  assert.equal(buildProductUrl('https://www.amazon.com/path', 'not-an-asin'), '');
});
