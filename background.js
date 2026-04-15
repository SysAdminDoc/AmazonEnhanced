/**
 * AmazonEnhanced — background.js (MV3 service worker)
 *
 * Responsibilities:
 *   - Seed default settings on install.
 *   - Relay popup <-> active-tab messages.
 *   - No alarms currently (reserved for future price-snapshot caching).
 */

const DEFAULT_SETTINGS = {
  theme: 'dark',
  density: 'comfortable',
  flags: {
    hideSponsored: true,
    shadeSponsored: false,
    hideVideoAds: true,
    hidePrimeNag: true,
    hideBanners: true,
    hideAmazonBrands: false,
    hideCustomBrands: false,
    hideCN: false,
    reviewScore: true,
    pricePerUnit: true,
    listPriceWarn: true,
    stripAffiliate: true,
    hideBrandsRelated: true,
    hideInspired: true,
    hideAlsoBought: true,
    hideBuyAgain: false,
    hideClimate: false,
    hideEditorial: true,
    hideManufacturer: false,
    hideCompare: false,
    hideSubSave: true,
    hideCartUpsell: true,
    hideHomeClutter: true,
    hideFooter: false,
    hidePadding: true
  },
  customBrands: '',
  toastsEnabled: true
};

chrome.runtime.onInstalled.addListener(async (details) => {
  const { amzeSettings } = await chrome.storage.local.get(['amzeSettings']);
  if (!amzeSettings) {
    await chrome.storage.local.set({ amzeSettings: DEFAULT_SETTINGS });
  } else {
    // Forward-migrate: ensure all flags exist.
    const merged = Object.assign({}, DEFAULT_SETTINGS, amzeSettings, {
      flags: Object.assign({}, DEFAULT_SETTINGS.flags, amzeSettings.flags || {})
    });
    await chrome.storage.local.set({ amzeSettings: merged });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'AMZE_BROADCAST_SETTINGS') {
    // Popup requested broadcast to all Amazon tabs.
    chrome.tabs.query({ url: [
      '*://*.amazon.com/*', '*://*.amazon.co.uk/*', '*://*.amazon.ca/*',
      '*://*.amazon.de/*', '*://*.amazon.fr/*', '*://*.amazon.it/*',
      '*://*.amazon.es/*', '*://*.amazon.nl/*', '*://*.amazon.pl/*',
      '*://*.amazon.se/*', '*://*.amazon.com.tr/*', '*://*.amazon.in/*',
      '*://*.amazon.co.jp/*', '*://*.amazon.com.au/*', '*://*.amazon.com.mx/*',
      '*://*.amazon.com.br/*', '*://*.amazon.sg/*', '*://*.amazon.sa/*',
      '*://*.amazon.ae/*', '*://*.amazon.eg/*'
    ]}, (tabs) => {
      for (const t of tabs) {
        chrome.tabs.sendMessage(t.id, { type: 'AMZE_SETTINGS_UPDATED', settings: msg.settings }).catch(() => {});
      }
      sendResponse({ ok: true, count: tabs.length });
    });
    return true;
  }
});
