(function () {
  'use strict';

  const KERNEL = globalThis.AmzeReviewScoreKernel;
  const SHADOW_UI = globalThis.AmzeShadowUI;
  if (!KERNEL || !SHADOW_UI || typeof SHADOW_UI.mountElement !== 'function') return;

  const SITE_CONFIGS = [
    {
      name: 'Walmart',
      host: /(^|\.)walmart\.com$/i,
      productPath: /\/ip\//i,
      reviewSelectors: ['[data-testid="review"]', '[data-automation-id="review"]', '[data-testid*="review" i]', '[class*="review" i]'],
      titleSelectors: ['[data-testid*="review-title" i]', '[data-automation-id*="review-title" i]', 'h3', 'h4'],
      bodySelectors: ['[data-testid*="review-text" i]', '[data-automation-id*="review-text" i]', '[data-testid="review-body"]', 'p'],
      ratingSelectors: ['[data-testid*="rating" i]', '[data-automation-id*="rating" i]', '[aria-label*="out of 5" i]'],
      reviewCountSelectors: ['[data-testid*="review-count" i]', '[data-automation-id*="review-count" i]', 'a[href*="review" i]'],
      reviewSectionSelectors: ['[data-testid*="reviews" i]', '[data-automation-id*="reviews" i]']
    },
    {
      name: 'Target',
      host: /(^|\.)target\.com$/i,
      productPath: /\/p\/.*-\/[A-Z]-\d+/i,
      reviewSelectors: ['[data-test="review"]', '[data-testid="review"]', '[data-testid*="review" i]', '[class*="review" i]'],
      titleSelectors: ['[data-test*="review-title" i]', '[data-testid*="review-title" i]', 'h3', 'h4'],
      bodySelectors: ['[data-test*="review-text" i]', '[data-testid*="review-text" i]', '[itemprop="reviewBody"]', 'p'],
      ratingSelectors: ['[data-test*="rating" i]', '[data-testid*="rating" i]', '[aria-label*="out of 5" i]'],
      reviewCountSelectors: ['[data-test*="review-count" i]', '[data-testid*="review-count" i]', 'a[href*="review" i]'],
      reviewSectionSelectors: ['[data-test*="reviews" i]', '[data-testid*="reviews" i]']
    },
    {
      name: 'Best Buy',
      host: /(^|\.)bestbuy\.com$/i,
      productPath: /\/site\/.*\/\d+\.p(?:\?|$)/i,
      reviewSelectors: ['.review-item', '[data-testid*="review" i]', '[class*="review-item" i]', '[class*="review" i]'],
      titleSelectors: ['[data-testid*="review-title" i]', '[class*="review-title" i]', 'h3', 'h4'],
      bodySelectors: ['[data-testid*="review-text" i]', '[class*="review-text" i]', '[itemprop="reviewBody"]', 'p'],
      ratingSelectors: ['[data-testid*="rating" i]', '[class*="rating" i]', '[aria-label*="out of 5" i]'],
      reviewCountSelectors: ['[data-testid*="review-count" i]', '[class*="review-count" i]', 'a[href*="review" i]'],
      reviewSectionSelectors: ['[data-testid*="reviews" i]', '[class*="reviews" i]']
    },
    {
      name: 'Etsy',
      host: /(^|\.)etsy\.com$/i,
      productPath: /\/listing\/\d+/i,
      reviewSelectors: ['[data-review-id]', '[data-review]', '[data-testid*="review" i]', '[class*="review" i]'],
      titleSelectors: ['[data-review-title]', '[data-testid*="review-title" i]', 'h3', 'h4'],
      bodySelectors: ['[data-review-body]', '[data-testid*="review-text" i]', '[itemprop="reviewBody"]', 'p'],
      ratingSelectors: ['[data-rating]', '[aria-label*="out of 5" i]', '[class*="rating" i]'],
      reviewCountSelectors: ['[data-review-count]', '[data-testid*="review-count" i]', 'a[href*="review" i]'],
      reviewSectionSelectors: ['[data-testid*="reviews" i]', '[id*="reviews" i]', '[class*="reviews" i]']
    }
  ];

  let enabled = true;
  let panelHost = null;
  let observer = null;
  let timer = null;
  let lastSignature = '';

  function currentSite() {
    return SITE_CONFIGS.find(site => site.host.test(location.hostname) && site.productPath.test(location.pathname)) || null;
  }

  function readText(element, selectors, maxLength = 240) {
    if (!element) return '';
    for (const selector of selectors || []) {
      const node = element.querySelector(selector);
      if (!node) continue;
      const value = String(node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
      if (value) return value;
    }
    return '';
  }

  function parseRating(element, selectors) {
    const attr = element.getAttribute('data-rating') || element.getAttribute('data-score') || '';
    const value = attr || readText(element, selectors, 100);
    const match = value.match(/([\d.]+)\s*(?:out\s*of\s*5|\/\s*5|stars?)/i) || value.match(/^\s*([1-5](?:\.\d+)?)\s*$/);
    return match ? KERNEL.normalizeRating(match[1]) : null;
  }

  function parseReviewCount(value) {
    const match = String(value || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  function collectReviews(site) {
    const seen = new Set();
    const reviews = [];
    for (const selector of site.reviewSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (reviews.length >= KERNEL.MAX_REVIEWS || seen.has(element)) continue;
        const body = readText(element, site.bodySelectors, 700);
        if (!body) continue;
        const review = KERNEL.normalizeReview({
          id: element.getAttribute('data-review-id') || element.getAttribute('data-reviewid') || element.id || '',
          title: readText(element, site.titleSelectors, 180),
          text: body,
          rating: parseRating(element, site.ratingSelectors),
          verified: /verified\s+(?:purchase|buyer)|purchased/i.test(element.textContent || ''),
          author: readText(element, ['[data-review-author]', '[data-testid*="author" i]', '[class*="author" i]'], 100)
        }, reviews.length);
        if (!review || seen.has(review.id)) continue;
        seen.add(review.id);
        reviews.push(review);
      }
      if (reviews.length >= KERNEL.MAX_REVIEWS) break;
    }
    return reviews;
  }

  function totalReviewCount(site) {
    for (const selector of site.reviewCountSelectors) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const count = parseReviewCount(element.getAttribute('aria-label') || element.textContent);
      if (count) return count;
    }
    return 0;
  }

  function signature(reviews) {
    return reviews.map(review => `${review.id}:${review.rating}:${review.text}`).join('\u0001');
  }

  function createText(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function appendGroup(section, label, reviews) {
    if (!reviews.length) return;
    const group = createText('div', 'amze-review-excerpt-group', '');
    group.appendChild(createText('h5', '', label));
    reviews.forEach(review => {
      const card = createText('article', 'amze-review-excerpt', '');
      const rating = review.rating === null ? 'Unrated' : `${Number(review.rating).toFixed(1)}★`;
      card.appendChild(createText('span', 'amze-review-excerpt-rating', rating));
      if (review.title) card.appendChild(createText('strong', 'amze-review-excerpt-title', review.title));
      card.appendChild(createText('p', 'amze-review-excerpt-body', review.text));
      if (review.author || review.verified) {
        card.appendChild(createText('small', 'amze-review-excerpt-meta', [review.author, review.verified ? 'Verified buyer' : ''].filter(Boolean).join(' · ')));
      }
      group.appendChild(card);
    });
    section.appendChild(group);
  }

  function render(site, reviews, metrics) {
    const target = site.reviewSectionSelectors.map(selector => document.querySelector(selector)).find(Boolean)
      || document.querySelector('main')
      || document.body.firstElementChild;
    if (!target || !target.parentElement) return;
    panelHost?.remove();
    const panel = document.createElement('div');
    panel.id = 'amze-cross-site-review';
    panel.className = 'amze-pdp-badge amze-cross-site-review';
    panel.setAttribute('role', 'status');

    const heading = createText('h3', '', `AmazonEnhanced review analysis · ${site.name}`);
    heading.appendChild(createText('span', `amze-badge ${metrics.score >= 7 ? 'amze-badge-review-good' : metrics.score >= 4.5 ? 'amze-badge-review-mixed' : 'amze-badge-review-bad'}`, metrics.bucket));
    panel.appendChild(heading);
    panel.appendChild(createText('div', `amze-score ${metrics.score >= 7 ? 'amze-score-good' : metrics.score >= 4.5 ? 'amze-score-mixed' : 'amze-score-bad'}`, `${metrics.score.toFixed(1)} / 10`));

    const grid = createText('div', 'amze-metrics', '');
    [['Average rating', `${metrics.average.toFixed(1)} / 5`], ['Visible sample', String(metrics.sampleSize)], ['Polarization', `${metrics.polarization}%`], ['1–2★ share', `${metrics.oneStar}%`], ['Verified sample', `${metrics.verified}%`]].forEach(([label, value]) => {
      const metric = createText('div', 'amze-metric', `${label}: `);
      const strong = document.createElement('strong');
      strong.textContent = value;
      metric.appendChild(strong);
      grid.appendChild(metric);
    });
    if (metrics.totalReviewCount) {
      const metric = createText('div', 'amze-metric', 'Total reviews: ');
      const strong = document.createElement('strong');
      strong.textContent = metrics.totalReviewCount.toLocaleString();
      metric.appendChild(strong);
      grid.appendChild(metric);
    }
    panel.appendChild(grid);
    panel.appendChild(createText('p', 'amze-review-excerpts-note', 'Local heuristic from the visible review sample; it does not send review text anywhere.'));
    const excerpts = createText('section', 'amze-review-excerpts', '');
    const extremes = KERNEL.selectExtremes(reviews, 2);
    appendGroup(excerpts, 'Top-rated excerpts', extremes.top);
    appendGroup(excerpts, 'Lowest-rated excerpts', extremes.bottom);
    panel.appendChild(excerpts);

    const mounted = SHADOW_UI.mountElement(panel, target, 'before');
    if (mounted) panelHost = mounted.host;
  }

  function run() {
    if (!enabled) {
      panelHost?.remove();
      panelHost = null;
      lastSignature = '';
      return;
    }
    const site = currentSite();
    if (!site) return;
    const reviews = collectReviews(site);
    if (!reviews.length) return;
    const nextSignature = `${signature(reviews)}|${totalReviewCount(site)}`;
    if (nextSignature === lastSignature && panelHost?.isConnected) return;
    const metrics = KERNEL.scoreReviews(reviews, totalReviewCount(site));
    if (!metrics) return;
    lastSignature = nextSignature;
    render(site, reviews, metrics);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 220);
  }

  function loadSetting() {
    try {
      chrome.storage.local.get(['amzeSettings'], result => {
        enabled = !(result && result.amzeSettings && result.amzeSettings.flags && result.amzeSettings.flags.reviewScore === false);
        schedule();
      });
    } catch (e) {
      schedule();
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.amzeSettings) return;
      const next = changes.amzeSettings.newValue;
      enabled = !(next && next.flags && next.flags.reviewScore === false);
      schedule();
    });
  } catch (e) {}

  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  loadSetting();
})();
