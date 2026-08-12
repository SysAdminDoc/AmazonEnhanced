(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeReviewCorpus = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_VISIBLE_REVIEWS = 20;
  const MAX_CACHED_REVIEWS = 60;
  const MAX_EXCERPTS = 3;
  const MAX_TEXT_LENGTH = 600;

  function clamp(value, max) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function normalizeRating(value) {
    const rating = Number(value);
    return Number.isFinite(rating) && rating >= 1 && rating <= 5 ? Math.round(rating * 10) / 10 : null;
  }

  function reviewKey(review) {
    const source = review || {};
    if (source.id) return clamp(source.id, 120);
    return clamp([source.title, source.text, source.author].map(value => clamp(value, 120)).join('|').toLowerCase(), 240);
  }

  function normalizeReview(review, now = Date.now()) {
    const source = review && typeof review === 'object' ? review : {};
    const text = clamp(source.text || source.body, MAX_TEXT_LENGTH);
    if (!text) return null;
    const normalized = {
      id: reviewKey(source),
      title: clamp(source.title, 180),
      text,
      rating: normalizeRating(source.rating),
      verified: !!source.verified,
      author: clamp(source.author, 100),
      capturedAt: Number.isFinite(source.capturedAt) ? source.capturedAt : now
    };
    return normalized.id ? normalized : null;
  }

  function normalizeReviews(reviews, max = MAX_CACHED_REVIEWS) {
    const byId = new Map();
    for (const review of Array.isArray(reviews) ? reviews : []) {
      const normalized = normalizeReview(review);
      if (normalized) byId.set(normalized.id, normalized);
    }
    return Array.from(byId.values())
      .sort((a, b) => a.capturedAt - b.capturedAt)
      .slice(-Math.max(1, Math.min(MAX_CACHED_REVIEWS, max)));
  }

  function mergeReviews(existing, incoming, max = MAX_CACHED_REVIEWS) {
    return normalizeReviews([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])], max);
  }

  function selectExtremes(reviews, limit = MAX_EXCERPTS) {
    const normalized = normalizeReviews(reviews);
    const bounded = Math.max(1, Math.min(MAX_EXCERPTS, Number(limit) || MAX_EXCERPTS));
    const rated = normalized.filter(review => review.rating !== null);
    const source = rated.length ? rated : normalized;
    const top = source.slice().sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.capturedAt - a.capturedAt).slice(0, bounded);
    const topIds = new Set(top.map(review => review.id));
    const bottom = source.slice().sort((a, b) => (a.rating ?? 6) - (b.rating ?? 6) || b.capturedAt - a.capturedAt)
      .filter(review => !topIds.has(review.id))
      .slice(0, bounded);
    return { top, bottom };
  }

  function signature(reviews) {
    return normalizeReviews(reviews).map(review => `${review.id}:${review.rating}:${review.text}`).join('\u0001');
  }

  function createCorpus(asin, reviews, updatedAt = Date.now()) {
    return {
      asin: String(asin || '').toUpperCase(),
      reviews: normalizeReviews(reviews),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
    };
  }

  return {
    MAX_VISIBLE_REVIEWS,
    MAX_CACHED_REVIEWS,
    MAX_EXCERPTS,
    normalizeRating,
    reviewKey,
    normalizeReview,
    normalizeReviews,
    mergeReviews,
    selectExtremes,
    signature,
    createCorpus
  };
});
