const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_WEIGHTS,
  normalizeWeights,
  normalizedMetrics,
  rankItems
} = require('../smart-sort.js');

test('normalizes weights and keeps only the supported slider range', () => {
  assert.deepEqual(normalizeWeights({ rating: 120, price: -4, trustScore: '35' }), {
    rating: 100,
    reviewCount: 0,
    price: 0,
    unitPrice: 0,
    trustScore: 35
  });
  assert.equal(DEFAULT_WEIGHTS.rating, 30);
});

test('normalizes lower-price fields in the desirable direction', () => {
  const rows = normalizedMetrics([
    { price: 10, unitPrice: 2, rating: 4 },
    { price: 20, unitPrice: 4, rating: 5 }
  ]);
  assert.equal(rows[0].price, 1);
  assert.equal(rows[1].price, 0);
  assert.equal(rows[1].rating, 1);
});

test('ranks weighted items stably while ignoring missing metrics', () => {
  const ranked = rankItems([
    { id: 'expensive', rating: 5, price: 30 },
    { id: 'cheap', rating: 4, price: 10 },
    { id: 'missing', rating: 4 }
  ], { rating: 0, price: 100, unitPrice: 100 });
  assert.deepEqual(ranked.map(item => item.id), ['cheap', 'expensive', 'missing']);
  assert.equal(ranked[0].score, 1);
});
