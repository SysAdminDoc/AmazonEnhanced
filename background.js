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
  imageMode: 'tile',
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
    hidePadding: true,
    autoDeclineWarranty: true,
    forceOneTimePurchase: true,
    autoUncheckDarkPatterns: true,
    extraSortOptions: true,
    cpuTamer: false,
    countryBadge: true,
    revealSeller: true,
    variationBait: true,
    priceHistory: true,
    copyCleanLink: true,
    orderExport: true,
    wishlistExport: true,
    lateDeliveryWatch: false,
    largeText: false,
    highContrast: false,
    ariaFixes: true,
    allergenScan: false
  },
  customBrands: '',
  allergens: '',
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

// -------------------------------------------------------------------
// v2.0: Late-delivery watcher
//
// Content script on /your-orders sends AMZE_SEED_ORDERS with each
// visible order's promised delivery date. We persist those to
// chrome.storage.local and a daily alarm checks for any whose
// promise date has passed without appearing as "Delivered" in a
// subsequent visit. Notification fires once per order.
// -------------------------------------------------------------------

async function readWatchedOrders() {
  const r = await chrome.storage.local.get(['amzeWatchedOrders']);
  return r.amzeWatchedOrders || {};
}
async function writeWatchedOrders(map) {
  await chrome.storage.local.set({ amzeWatchedOrders: map });
}

function parsePromisedDate(text) {
  if (!text) return null;
  // Common formats: "Arriving Monday, Apr 14", "Delivered Apr 8",
  // "Expected delivery: Apr 14", "Arriving by Wed, Apr 16".
  const now = new Date();
  const m = text.match(/([A-Z][a-z]+)\s+(\d{1,2})(?:\s*,\s*(\d{4}))?/);
  if (!m) return null;
  const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
    .indexOf(m[1].toLowerCase().slice(0, 3));
  if (month < 0) return null;
  const day = parseInt(m[2], 10);
  let year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
  const d = new Date(year, month, day);
  // If parsed date is in the past by more than 6 months, assume next year.
  if ((now - d) > 1000 * 60 * 60 * 24 * 180) d.setFullYear(year + 1);
  return d;
}

async function scanLateOrders() {
  const { amzeSettings } = await chrome.storage.local.get(['amzeSettings']);
  if (!amzeSettings || !amzeSettings.flags || !amzeSettings.flags.lateDeliveryWatch) return;
  const map = await readWatchedOrders();
  const now = Date.now();
  const dirty = [];
  for (const [id, rec] of Object.entries(map)) {
    if (rec.notified) continue;
    const promised = parsePromisedDate(rec.promise);
    if (!promised) continue;
    // Late if promised +1 day and status doesn't contain "delivered"
    if (now > promised.getTime() + 86400000 && !/delivered/i.test(rec.status || '')) {
      rec.notified = true;
      dirty.push(id);
      try {
        chrome.notifications.create('amze-late-' + id, {
          type: 'basic',
          iconUrl: 'icons/128.png',
          title: 'Amazon order is late',
          message: `Order ${id} was promised by ${rec.promise}. You may be eligible for Prime credit.`,
          priority: 2
        });
      } catch (e) {}
    }
  }
  if (dirty.length) await writeWatchedOrders(map);
}

chrome.alarms.create('amze-late-watch', { periodInMinutes: 60 * 6, delayInMinutes: 5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'amze-late-watch') scanLateOrders();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'AMZE_SEED_ORDERS') {
    (async () => {
      const map = await readWatchedOrders();
      for (const o of (msg.orders || [])) {
        if (!o.orderId) continue;
        const existing = map[o.orderId];
        // Preserve existing notified flag; update promise/status.
        map[o.orderId] = {
          promise: o.promise,
          status: o.status,
          seenAt: o.seenAt || Date.now(),
          notified: existing ? existing.notified : false
        };
      }
      await writeWatchedOrders(map);
      sendResponse({ ok: true, count: (msg.orders || []).length });
    })();
    return true;
  }

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
