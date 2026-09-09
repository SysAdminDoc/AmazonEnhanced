(function () {
  'use strict';

  const KERNEL = globalThis.AmzeReviewScoreKernel;
  const SHADOW_UI = globalThis.AmzeShadowUI;
  const ADAPTERS = globalThis.AmzeCrossSiteReviewAdapters;
  if (!KERNEL || !ADAPTERS || !SHADOW_UI || typeof SHADOW_UI.mountElement !== 'function') return;

  let enabled = true;
  let panelHost = null;
  let observer = null;
  let timer = null;
  let routeTimer = null;
  let lastSignature = '';
  let lastRouteKey = '';
  let observedPath = `${location.hostname}${location.pathname}`;

  function currentSite() {
    return ADAPTERS.findSite(location.hostname, location.pathname);
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
    const site = currentSite();
    const nextRouteKey = ADAPTERS.routeKey(location);
    if (nextRouteKey !== lastRouteKey) {
      panelHost?.remove();
      panelHost = null;
      lastSignature = '';
      lastRouteKey = nextRouteKey;
    }
    if (!enabled) {
      panelHost?.remove();
      panelHost = null;
      lastSignature = '';
      return;
    }
    if (!site) {
      panelHost?.remove();
      panelHost = null;
      lastSignature = '';
      return;
    }
    const reviews = ADAPTERS.collectReviews(document, site, KERNEL);
    if (!reviews.length) {
      panelHost?.remove();
      panelHost = null;
      lastSignature = '';
      return;
    }
    const reviewCount = ADAPTERS.totalReviewCount(document, site);
    const nextSignature = `${signature(reviews)}|${reviewCount}`;
    if (nextSignature === lastSignature && panelHost?.isConnected) return;
    const metrics = KERNEL.scoreReviews(reviews, reviewCount);
    if (!metrics) return;
    lastSignature = nextSignature;
    render(site, reviews, metrics);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 220);
  }

  function checkRoute() {
    const nextPath = `${location.hostname}${location.pathname}`;
    if (nextPath === observedPath) return;
    observedPath = nextPath;
    schedule();
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
  addEventListener('popstate', checkRoute);
  addEventListener('hashchange', checkRoute);
  try { navigation?.addEventListener('navigatesuccess', checkRoute); } catch (e) {}
  routeTimer = setInterval(checkRoute, 500);
  addEventListener('pagehide', () => clearInterval(routeTimer), { once: true });
  loadSetting();
})();
