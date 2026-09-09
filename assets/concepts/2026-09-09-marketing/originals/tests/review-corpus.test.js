const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_CACHED_REVIEWS,
  normalizeReview,
  mergeReviews,
  selectExtremes,
  signature,
  createCorpus
} = require('../review-corpus.js');

test('normalizes bounded review fields and rejects empty bodies', () => {
  assert.equal(normalizeReview({ title: 'Empty', text: '  ' }), null);
  const review = normalizeReview({
    id: 'R1',
    title: '  Good   fit ',
    text: '  Comfortable   and sturdy. ',
    rating: '4.6',
    verified: 1,
    author: ' A ',
    capturedAt: 10
  });
  assert.deepEqual(review, {
    id: 'R1',
    title: 'Good fit',
    text: 'Comfortable and sturdy.',
    rating: 4.6,
    verified: true,
    author: 'A',
    capturedAt: 10
  });
});

test('merges duplicate reviews and caps the local corpus', () => {
  const reviews = Array.from({ length: MAX_CACHED_REVIEWS + 5 }, (_, i) => ({
    id: `R${i}`,
    text: `Review ${i}`,
    rating: (i % 5) + 1,
    capturedAt: i
  }));
  const merged = mergeReviews(reviews, [{ id: 'R2', text: 'Updated review', rating: 2, capturedAt: 1000 }]);
  assert.equal(merged.length, MAX_CACHED_REVIEWS);
  assert.equal(merged.some(review => review.id === 'R2' && review.text === 'Updated review'), true);
  assert.equal(merged[0].id, 'R6');
});

test('selects distinct top and bottom excerpts and creates stable signatures', () => {
  const reviews = [
    { id: 'low', text: 'Bad', rating: 1, capturedAt: 1 },
    { id: 'high', text: 'Great', rating: 5, capturedAt: 2 },
    { id: 'mid', text: 'Okay', rating: 3, capturedAt: 3 }
  ];
  const extremes = selectExtremes(reviews, 1);
  assert.equal(extremes.top[0].id, 'high');
  assert.equal(extremes.bottom[0].id, 'low');
  assert.equal(signature(reviews), signature(reviews.slice().reverse()));
  assert.equal(createCorpus('b000000001', reviews, 22).reviews.length, 3);
});
