const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPrimeVideoPage,
  getSelectors,
  createCss
} = require('../prime-video-declutter.js');

test('recognizes Prime Video hosts without matching lookalike domains', () => {
  assert.equal(isPrimeVideoPage({ hostname: 'www.primevideo.com' }), true);
  assert.equal(isPrimeVideoPage({ hostname: 'primevideo.com' }), true);
  assert.equal(isPrimeVideoPage({ hostname: 'primevideo.example.com' }), false);
});

test('maps existing declutter flags to bounded Prime Video selectors', () => {
  const selectors = getSelectors({ hideVideoAds: true, hidePrimeNag: true, hideBanners: false });
  assert.ok(selectors.includes('#dv-player-ad-container'));
  assert.ok(selectors.includes('[data-testid="upsell"]'));
  assert.equal(selectors.includes('.dv-hero-carousel'), false);
  assert.equal(new Set(selectors).size, selectors.length);
});

test('creates removable CSS only for enabled flags', () => {
  assert.match(createCss({ hideBanners: true }), /\.dv-hero-carousel/);
  assert.equal(createCss({}), '');
});
