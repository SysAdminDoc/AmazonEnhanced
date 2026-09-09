const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSnapshot,
  isLikelyDuplicate,
  findDuplicateCandidates,
  diffSnapshots
} = require('../pdp-diff.js');

test('normalizes bounded PDP snapshot fields', () => {
  const snapshot = normalizeSnapshot({
    asin: 'b000000001',
    title: '  Widget   Pro ',
    price: '12.345',
    seller: ' Seller ',
    updatedAt: 10
  });
  assert.deepEqual(snapshot, {
    asin: 'B000000001',
    title: 'Widget Pro',
    brand: '',
    price: 12.35,
    unitPrice: null,
    seller: 'Seller',
    availability: '',
    shipping: '',
    variant: '',
    updatedAt: 10
  });
});

test('finds same-brand duplicate listings but rejects unrelated titles', () => {
  const current = { asin: 'B000000001', title: 'Acme Widget Pro 12 Ounce Blue', brand: 'Acme', price: 20 };
  assert.equal(isLikelyDuplicate(current, { asin: 'B000000002', title: 'Acme Widget Pro 12 Ounce Red', brand: 'Acme' }), true);
  assert.equal(isLikelyDuplicate(current, { asin: 'B000000003', title: 'Different Coffee Beans', brand: 'Other' }), false);
  const candidates = findDuplicateCandidates(current, [
    { asin: 'B000000002', title: 'Acme Widget Pro 12 Ounce Red', brand: 'Acme', price: 17, updatedAt: 2 },
    { asin: 'B000000003', title: 'Different Coffee Beans', brand: 'Other', price: 8, updatedAt: 3 }
  ]);
  assert.deepEqual(candidates.map(candidate => candidate.asin), ['B000000002']);
});

test('reports changed fields for side-by-side rendering', () => {
  const rows = diffSnapshots(
    { asin: 'B000000001', title: 'Widget', price: 20, seller: 'Acme' },
    { asin: 'B000000002', title: 'Widget', price: 17, seller: 'Other' }
  );
  assert.equal(rows.find(row => row.field === 'price').changed, true);
  assert.equal(rows.find(row => row.field === 'title').changed, false);
});
