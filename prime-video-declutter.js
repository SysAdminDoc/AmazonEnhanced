(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    api.start(root, root.document, root.chrome);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STYLE_ID = 'amze-prime-video-declutter';
  const RULES = Object.freeze({
    hideVideoAds: [
      '#dv-player-ad-container',
      '.dv-player-ad-container',
      '.atvwebplayersdk-ad-container',
      '[data-testid*="ad-break" i]',
      '[id*="ad-break" i]',
      '[class*="ad-break" i]',
      '[class*="advertisement" i]',
      '.ad-overlay'
    ],
    hidePrimeNag: [
      '.tancaccept',
      '[data-testid="upsell"]',
      '[data-testid*="try-prime" i]',
      '[data-testid*="free-trial" i]',
      '[id*="prime-upsell" i]',
      '[class*="prime-upsell" i]',
      '[class*="subscribe-banner" i]'
    ],
    hideBanners: [
      '.dv-dp-top-banner',
      '.dv-hero-carousel',
      '.dv-superhero-carousel',
      '.av-hql-container'
    ],
    hideSponsored: [
      '[data-testid*="sponsored" i]',
      '[data-testid*="sponsor" i]'
    ]
  });

  function isPrimeVideoPage(locationLike) {
    return !!locationLike && /(^|\.)primevideo\.com$/i.test(String(locationLike.hostname || ''));
  }

  function getSelectors(flags) {
    const enabled = flags && typeof flags === 'object' ? flags : {};
    return Object.keys(RULES)
      .filter(flag => enabled[flag])
      .flatMap(flag => RULES[flag])
      .filter((selector, index, all) => all.indexOf(selector) === index);
  }

  function createCss(flags) {
    const selectors = getSelectors(flags);
    return selectors.length ? `${selectors.join(',\n')} { display: none !important; visibility: hidden !important; }` : '';
  }

  function applyStyle(documentLike, flags) {
    if (!documentLike) return null;
    let style = documentLike.getElementById(STYLE_ID);
    const css = createCss(flags);
    if (!css) {
      style?.remove();
      return null;
    }
    if (!style) {
      style = documentLike.createElement('style');
      style.id = STYLE_ID;
      (documentLike.head || documentLike.documentElement)?.appendChild(style);
    }
    style.textContent = css;
    return style;
  }

  function start(root, documentLike, chromeLike) {
    if (!documentLike || !isPrimeVideoPage(root && root.location)) return;
    let currentFlags = {};
    let observer = null;
    let retryTimer = null;

    const ensureStyle = () => {
      if (!documentLike.getElementById(STYLE_ID) && getSelectors(currentFlags).length && !documentLike.head && documentLike.documentElement) {
        retryTimer = root.setTimeout(ensureStyle, 50);
      } else {
        applyStyle(documentLike, currentFlags);
      }
    };
    const update = settings => {
      currentFlags = settings && settings.flags ? settings.flags : {};
      applyStyle(documentLike, currentFlags);
    };

    try {
      chromeLike?.storage?.local?.get(['amzeSettings'], result => update(result && result.amzeSettings));
      chromeLike?.storage?.onChanged?.addListener((changes, area) => {
        if (area === 'local' && changes.amzeSettings) update(changes.amzeSettings.newValue);
      });
    } catch (e) {}

    observer = new root.MutationObserver(() => {
      if (!documentLike.getElementById(STYLE_ID) && getSelectors(currentFlags).length) ensureStyle();
    });
    if (documentLike.documentElement) observer.observe(documentLike.documentElement, { childList: true, subtree: true });
    ensureStyle();
    return { observer, getStyle: () => documentLike.getElementById(STYLE_ID), dispose: () => {
      observer?.disconnect();
      if (retryTimer) root.clearTimeout(retryTimer);
      documentLike.getElementById(STYLE_ID)?.remove();
    } };
  }

  return { RULES, isPrimeVideoPage, getSelectors, createCss, applyStyle, start };
});
