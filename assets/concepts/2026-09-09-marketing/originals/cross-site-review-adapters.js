(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeCrossSiteReviewAdapters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SITE_CONFIGS = Object.freeze([
    Object.freeze({
      id: 'walmart',
      name: 'Walmart',
      host: /(^|\.)walmart\.com$/i,
      productPath: /^\/ip\/(?:[^/]+\/)?\d+(?:\/|$)/i,
      reviewSelectors: Object.freeze(['[data-testid="review"]', '[data-automation-id="review"]']),
      titleSelectors: Object.freeze(['[data-testid="review-title"]', '[data-automation-id="review-title"]']),
      bodySelectors: Object.freeze(['[data-testid="review-text"]', '[data-automation-id="review-text"]', '[data-testid="review-body"]']),
      ratingSelectors: Object.freeze(['[data-testid="review-rating"]', '[data-automation-id="review-rating"]', '[aria-label$="out of 5 stars" i]', '[aria-label$="out of 5" i]']),
      reviewCountSelectors: Object.freeze(['[data-testid="review-count"]', '[data-automation-id="review-count"]', 'a[href$="#reviews"]']),
      reviewSectionSelectors: Object.freeze(['[data-testid="reviews"]', '[data-automation-id="reviews"]']),
      authorSelectors: Object.freeze(['[data-testid="review-author"]', '[data-automation-id="review-author"]'])
    }),
    Object.freeze({
      id: 'target',
      name: 'Target',
      host: /(^|\.)target\.com$/i,
      productPath: /^\/p\/(?:[^/]+\/)?-\/A-\d+(?:\/|$)/i,
      reviewSelectors: Object.freeze(['[data-test="review"]', '[data-testid="review"]']),
      titleSelectors: Object.freeze(['[data-test="review-title"]', '[data-testid="review-title"]']),
      bodySelectors: Object.freeze(['[data-test="review-text"]', '[data-testid="review-text"]', '[itemprop="reviewBody"]']),
      ratingSelectors: Object.freeze(['[data-test="review-rating"]', '[data-testid="review-rating"]', '[aria-label$="out of 5 stars" i]', '[aria-label$="out of 5" i]']),
      reviewCountSelectors: Object.freeze(['[data-test="review-count"]', '[data-testid="review-count"]', 'a[href$="#reviews"]']),
      reviewSectionSelectors: Object.freeze(['[data-test="reviews"]', '[data-testid="reviews"]']),
      authorSelectors: Object.freeze(['[data-test="review-author"]', '[data-testid="review-author"]'])
    }),
    Object.freeze({
      id: 'bestbuy',
      name: 'Best Buy',
      host: /(^|\.)bestbuy\.com$/i,
      productPath: /^(?:\/site\/[^/]+\/\d+\.p(?:\/|$)|\/product\/[^/]+\/sku\/\d+(?:\/|$))/i,
      reviewSelectors: Object.freeze(['.review-item', '[data-testid="review-item"]', '[data-review-id]']),
      titleSelectors: Object.freeze(['.review-title', '[data-testid="review-title"]']),
      bodySelectors: Object.freeze(['.ugc-review-body', '.review-text', '[data-testid="review-text"]', '[itemprop="reviewBody"]']),
      ratingSelectors: Object.freeze(['.review-rating', '[data-testid="review-rating"]', '[aria-label$="out of 5 stars" i]', '[aria-label$="out of 5" i]']),
      reviewCountSelectors: Object.freeze(['.review-count', '[data-testid="review-count"]', 'a[href$="#reviews"]']),
      reviewSectionSelectors: Object.freeze(['.reviews-list', '.reviews-content', '[data-testid="reviews"]']),
      authorSelectors: Object.freeze(['.ugc-author', '.review-author', '[data-testid="review-author"]'])
    }),
    Object.freeze({
      id: 'etsy',
      name: 'Etsy',
      host: /(^|\.)etsy\.com$/i,
      productPath: /^\/listing\/\d+(?:\/|$)/i,
      reviewSelectors: Object.freeze(['[data-review-id]', '[data-review]', '[data-testid="review"]']),
      titleSelectors: Object.freeze(['[data-review-title]', '[data-testid="review-title"]']),
      bodySelectors: Object.freeze(['[data-review-body]', '[data-testid="review-text"]', '[itemprop="reviewBody"]']),
      ratingSelectors: Object.freeze(['[data-rating]', '[data-testid="review-rating"]', '[aria-label$="out of 5 stars" i]', '[aria-label$="out of 5" i]']),
      reviewCountSelectors: Object.freeze(['[data-review-count]', '[data-testid="review-count"]', 'a[href$="#reviews"]']),
      reviewSectionSelectors: Object.freeze(['[data-testid="reviews"]', '[id="reviews"]', '[data-reviews]']),
      authorSelectors: Object.freeze(['[data-review-author]', '[data-testid="review-author"]'])
    })
  ]);

  function findSite(hostname, pathname) {
    const host = String(hostname || '').toLowerCase();
    const path = String(pathname || '/');
    return SITE_CONFIGS.find(site => site.host.test(host) && site.productPath.test(path)) || null;
  }

  function routeKey(locationLike) {
    const site = findSite(locationLike && locationLike.hostname, locationLike && locationLike.pathname);
    return site ? `${site.id}:${String(locationLike.pathname || '/')}` : '';
  }

  function readText(element, selectors, maxLength = 240) {
    if (!element) return '';
    for (const selector of selectors || []) {
      const node = element.querySelector(selector);
      if (!node) continue;
      const value = String(node.getAttribute('aria-label') || node.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
      if (value) return value;
    }
    return '';
  }

  function parseRating(element, selectors, normalizeRating) {
    if (!element) return null;
    let value = element.getAttribute('data-rating') || element.getAttribute('data-score') || '';
    if (!value) {
      for (const selector of selectors || []) {
        const node = element.querySelector(selector);
        if (!node) continue;
        value = node.getAttribute('data-rating')
          || node.getAttribute('data-score')
          || node.getAttribute('aria-label')
          || node.textContent
          || '';
        if (String(value).trim()) break;
      }
    }
    value = String(value);
    const match = value.match(/([\d.]+)\s*(?:out\s*of\s*5|\/\s*5|stars?)/i)
      || value.match(/^\s*([1-5](?:\.\d+)?)\s*$/);
    return match && typeof normalizeRating === 'function' ? normalizeRating(match[1]) : null;
  }

  function parseReviewCount(value) {
    const normalized = String(value || '').replace(/,/g, '').trim();
    const match = normalized.match(/(\d+(?:\.\d+)?)\s*([km])?/i);
    if (!match) return 0;
    const multiplier = String(match[2] || '').toLowerCase() === 'k'
      ? 1000
      : String(match[2] || '').toLowerCase() === 'm' ? 1000000 : 1;
    return Math.round(Number(match[1]) * multiplier);
  }

  function collectReviews(documentLike, site, kernel) {
    if (!documentLike || !site || !kernel) return [];
    const seenElements = new Set();
    const seenIds = new Set();
    const reviews = [];
    for (const selector of site.reviewSelectors) {
      for (const element of documentLike.querySelectorAll(selector)) {
        if (reviews.length >= kernel.MAX_REVIEWS || seenElements.has(element)) continue;
        seenElements.add(element);
        const body = readText(element, site.bodySelectors, 700);
        if (!body) continue;
        const review = kernel.normalizeReview({
          id: element.getAttribute('data-review-id') || element.getAttribute('data-reviewid') || element.id || '',
          title: readText(element, site.titleSelectors, 180),
          text: body,
          rating: parseRating(element, site.ratingSelectors, kernel.normalizeRating),
          verified: /verified\s+(?:purchase|buyer)|purchased/i.test(element.textContent || ''),
          author: readText(element, site.authorSelectors, 100)
        }, reviews.length);
        if (!review || seenIds.has(review.id)) continue;
        seenIds.add(review.id);
        reviews.push(review);
      }
      if (reviews.length >= kernel.MAX_REVIEWS) break;
    }
    return reviews;
  }

  function totalReviewCount(documentLike, site) {
    if (!documentLike || !site) return 0;
    for (const selector of site.reviewCountSelectors) {
      const element = documentLike.querySelector(selector);
      if (!element) continue;
      const count = parseReviewCount(element.getAttribute('aria-label') || element.textContent);
      if (count) return count;
    }
    return 0;
  }

  return {
    SITE_CONFIGS,
    findSite,
    routeKey,
    readText,
    parseRating,
    parseReviewCount,
    collectReviews,
    totalReviewCount
  };
});
