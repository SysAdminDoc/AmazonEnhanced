const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_REVIEWS,
  normalizeReviews,
  selectExtremes,
  scoreReviews
} = require('../review-score-kernel.js');

test('normalizes a bounded cross-site review sample', () => {
  const reviews = normalizeReviews(Array.from({ length: MAX_REVIEWS + 5 }, (_, index) => ({
    id: `review-${index}`,
    text: `Review ${index}`,
    rating: 4
  })));
  assert.equal(reviews.length, MAX_REVIEWS);
});

test('scores rating, volume, verification, and polarized samples', () => {
  const score = scoreReviews([
    { id: 'good', text: 'Good', rating: 5, verified: true },
    { id: 'bad', text: 'Bad', rating: 1, verified: false },
    { id: 'mid', text: 'Mid', rating: 3, verified: true }
  ], 1200);
  assert.equal(score.sampleSize, 3);
  assert.equal(score.totalReviewCount, 1200);
  assert.equal(score.polarization, 67);
  assert.ok(score.score >= 1 && score.score <= 10);
});

test('selects distinct high and low excerpts', () => {
  const extremes = selectExtremes([
    { id: 'low', text: 'Bad', rating: 1 },
    { id: 'high', text: 'Great', rating: 5 },
    { id: 'mid', text: 'Okay', rating: 3 }
  ], 1);
  assert.equal(extremes.top[0].id, 'high');
  assert.equal(extremes.bottom[0].id, 'low');
});
