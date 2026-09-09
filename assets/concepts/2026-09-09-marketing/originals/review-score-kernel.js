(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeReviewScoreKernel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_REVIEWS = 40;
  const MAX_TEXT_LENGTH = 700;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clean(value, maxLength = MAX_TEXT_LENGTH) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  function normalizeRating(value) {
    const rating = Number(value);
    return Number.isFinite(rating) && rating >= 1 && rating <= 5
      ? Math.round(rating * 10) / 10
      : null;
  }

  function normalizeReview(review, index = 0) {
    const source = review && typeof review === 'object' ? review : {};
    const text = clean(source.text || source.body);
    if (!text) return null;
    const title = clean(source.title, 180);
    const author = clean(source.author, 100);
    const id = clean(source.id || `${title}|${text}|${author}|${index}`, 180).toLowerCase();
    return {
      id,
      title,
      text,
      rating: normalizeRating(source.rating),
      verified: !!source.verified,
      author
    };
  }

  function normalizeReviews(reviews, max = MAX_REVIEWS) {
    const byId = new Map();
    (Array.isArray(reviews) ? reviews : []).slice(0, MAX_REVIEWS * 2).forEach((review, index) => {
      const normalized = normalizeReview(review, index);
      if (normalized) byId.set(normalized.id, normalized);
    });
    return Array.from(byId.values()).slice(0, Math.max(1, Math.min(MAX_REVIEWS, Number(max) || MAX_REVIEWS)));
  }

  function selectExtremes(reviews, limit = 2) {
    const normalized = normalizeReviews(reviews);
    const bounded = Math.max(1, Math.min(3, Number(limit) || 2));
    const rated = normalized.filter(review => review.rating !== null);
    const source = rated.length ? rated : normalized;
    const top = source.slice().sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, bounded);
    const topIds = new Set(top.map(review => review.id));
    const bottom = source.slice()
      .sort((a, b) => (a.rating ?? 6) - (b.rating ?? 6))
      .filter(review => !topIds.has(review.id))
      .slice(0, bounded);
    return { top, bottom };
  }

  function scoreReviews(reviews, totalReviewCount = 0) {
    const normalized = normalizeReviews(reviews);
    const rated = normalized.filter(review => review.rating !== null);
    if (!rated.length) return null;
    const average = rated.reduce((sum, review) => sum + review.rating, 0) / rated.length;
    const oneStarRatio = rated.filter(review => review.rating <= 2).length / rated.length;
    const fiveStarRatio = rated.filter(review => review.rating >= 4.5).length / rated.length;
    const polarization = oneStarRatio + fiveStarRatio;
    const verifiedCount = normalized.filter(review => review.verified).length;
    const verifiedRatio = normalized.length ? verifiedCount / normalized.length : 0;
    const count = Number(totalReviewCount);
    const volume = Number.isFinite(count) && count > 0 ? count : normalized.length;

    let score = (average / 5) * 6;
    score += Math.min(2, Math.log10(volume + 1) / 4);
    score += verifiedRatio;
    if (polarization > 0.75) score -= Math.min(0.8, (polarization - 0.75) * 3);
    if (oneStarRatio > 0.2) score -= Math.min(0.7, (oneStarRatio - 0.2) * 2);
    score = clamp(score, 1, 10);

    const bucket = score >= 7 ? 'Trustworthy' : score >= 4.5 ? 'Mixed' : 'Low trust';
    return {
      score: Math.round(score * 10) / 10,
      bucket,
      average: Math.round(average * 10) / 10,
      polarization: Math.round(polarization * 100),
      oneStar: Math.round(oneStarRatio * 100),
      verified: Math.round(verifiedRatio * 100),
      sampleSize: normalized.length,
      totalReviewCount: Number.isFinite(count) && count > 0 ? Math.round(count) : null
    };
  }

  return { MAX_REVIEWS, normalizeRating, normalizeReview, normalizeReviews, selectExtremes, scoreReviews };
});
