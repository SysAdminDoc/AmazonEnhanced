/**
 * AmazonEnhanced — content.js
 *
 * Runtime feature orchestrator for all Amazon locales.
 *
 * Responsibilities (each feature is individually toggled via settings.flags):
 *   - Sponsored result removal (search + PDP + banners)                  [hideSponsored/shadeSponsored]
 *   - Video ad removal on PDP                                            [hideVideoAds]
 *   - Prime trial nag removal                                            [hidePrimeNag]
 *   - Amazon-brand filter (Amazon Basics, Essentials, Solimo, etc.)      [hideAmazonBrands]
 *   - User-defined brand blocklist (regex-friendly)                      [hideCustomBrands]
 *   - Seller-country hide (China-origin heuristics)                      [hideCN]
 *   - Local review-quality scoring on PDP                                [reviewScore]
 *   - Inline price-per-unit computation on result tiles                  [pricePerUnit]
 *   - List-price (MSRP) inflation warning                                [listPriceWarn]
 *   - Affiliate/tracking link stripper                                   [stripAffiliate]
 *   - Declutter sections (handled in theme.css via flag attrs)
 *
 * Runs at document_end; reapplies on DOM mutations for infinite scroll.
 */

(function () {
  'use strict';

  const UNIT_PRICE = globalThis.AmzeUnitPrice || {};
  const PRICE_HISTORY = globalThis.AmzePriceHistory || {};
  const VARIANT_PRICE = globalThis.AmzeVariantPrice || {};
  const PRICE_HISTORY_IO = globalThis.AmzePriceHistoryIO || {};
  const UPGRADE_SKIP = globalThis.AmzeUpgradeSkip || {};
  const PRIME_TRIAL = globalThis.AmzePrimeTrial || {};
  const SHIPPING_DIFF = globalThis.AmzeShippingDiff || {};
  const RETURN_REASONS = globalThis.AmzeReturnReasons || {};
  const WISHLIST_IMPORT = globalThis.AmzeWishlistImport || {};
  const INVOICE_EXPORT = globalThis.AmzeInvoiceExport || {};
  const ZIP_STORE = globalThis.AmzeZipStore || {};
  const RECEIPT_MARKDOWN = globalThis.AmzeReceiptMarkdown || {};

  // -------------------------------------------------------------------
  // 1. Defaults + storage
  // -------------------------------------------------------------------

  let DEFAULT_SETTINGS = null;
  let settings = null;
  let localeCatalogPromise = null;
  let LOCALE_TLD = (() => {
    const h = location.hostname;
    const m = h.match(/amazon\.(.+)$/);
    return m ? m[1] : 'com';
  })();

  async function loadDefaultSettings() {
    const res = await fetch(chrome.runtime.getURL('defaults.json'));
    if (!res.ok) throw new Error('Failed to load defaults.json');
    return res.json();
  }

  function cloneDefaultSettings() {
    return structuredClone(DEFAULT_SETTINGS);
  }

  function mergeSettings(saved) {
    const merged = Object.assign(cloneDefaultSettings(), saved || {});
    merged.flags = Object.assign({}, DEFAULT_SETTINGS.flags, (saved && saved.flags) || {});
    return merged;
  }

  async function loadLocaleCatalog() {
    if (!localeCatalogPromise) {
      localeCatalogPromise = fetch(chrome.runtime.getURL('locales.json'))
        .then((res) => {
          if (!res.ok) throw new Error('Failed to load locales.json');
          return res.json();
        })
        .then((data) => data.locales || [])
        .catch(() => []);
    }
    return localeCatalogPromise;
  }

  async function hydrateLocaleFromCatalog() {
    const locales = await loadLocaleCatalog();
    const host = location.hostname.toLowerCase();
    const match = locales.find(entry => {
      const domain = String(entry.domain || '').toLowerCase();
      return domain && (host === domain || host.endsWith('.' + domain));
    });
    if (match && match.tld) LOCALE_TLD = match.tld;
  }

  function getSettings(cb) {
    try {
      chrome.storage.local.get(['amzeSettings'], (r) => {
        settings = mergeSettings(r && r.amzeSettings);
        cb();
      });
    } catch (e) {
      settings = cloneDefaultSettings();
      cb();
    }
  }

  function saveSettings() {
    try { chrome.storage.local.set({ amzeSettings: settings }); } catch (e) {}
  }

  function sendMessageWithTimeout(message, timeoutMs = 3000) {
    return new Promise(resolve => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            finish(null);
          } else {
            finish(response || null);
          }
        });
      } catch (e) {
        finish(null);
      }
    });
  }

  // Keep html flag attrs in sync with settings (lets theme.css react).
  function applyFlagAttributes() {
    const html = document.documentElement;
    html.setAttribute('data-amze-theme', settings.theme);
    html.setAttribute('data-amze-density', settings.density);
    html.setAttribute('data-amze-image-mode', settings.imageMode || 'tile');
    for (const key of Object.keys(DEFAULT_SETTINGS.flags)) {
      if (settings.flags[key]) {
        html.setAttribute('data-amze-' + key, '1');
      } else {
        html.removeAttribute('data-amze-' + key);
      }
    }
  }

  // -------------------------------------------------------------------
  // 2. Utility
  // -------------------------------------------------------------------

  const log = (...a) => { /* silent in prod; uncomment for debug */ /* console.log('[AmazonEnhanced]', ...a); */ };

  function toast(msg, ms = 2200) {
    if (!settings.toastsEnabled) return;
    const id = 'amze-toast';
    let el = document.getElementById(id);
    if (el) el.remove();
    el = document.createElement('div');
    el.id = id;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.textContent = msg;
    document.body && document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function appendText(parent, text) {
    parent.appendChild(document.createTextNode(text));
  }

  function appendStrong(parent, text) {
    const strong = document.createElement('strong');
    strong.textContent = text;
    parent.appendChild(strong);
    return strong;
  }

  function createTextElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function createActionButton(id, label, ariaLabel) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.className = 'amze-action-btn';
    btn.textContent = label;
    btn.setAttribute('aria-label', ariaLabel || label);
    return btn;
  }

  function debounce(fn, wait) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, arguments), wait);
    };
  }

  let whiteBgIdleHandle = null;
  let domObserver = null;
  let smartImageObserver = null;
  let sparklineRenderState = null;
  let variantPriceMapState = null;
  let variantPriceMapRequest = 0;
  let checkoutShippingState = null;
  let wishlistImportItems = [];
  let wishlistImportJobId = '';
  let invoiceExportState = null;
  let mutationQueue = null;
  const mutationScanMetrics = {
    observerCallbacks: 0,
    mutationRecords: 0,
    fullScanBatches: 0,
    targetedScanBatches: 0,
    targetedRootScans: 0,
    fullScanWorkMs: 0,
    targetedScanWorkMs: 0
  };

  function exposeMutationScanMetrics() {
    try {
      globalThis.__amzeMutationMetrics = Object.assign({}, mutationScanMetrics, {
        queue: mutationQueue ? mutationQueue.getStats() : null,
        note: 'Compare targetedScanWorkMs with fullScanWorkMs while profiling equivalent page activity.'
      });
    } catch (e) {}
  }

  function requestWhiteBackgroundSweep() {
    if (whiteBgIdleHandle !== null) return;
    const run = () => {
      whiteBgIdleHandle = null;
      try { killWhiteBackgrounds(); } catch (e) {}
    };
    if (typeof window.requestIdleCallback === 'function') {
      whiteBgIdleHandle = window.requestIdleCallback(run, { timeout: 1200 });
    } else {
      whiteBgIdleHandle = setTimeout(run, 120);
    }
  }

  function parseNumber(str) {
    if (!str) return NaN;
    // Locale-safe: strip currency symbols + thousands sep, detect decimal.
    const cleaned = String(str).replace(/[^\d.,-]/g, '');
    if (!cleaned) return NaN;
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    let normalized;
    if (lastComma > lastDot) {
      // Comma is decimal separator (EU).
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // Dot is decimal separator (US).
      normalized = cleaned.replace(/,/g, '');
    }
    const n = parseFloat(normalized);
    return isNaN(n) ? NaN : n;
  }

  function normalizeReadableText(value, maxLen = 160) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
  }

  function getPdpPrice() {
    const priceEl = document.querySelector(
      '#corePrice_feature_div .a-offscreen, ' +
      '#corePriceDisplay_desktop_feature_div .a-offscreen, ' +
      '#priceblock_ourprice, #priceblock_dealprice, .a-price .a-offscreen'
    );
    return priceEl ? parseNumber(priceEl.textContent) : NaN;
  }

  function median(nums) {
    const sorted = nums.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!sorted.length) return NaN;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function normalizeCompareKey(value) {
    return normalizeReadableText(value, 160)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|store|shop|seller|official|the|brand)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // -------------------------------------------------------------------
  // 3. Amazon brand list
  // -------------------------------------------------------------------

  // Known Amazon in-house brands. Maintained list; add conservatively.
  const AMAZON_BRANDS = [
    'Amazon Basics', 'AmazonBasics', 'Amazon Essentials', 'Amazon Brand',
    'Amazon Collection', 'Solimo', 'Pinzon', 'Goodthreads', 'Wag',
    'Mama Bear', 'Happy Belly', 'Presto!', 'Amazon Elements',
    'Amazon Commercial', '365 by Whole Foods Market', 'Whole Foods Market',
    'Ring', 'Blink', 'eero', 'Kindle', 'Fire TV', 'Echo',
    'Amazon Aware', 'Amazon Renewed', 'Amazon Warehouse'
  ];
  const AMAZON_BRANDS_RE = new RegExp('\\b(' + AMAZON_BRANDS.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i');

  // -------------------------------------------------------------------
  // 4. Sponsored / filter logic on result tiles
  //    Selectors loaded from selectors.json with per-locale overrides.
  // -------------------------------------------------------------------

  let selectorPackPromise = null;
  let SPONSORED_SELECTORS = '';
  let SPONSORED_LABEL_SELECTORS = '';

  const SPONSORED_SELECTORS_FALLBACK = [
    '[data-component-type="sp-sponsored-result"]',
    '.AdHolder',
    '[data-cel-widget*="MAIN-SPONSORED"]',
    '[cel_widget_id*="MAIN-SPONSORED"]',
    '[cel_widget_id^="adplacements:"]',
    '[data-cel-widget^="adplacements:"]',
    '[data-csa-c-painter="JavelinRenderingService"]',
    '[class*="ad-placements"]',
    '[class*="gateway-btf_ad"]',
    '[class*="gateway-atf_ad"]',
    '[id*="desktop-homepage-btf-card"]',
    '[id*="desktop-homepage-atf-card"]',
    '.ape-placement'
  ].join(',');

  const SPONSORED_LABELS_FALLBACK = [
    '.s-sponsored-label-info-icon',
    '.puis-label-popover-default',
    '[aria-label*="Sponsored" i]'
  ].join(',');

  async function loadSelectorPack() {
    if (!selectorPackPromise) {
      selectorPackPromise = fetch(chrome.runtime.getURL('selectors.json'))
        .then(res => {
          if (!res.ok) throw new Error('Failed to load selectors.json');
          return res.json();
        })
        .then(data => {
          // Base selectors
          SPONSORED_SELECTORS = (data.sponsored || []).join(',') || SPONSORED_SELECTORS_FALLBACK;
          let labels = data.sponsoredLabels || [];

          // Apply locale overrides
          const overrides = data.localeOverrides && data.localeOverrides[LOCALE_TLD];
          if (overrides) {
            if (overrides.sponsored) SPONSORED_SELECTORS = overrides.sponsored.join(',');
            if (overrides.sponsoredLabels) labels = overrides.sponsoredLabels;
          }
          SPONSORED_LABEL_SELECTORS = labels.join(',') || SPONSORED_LABELS_FALLBACK;
        })
        .catch(() => {
          SPONSORED_SELECTORS = SPONSORED_SELECTORS_FALLBACK;
          SPONSORED_LABEL_SELECTORS = SPONSORED_LABELS_FALLBACK;
        });
    }
    return selectorPackPromise;
  }

  function isSponsoredTile(el) {
    if (!el) return false;
    if (SPONSORED_SELECTORS && el.matches && el.matches(SPONSORED_SELECTORS)) return true;
    // Fallback: look for "Sponsored" label inside the tile.
    const labelSel = SPONSORED_LABEL_SELECTORS || SPONSORED_LABELS_FALLBACK;
    const label = el.querySelector && el.querySelector(labelSel);
    if (label) return true;
    const txt = el.querySelector && el.querySelector('.puis-sponsored-label-text, span.a-color-secondary');
    if (txt && /sponsored|ad\s*$/i.test(txt.textContent || '')) return true;
    return false;
  }

  function getBrandFromTile(el) {
    if (!el) return '';
    // Brand often in h2, first line under image, or .a-row with .a-size-base-plus
    const candidates = [
      el.querySelector('h5 .a-size-base-plus'),
      el.querySelector('.a-row .a-size-base-plus'),
      el.querySelector('h2 a span'),
      el.querySelector('h2 span'),
      el.querySelector('.a-link-normal .a-text-normal')
    ].filter(Boolean);
    for (const c of candidates) {
      const t = (c.textContent || '').trim();
      if (t && t.length < 120) return t;
    }
    return '';
  }

  function getCustomBrandRegexes() {
    if (!settings.customBrands) return [];
    return settings.customBrands
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(p => { try { return new RegExp(p, 'i'); } catch (e) { return null; } })
      .filter(Boolean);
  }

  // -------------------------------------------------------------------
  // 4b. Detect conflicting ad-blocking extensions
  //     Guard against nodes already removed by other blockers (AdGuard,
  //     uBlock, etc.) which may have mutated the DOM before us.
  // -------------------------------------------------------------------

  function isNodeRemoved(el) {
    return !el || !el.parentNode || !document.contains(el);
  }

  function processResultTile(el) {
    if (!el || el.dataset.amzeProcessed) return;
    if (isNodeRemoved(el)) return;
    el.dataset.amzeProcessed = '1';

    const flags = settings.flags;

    // Sponsored handling (guard with optional chaining for nodes
    // that another ad blocker may have already removed)
    if (isSponsoredTile(el)) {
      if (flags.hideSponsored) {
        el?.remove();
        return;
      } else if (flags.shadeSponsored) {
        el.style.outline = '1px dashed var(--amze-danger)';
        el.style.opacity = '0.55';
        const marker = document.createElement('div');
        marker.className = 'amze-sponsor-marker';
        marker.textContent = 'AD';
        el.style.position = el.style.position || 'relative';
        el.appendChild(marker);
      }
    }

    // Amazon-brand filter
    if (flags.hideAmazonBrands || flags.hideCustomBrands) {
      const brand = getBrandFromTile(el);
      if (brand) {
        if (flags.hideAmazonBrands && AMAZON_BRANDS_RE.test(brand)) {
          el.classList.add('amze-hidden-by-brand');
          return;
        }
        if (flags.hideCustomBrands) {
          const regs = getCustomBrandRegexes();
          for (const re of regs) {
            if (re.test(brand)) {
              el.classList.add('amze-hidden-by-brand');
              return;
            }
          }
        }
      }
    }

    // China-origin seller heuristic (cheap check: gibberish brand like "AOEUFG", all-caps 5-7 random letters)
    if (flags.hideCN) {
      const brand = getBrandFromTile(el);
      if (brand && /^[A-Z]{5,8}$/.test(brand.replace(/\s+/g, ''))) {
        el.classList.add('amze-hidden-by-brand');
        return;
      }
    }

    // Per-unit price
    if (flags.pricePerUnit) {
      attachPricePerUnit(el);
    }

    // List-price warning (strikethrough inflated MSRP)
    if (flags.listPriceWarn) {
      attachListPriceWarn(el);
    }

    // Trust score badge
    if (flags.trustBadge) {
      attachTrustBadge(el);
    }
  }

  // -------------------------------------------------------------------
  // 5. Price-per-unit inference (result tile level + PDP)
  // -------------------------------------------------------------------

  function extractQuantity(title) {
    return typeof UNIT_PRICE.extractQuantity === 'function'
      ? UNIT_PRICE.extractQuantity(title)
      : null;
  }

  const GROCERY_TILE_SELECTORS = [
    '[data-testid="product-card"]',
    '[data-testid="product-card-container"]',
    '[data-testid*="product-card"]',
    '[data-test-id="product-card"]',
    '[data-test-id*="product-card"]',
    '[data-cy="product-card"]',
    '[class*="ProductCard"]',
    '[class*="product-card"]'
  ].join(',');

  const GROCERY_TITLE_SELECTORS = [
    '[data-testid="product-title"]',
    '[data-testid*="product-title"]',
    '[data-test-id="product-title"]',
    '[data-test-id*="product-title"]',
    '[data-cy="product-title"]',
    '[class*="ProductTitle"]',
    '[class*="product-title"]',
    'h3 a span',
    'h3 span',
    'h3',
    'a[href*="/dp/"]'
  ].join(',');

  const GROCERY_PRICE_SELECTORS = [
    '[data-testid="product-price"]',
    '[data-testid="price"]',
    '[data-testid*="product-price"]',
    '[data-testid*="price"]',
    '[data-test-id="product-price"]',
    '[data-test-id="price"]',
    '[data-test-id*="product-price"]',
    '[data-test-id*="price"]',
    '[data-cy="product-price"]',
    '[class*="ProductPrice"]',
    '[class*="product-price"]',
    '[class*="price"]'
  ].join(',');

  const GROCERY_SIZE_SELECTORS = [
    '[data-testid="product-size"]',
    '[data-testid="unit-size"]',
    '[data-testid="product-subtitle"]',
    '[data-test-id="product-size"]',
    '[data-test-id="unit-size"]',
    '[data-test-id="product-subtitle"]',
    '[class*="ProductSize"]',
    '[class*="product-size"]',
    '[class*="unit-size"]'
  ].join(',');

  const GROCERY_UNIT_PRICE_RE = /(?:\/|\bper\b)\s*(?:oz|ounce|lb|pound|g|kg|ml|l|floz|fl\.?\s*oz|ct|count|ea|each)\b/i;

  function isGroceryPage() {
    const host = String(location.hostname || '').toLowerCase();
    const path = String(location.pathname || '').toLowerCase();
    if (/amazonfresh\.|wholefoods\./i.test(host)) return true;
    if (/\/(?:fresh|whole[-_]?foods|amazonfresh)(?:\/|$)/i.test(path)) return true;
    if (document.title && /amazon\s*(fresh|whole\s*foods)/i.test(document.title)) return true;
    return !!document.querySelector(
      '[data-testid*="grocery"], [data-testid*="fresh"], [data-testid*="wholefood"], ' +
      '[data-test-id*="grocery"], [data-test-id*="fresh"], [data-test-id*="wholefood"]'
    );
  }

  function isGroceryTile(el) {
    return !!(el && el.matches && el.matches(GROCERY_TILE_SELECTORS));
  }

  function findGroceryPriceElement(el) {
    if (!el || !el.querySelectorAll) return null;
    const candidates = el.querySelectorAll(GROCERY_PRICE_SELECTORS);
    for (const candidate of candidates) {
      const marker = `${candidate.className || ''} ${candidate.id || ''} ${candidate.getAttribute('data-testid') || ''} ${candidate.getAttribute('data-test-id') || ''}`;
      if (/unit|per|was|list|strike|original/i.test(marker)) continue;
      if (isFinite(parseNumber(candidate.getAttribute('aria-label') || candidate.textContent))) {
        return candidate;
      }
    }
    return null;
  }

  function extractGroceryQuantity(el, title) {
    const parts = [title];
    if (el && el.querySelectorAll) {
      el.querySelectorAll(GROCERY_SIZE_SELECTORS).forEach(node => parts.push(node.textContent || ''));
    }
    let quantity = extractQuantity(parts.join(' '));
    if (quantity) return quantity;

    const priceEl = findGroceryPriceElement(el);
    const priceText = priceEl ? (priceEl.textContent || '') : '';
    const cardText = String(el && el.textContent || '').replace(priceText, ' ');
    return extractQuantity(cardText);
  }

  function extractTilePrice(el) {
    const priceEl = el.querySelector('.a-price .a-offscreen, .a-price-whole');
    if (priceEl) return parseNumber(priceEl.textContent);
    const groceryPrice = findGroceryPriceElement(el);
    return groceryPrice ? parseNumber(groceryPrice.getAttribute('aria-label') || groceryPrice.textContent) : NaN;
  }

  function extractTileTitle(el) {
    const titleEl = el.querySelector('h2 span, h2 a span, .s-link-style span') ||
      (isGroceryTile(el) && el.querySelector(GROCERY_TITLE_SELECTORS));
    return titleEl ? (titleEl.textContent || '').trim() : '';
  }

  function formatUnitPrice(price, qty, unit) {
    return typeof UNIT_PRICE.formatUnitPrice === 'function'
      ? UNIT_PRICE.formatUnitPrice(price, qty, unit)
      : '';
  }

  function attachPricePerUnit(el) {
    if (el.querySelector('.amze-badge-price')) return;
    const price = extractTilePrice(el);
    const title = extractTileTitle(el);
    const qty = extractQuantity(title);
    if (!qty || !isFinite(price)) return;
    const formatted = formatUnitPrice(price, qty.qty, qty.unit);
    if (!formatted) return;
    const host = el.querySelector('.a-price');
    if (!host || !host.parentElement) return;
    const badge = document.createElement('span');
    badge.className = 'amze-badge amze-badge-price';
    badge.textContent = formatted;
    badge.setAttribute('aria-label', 'Price per unit: ' + formatted);
    badge.title = 'AmazonEnhanced — price per unit';
    host.parentElement.appendChild(badge);
  }

  function attachGroceryPricePerUnit(el) {
    if (!settings.flags.pricePerUnit || !isGroceryTile(el)) return;
    if (el.querySelector('.amze-badge-price')) return;
    if (GROCERY_UNIT_PRICE_RE.test(el.textContent || '') ||
        el.querySelector('[data-testid*="unit-price"], [data-test-id*="unit-price"], [class*="unit-price"], [class*="UnitPrice"]')) {
      return;
    }
    const priceEl = findGroceryPriceElement(el);
    if (!priceEl) return;
    const price = parseNumber(priceEl.getAttribute('aria-label') || priceEl.textContent);
    const title = extractTileTitle(el);
    const quantity = extractGroceryQuantity(el, title);
    if (!quantity || !isFinite(price)) return;
    const formatted = formatUnitPrice(price, quantity.qty, quantity.unit);
    if (!formatted) return;
    const badge = document.createElement('span');
    badge.className = 'amze-badge amze-badge-price amze-grocery-unit-price';
    badge.textContent = formatted;
    badge.setAttribute('aria-label', 'Price per unit: ' + formatted);
    badge.title = 'AmazonEnhanced — grocery price per unit';
    (priceEl.parentElement || el).appendChild(badge);
  }

  // -------------------------------------------------------------------
  // 6. List-price inflation warning
  // -------------------------------------------------------------------

  function attachListPriceWarn(el) {
    if (el.dataset.amzeLpWarn === '1') return;
    // Tile: .a-price[data-a-strike="true"] .a-offscreen = list price
    const strikeEl = el.querySelector('.a-price[data-a-strike="true"] .a-offscreen, .a-text-price .a-offscreen');
    const actualEl = el.querySelector('.a-price:not([data-a-strike]) .a-offscreen');
    if (!strikeEl || !actualEl) return;
    const list = parseNumber(strikeEl.textContent);
    const actual = parseNumber(actualEl.textContent);
    if (!isFinite(list) || !isFinite(actual) || list <= actual) return;
    const discountPct = ((list - actual) / list) * 100;
    // Flag implausibly high "list prices" (>70% off is usually fake).
    if (discountPct < 70) return;
    el.dataset.amzeLpWarn = '1';
    const badge = document.createElement('span');
    badge.className = 'amze-badge amze-badge-warn';
    badge.textContent = '⚠ Suspicious MSRP';
    badge.setAttribute('aria-label', 'Suspicious MSRP: list price is ' + discountPct.toFixed(0) + '% higher than the current price');
    badge.title = 'AmazonEnhanced — list price is ' + discountPct.toFixed(0) + '% higher; likely inflated';
    const host = strikeEl.parentElement && strikeEl.parentElement.parentElement;
    if (host) host.appendChild(badge);
  }

  // -------------------------------------------------------------------
  // 6b. Trust score badge on search tiles
  //     Combines star rating, review count, and heuristic signals into
  //     a single 1-10 score near the product title on search results.
  // -------------------------------------------------------------------

  function computeTrustScore(rating, reviewCount) {
    // Base score from rating (0-5 scale mapped to 0-5 points)
    let score = 0;
    if (!isFinite(rating) || rating <= 0) return NaN;

    // Rating component (max 5 pts): penalize below 4.0 aggressively
    if (rating >= 4.5) score += 5;
    else if (rating >= 4.0) score += 4;
    else if (rating >= 3.5) score += 3;
    else if (rating >= 3.0) score += 2;
    else score += 1;

    // Volume component (max 3 pts): more reviews = more confidence
    if (isFinite(reviewCount) && reviewCount > 0) {
      if (reviewCount >= 1000) score += 3;
      else if (reviewCount >= 200) score += 2;
      else if (reviewCount >= 50) score += 1;
      // < 50 reviews: no volume bonus
    }

    // Suspicious pattern penalties
    // Perfect 5.0 with few reviews is suspicious
    if (rating >= 4.9 && reviewCount < 30) score -= 1;
    // Very high rating with very few reviews
    if (rating >= 4.7 && reviewCount < 10) score -= 2;

    // Volume trust bonus for highly-reviewed items
    if (reviewCount >= 5000 && rating >= 4.0) score += 1;
    if (reviewCount >= 10000 && rating >= 3.8) score += 1;

    return Math.max(1, Math.min(10, score));
  }

  function getTrustBadgeClass(score) {
    if (score >= 7) return 'amze-badge-trust-high';
    if (score >= 4) return 'amze-badge-trust-mid';
    return 'amze-badge-trust-low';
  }

  function attachTrustBadge(el) {
    if (!settings.flags.trustBadge) return;
    if (el.querySelector('.amze-badge-trust')) return;

    // Extract star rating
    const ratingEl = el.querySelector('.a-icon-alt, [aria-label*="out of"]');
    if (!ratingEl) return;
    const ratingText = ratingEl.getAttribute('aria-label') || ratingEl.textContent || '';
    const ratingMatch = ratingText.match(/([\d.]+)\s*out\s*of/i);
    if (!ratingMatch) return;
    const rating = parseFloat(ratingMatch[1]);

    // Extract review count
    const countEl = el.querySelector('[aria-label*="ratings" i], [aria-label*="reviews" i], a[href*="customerReviews"] span');
    let reviewCount = 0;
    if (countEl) {
      const countText = (countEl.getAttribute('aria-label') || countEl.textContent || '').replace(/,/g, '');
      const countMatch = countText.match(/([\d,]+)/);
      if (countMatch) reviewCount = parseInt(countMatch[1].replace(/,/g, ''), 10);
    }

    const score = computeTrustScore(rating, reviewCount);
    if (!isFinite(score)) return;

    const cls = getTrustBadgeClass(score);
    const badge = document.createElement('span');
    badge.className = 'amze-badge amze-badge-trust ' + cls;
    badge.textContent = score + '/10';
    badge.setAttribute('aria-label', 'Trust score: ' + score + ' out of 10 based on ' + rating.toFixed(1) + ' stars and ' + reviewCount.toLocaleString() + ' reviews');
    badge.title = 'AmazonEnhanced trust score: ' + score + '/10 (' + rating.toFixed(1) + '★, ' + reviewCount.toLocaleString() + ' reviews)';

    // Insert near the rating stars
    const host = ratingEl.closest('.a-row') || ratingEl.parentElement;
    if (host) host.appendChild(badge);
  }

  // -------------------------------------------------------------------
  // 7. Review quality scoring (PDP only)
  // -------------------------------------------------------------------

  function scoreReviews() {
    if (!settings.flags.reviewScore) return;
    const histogram = document.querySelector('#histogramTable, #cm_cr_dp_d_rating_histogram');
    if (!histogram) return;
    if (document.getElementById('amze-review-panel')) return;

    // Pull the 5-bar histogram percentages.
    const bars = histogram.querySelectorAll('a[aria-label*="%"], .a-text-right .a-size-base');
    const pct = [0, 0, 0, 0, 0]; // index 0=5-star, 4=1-star
    const rows = histogram.querySelectorAll('tr.a-histogram-row, li.a-histogram-row');
    let parsedAny = false;
    rows.forEach((row, i) => {
      if (i > 4) return;
      const label = row.querySelector('.a-text-right, .a-size-base');
      if (!label) return;
      const m = (label.textContent || '').match(/(\d+)\s*%/);
      if (m) {
        pct[i] = parseInt(m[1], 10);
        parsedAny = true;
      }
    });
    if (!parsedAny) return;

    // Total review count
    const totalEl = document.querySelector('#acrCustomerReviewText, [data-hook="total-review-count"]');
    const totalNum = totalEl ? parseNumber(totalEl.textContent) : NaN;

    // Current shown rating
    const ratingEl = document.querySelector('#acrPopover, .a-icon-alt');
    const ratingMatch = ratingEl ? (ratingEl.getAttribute('title') || ratingEl.textContent || '').match(/([\d.]+)\s*out/) : null;
    const shownRating = ratingMatch ? parseFloat(ratingMatch[1]) : NaN;

    // --- Heuristic: polarization (1-star + 5-star share) ---
    const polarization = (pct[0] || 0) + (pct[4] || 0);
    const middle = (pct[1] || 0) + (pct[2] || 0) + (pct[3] || 0);

    // --- Heuristic: one-star share alone (>20% is a red flag) ---
    const oneStarPct = pct[4] || 0;

    // --- Compute adjusted rating by removing suspect 5-star spike. ---
    // Assume plausibly ~half of excess 1+5 spike is noise.
    const sum = pct.reduce((a, b) => a + b, 0) || 1;
    const weights = pct.map(p => p / sum);
    const rawRating = 5 * weights[0] + 4 * weights[1] + 3 * weights[2] + 2 * weights[3] + 1 * weights[4];

    // Penalize high polarization — shift ~15% toward middle.
    let adjusted = rawRating;
    if (polarization > 75 && middle < 25) {
      adjusted = rawRating - Math.min(0.9, (polarization - 75) / 100 * 2.5);
    }
    if (oneStarPct > 20) {
      adjusted -= Math.min(0.5, (oneStarPct - 20) / 100 * 2);
    }
    adjusted = Math.max(1, Math.min(5, adjusted));

    // Score bucket
    let bucket, cls;
    if (adjusted >= 4.2 && polarization < 75) { bucket = 'Trustworthy'; cls = 'amze-score-good'; }
    else if (adjusted >= 3.5)                 { bucket = 'Mixed';        cls = 'amze-score-mixed'; }
    else                                      { bucket = 'Low trust';    cls = 'amze-score-bad'; }

    // Verified-purchase sampling signal (if available on page)
    const allReviewEls = document.querySelectorAll('[data-hook="review"]');
    let verified = 0, sampleSize = 0;
    allReviewEls.forEach(r => {
      sampleSize++;
      if (r.querySelector('[data-hook="avp-badge"], .avp-badge-linkless')) verified++;
    });
    const verifiedRatio = sampleSize ? verified / sampleSize : null;

    // Build panel
    const panel = document.createElement('div');
    panel.id = 'amze-review-panel';

    const heading = document.createElement('h3');
    heading.appendChild(createTextElement('span', '', 'AmazonEnhanced review analysis'));
    const badge = createTextElement(
      'span',
      'amze-badge ' + (cls === 'amze-score-good' ? 'amze-badge-review-good' : cls === 'amze-score-mixed' ? 'amze-badge-review-mixed' : 'amze-badge-review-bad'),
      bucket
    );
    badge.setAttribute('aria-label', 'Review quality: ' + bucket);
    heading.appendChild(badge);
    panel.appendChild(heading);

    const score = createTextElement('div', 'amze-score ' + cls);
    appendText(score, adjusted.toFixed(1) + ' ');
    const shown = createTextElement('span', '', `adjusted / ${isFinite(shownRating) ? shownRating.toFixed(1) : '–'} shown`);
    shown.style.fontSize = '13px';
    shown.style.color = 'var(--amze-text-muted)';
    shown.style.fontWeight = '400';
    score.appendChild(shown);
    panel.appendChild(score);

    const metrics = createTextElement('div', 'amze-metrics');
    const starMetric = createTextElement('div', 'amze-metric');
    appendStrong(starMetric, pct[0] + '%');
    appendText(starMetric, ' 5★  ·  ');
    appendStrong(starMetric, pct[4] + '%');
    appendText(starMetric, ' 1★');
    metrics.appendChild(starMetric);

    const polarizationMetric = createTextElement('div', 'amze-metric');
    appendText(polarizationMetric, 'Polarization: ');
    appendStrong(polarizationMetric, polarization + '%');
    metrics.appendChild(polarizationMetric);

    const middleMetric = createTextElement('div', 'amze-metric');
    appendText(middleMetric, 'Mid-ratings (2–4★): ');
    appendStrong(middleMetric, middle + '%');
    metrics.appendChild(middleMetric);

    const totalMetric = createTextElement('div', 'amze-metric');
    appendText(totalMetric, 'Total reviews: ');
    appendStrong(totalMetric, isFinite(totalNum) ? Math.round(totalNum).toLocaleString() : '–');
    metrics.appendChild(totalMetric);

    if (verifiedRatio !== null) {
      const verifiedMetric = createTextElement('div', 'amze-metric');
      appendText(verifiedMetric, 'Verified in sample: ');
      appendStrong(verifiedMetric, Math.round(verifiedRatio * 100) + '%');
      appendText(verifiedMetric, ` (${verified}/${sampleSize})`);
      metrics.appendChild(verifiedMetric);
    }

    const note = createTextElement(
      'div',
      'amze-metric',
      "Local heuristic only. Flags suspicious polarization, 1-star spikes, and MSRP inflation — but can't detect every paid-review pattern."
    );
    note.style.gridColumn = '1/-1';
    note.style.color = 'var(--amze-text-muted)';
    note.style.fontSize = '11px';
    note.style.marginTop = '4px';
    metrics.appendChild(note);
    panel.appendChild(metrics);

    // Insert above review list or histogram.
    const insertBefore = document.querySelector('#reviewsMedley, #cm_cr-review_list, #reviews-medley-footer') || histogram;
    if (insertBefore && insertBefore.parentElement) {
      insertBefore.parentElement.insertBefore(panel, insertBefore);
    }
  }

  // -------------------------------------------------------------------
  // 7b. Smart image dark-mode
  //     Samples four corner pixels of each product image on a canvas.
  //     If >= 3 of 4 corners are near-white, mark image for inversion.
  //     Fails silently on CORS (Amazon CDN sometimes blocks). In that
  //     case the fallback is the default tile treatment from theme.css.
  // -------------------------------------------------------------------

  const IMAGE_SELECTORS = [
    'img.s-image',
    'img#landingImage',
    '#imgTagWrapperId img',
    '.imgTagWrapper img',
    '#altImages img',
    'img.a-dynamic-image',
    '.item-view-left-col-inner img',
    'img.sc-product-image'
  ].join(',');

  function isNearWhite(r, g, b) {
    return r > 235 && g > 235 && b > 235;
  }

  function processImageForSmartInvert(img) {
    if (!img || img.dataset.amzeImg === '1') return;
    if (!img.complete || img.naturalWidth < 32) return;
    img.dataset.amzeImg = '1';

    try {
      const w = Math.min(img.naturalWidth, 80);
      const h = Math.min(img.naturalHeight, 80);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      // Draw at reduced size — we only need corner sampling.
      ctx.drawImage(img, 0, 0, w, h);
      // This throws DOMException on CORS tainted canvas.
      const d = ctx.getImageData(0, 0, w, h).data;

      const points = [
        [0, 0],
        [w - 1, 0],
        [0, h - 1],
        [w - 1, h - 1],
        [Math.floor(w / 2), 0],
        [Math.floor(w / 2), h - 1]
      ];
      let whiteCount = 0;
      for (const [x, y] of points) {
        const i = (y * w + x) * 4;
        if (isNearWhite(d[i], d[i + 1], d[i + 2])) whiteCount++;
      }
      if (whiteCount >= 4) {
        img.setAttribute('data-amze-invert', '1');
      } else {
        img.setAttribute('data-amze-invert', '0');
      }
    } catch (e) {
      // CORS tainted — mark as unknown so theme.css falls back to tile.
      img.setAttribute('data-amze-invert', 'cors');
    }
  }

  function getSmartImageObserver() {
    if (smartImageObserver || typeof IntersectionObserver !== 'function') return smartImageObserver;
    smartImageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        smartImageObserver.unobserve(img);
        if (img.complete && img.naturalWidth > 0) {
          processImageForSmartInvert(img);
        } else {
          img.addEventListener('load', () => processImageForSmartInvert(img), { once: true });
        }
      });
    }, { rootMargin: '400px 0px', threshold: 0.01 });
    return smartImageObserver;
  }

  function queueImageForSmartInvert(img) {
    if (!img || img.dataset.amzeImg === '1' || img.dataset.amzeImgObserved === '1') return;
    const observer = getSmartImageObserver();
    if (!observer) {
      if (img.complete && img.naturalWidth > 0) {
        processImageForSmartInvert(img);
      } else {
        img.addEventListener('load', () => processImageForSmartInvert(img), { once: true });
      }
      return;
    }
    img.dataset.amzeImgObserved = '1';
    observer.observe(img);
  }

  function scanImagesForSmart(root = document) {
    if (settings.imageMode !== 'smart') return;
    // Add crossorigin hint BEFORE the image loads to maximize canvas readability.
    const imgs = [];
    if (root !== document && root.matches && root.matches(IMAGE_SELECTORS)) imgs.push(root);
    if (root && root.querySelectorAll) root.querySelectorAll(IMAGE_SELECTORS).forEach(img => imgs.push(img));
    imgs.forEach(queueImageForSmartInvert);
  }

  // -------------------------------------------------------------------
  // 7c. Kill white backgrounds at runtime.
  //     Amazon's HTML has many <div style="background:#fff"> variants
  //     the CSS attribute selectors can't exhaustively catch. After the
  //     page settles, read computed background-color on plausibly-white
  //     container elements and mark them with data-amze-kw="1" so
  //     theme.css (section 2a) applies the dark override.
  //
  //     Bounded: only processes containers with text/structural content
  //     (not images, inputs, svg) and skips elements smaller than 40x20.
  //     Marks only near-white elements and skips already-marked nodes.
  // -------------------------------------------------------------------

  const KW_SELECTORS = [
    // Amazon utility classes
    '.a-box', '.a-box-inner', '.a-section', '.a-cardui', '.a-cardui-body',
    '.a-container', '.a-row', '.a-popover', '.a-popover-inner',
    '.a-padding-none', '.a-padding-mini', '.a-padding-small',
    '.a-padding-medium', '.a-padding-large',
    '.a-fixed-left-grid', '.a-fixed-right-grid',
    '.a-fixed-right-grid-col', '.a-fixed-left-grid-col',
    '.a-tab-content', '.a-box-group', '.a-column',
    '.a-spacing-top-base', '.a-spacing-top-medium', '.a-spacing-top-large',
    // Every Amazon PDP widget id uses this suffix
    '[id$="_feature_div"]',
    // ARIA landmarks
    'div[role="main"]', 'div[role="region"]', 'div[role="complementary"]',
    '[role="navigation"]', '[role="contentinfo"]', '[role="article"]',
    // PDP-specific containers
    '#dp', '#dp-container', '#ppd', '#centerCol', '#leftCol', '#rightCol',
    '#apex_desktop', '#apex_desktop_newAccordion', '#buybox', '#buyBoxAccordion',
    '#desktop_buybox', '#desktop_buybox_group_1', '#desktop_buybox_group_2',
    '#corePriceDisplay_desktop_feature_div', '#corePrice_feature_div',
    '#qualifiedBuybox', '#tradeInWidget_feature_div',
    '#bylineInfo_feature_div', '#availability_feature_div',
    '#offerDisplay_feature_div', '#shippingMessageInsideBuyBox_feature_div',
    '#shipsFromSoldBy_feature_div', '#HLCXComparisonWidgetContainer',
    '#productOverview_feature_div', '#featurebullets_feature_div',
    '#productDescription_feature_div', '#productDetails_feature_div',
    '#imageBlock_feature_div', '#imgTagWrapperId',
    // Cart/checkout
    '#sc-active-cart', '#activeCartViewForm', '#sc-buy-box',
    '#hlb-content', '#hlb-container', '#hlb-2',
    '#yourOrdersContainer', '.order-card', '.order',
    // Reviews block
    '#reviewsMedley', '#cm_cr-review_list', '[data-hook="review"]',
    // Tables + rows
    'table', 'tbody', 'tr', 'td', 'th',
    // Generic containers Amazon loves
    '[class*="card-root"]', '[class*="CardRoot"]',
    '[class*="Card__body"]', '[class*="gridItem"]',
    // Homepage carousels and shovelers
    '.a-carousel', '.a-carousel-card', '.a-carousel-viewport',
    '.a-carousel-container', '.a-cardui-footer', '.a-cardui-header',
    '.a-cardui-title', '.a-cardui-link-footer',
    '[class*="fluidCard"]', '[class*="cardContainer"]', '[class*="ImageLink"]'
  ].join(',');

  const WHITE_RGBS = [
    'rgb(255, 255, 255)',
    'rgb(255,255,255)',
    'rgba(255, 255, 255, 1)',
    'rgba(255,255,255,1)',
    '#ffffff',
    '#fff'
  ];

  function killWhiteBackgrounds() {
    if (settings.theme !== 'dark' && settings.theme !== 'amoled') return;
    const nodes = document.querySelectorAll(KW_SELECTORS);
    const toMark = [];
    for (const el of nodes) {
      // Skip if already marked dark in a previous sweep — no need to re-check
      // because the theme won't change it back. But DON'T skip unmarked
      // elements: Amazon's own stylesheets may paint them white on load
      // after our first pass.
      if (el.getAttribute('data-amze-kw') === '1') continue;
      // Skip tiny elements (icons, spacers, decorative divs).
      const rect = el.getBoundingClientRect();
      if (rect.width < 30 || rect.height < 16) continue;
      // Skip form controls & media.
      if (/^(INPUT|TEXTAREA|SELECT|BUTTON|IMG|SVG|VIDEO|IFRAME|CANVAS)$/i.test(el.tagName)) continue;
      let bg;
      try { bg = getComputedStyle(el).backgroundColor; } catch (e) { continue; }
      if (!bg) continue;
      // Ignore transparent / no-bg — these inherit and don't need overriding.
      if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue;
      // Near-white threshold covers #fff, #eaeded, #f5f5f5, #f7f7f7, rgba whites.
      const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) continue;
      const r = +m[1], g = +m[2], b = +m[3];
      const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
      // Transparent-ish backgrounds don't cause visual issues.
      if (a < 0.3) continue;
      // "Near white" = all channels >= 235 (catches #fff, #f7f7f7, #eaeded, and Amazon's common off-whites).
      if (r >= 235 && g >= 235 && b >= 235) {
        toMark.push(el);
        if (toMark.length > 800) break;
      }
    }
    toMark.forEach(el => el.setAttribute('data-amze-kw', '1'));
  }

  // -------------------------------------------------------------------
  // 8. Affiliate / tracking link stripper
  // -------------------------------------------------------------------

  const STRIP_PARAMS = [
    'tag', 'ref', 'ref_', 'pd_rd_w', 'pd_rd_r', 'pd_rd_i', 'pf_rd_p', 'pf_rd_r',
    'pf_rd_s', 'pf_rd_t', 'pf_rd_i', 'content-id', 'psc', 'qid', 'sr', '_encoding',
    'dib', 'dib_tag', 'keywords', 'sprefix', 'linkCode', 'th'
  ];

  function cleanAmazonHref(href) {
    try {
      const url = new URL(href, location.origin);
      if (!/amazon\./i.test(url.hostname)) return href;
      // Reduce /dp/ASIN/... trailing junk
      const dpMatch = url.pathname.match(/\/dp\/([A-Z0-9]{10})/i) ||
                      url.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i);
      if (dpMatch) {
        url.pathname = '/dp/' + dpMatch[1];
      }
      STRIP_PARAMS.forEach(p => url.searchParams.delete(p));
      return url.toString();
    } catch (e) {
      return href;
    }
  }

  function stripAffiliate(root) {
    if (!settings.flags.stripAffiliate) return;
    const scope = root === document ? document.body : root;
    if (!scope || !scope.querySelectorAll) return;
    const anchors = collectMatchingElements(scope, 'a[href*="amazon."]:not([data-amze-cleaned])');
    anchors.forEach(a => {
      if (!a.href) return;
      const clean = cleanAmazonHref(a.href);
      if (clean !== a.href) a.href = clean;
      a.dataset.amzeCleaned = '1';
    });
  }

  // -------------------------------------------------------------------
  // 9. DOM scan driver
  // -------------------------------------------------------------------

  const RESULT_TILE_SELECTORS = '.s-result-item, [data-component-type="s-search-result"], [data-component-type="sp-sponsored-result"]';

  function collectMatchingElements(root, selector) {
    const elements = [];
    if (root && root !== document && root.matches && root.matches(selector)) elements.push(root);
    if (root && root.querySelectorAll) root.querySelectorAll(selector).forEach(el => elements.push(el));
    return elements;
  }

  function scanTiles(root) {
    const scope = (root && root.querySelectorAll) ? root : document;
    collectMatchingElements(scope, RESULT_TILE_SELECTORS).forEach(processResultTile);
    if (isGroceryPage()) {
      collectMatchingElements(scope, GROCERY_TILE_SELECTORS).forEach(attachGroceryPricePerUnit);
    }
  }

  function runFullPageScan() {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    scanTiles(document);
    stripAffiliate(document);
    scoreReviews();
    scanImagesForSmart();
    requestWhiteBackgroundSweep();
    runFeaturePack();
    mutationScanMetrics.fullScanBatches++;
    mutationScanMetrics.fullScanWorkMs += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    exposeMutationScanMetrics();
  }

  const schedule = debounce(runFullPageScan, 180);

  function compactMutationRoots(roots) {
    const usable = Array.from(new Set((roots || []).filter(root => root && root.nodeType === 1)));
    return usable.filter(root => !usable.some(ancestor => ancestor !== root && ancestor.contains && ancestor.contains(root)));
  }

  function rootForMutationNode(node) {
    if (!node) return null;
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element) return null;
    if (element.closest) {
      return element.closest(`${RESULT_TILE_SELECTORS},${GROCERY_TILE_SELECTORS}`) || element;
    }
    return element;
  }

  function runTargetedMutationScan(roots) {
    const compacted = compactMutationRoots(roots);
    if (!compacted.length) return;
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    compacted.forEach(root => {
      if (root.isConnected === false) return;
      scanTiles(root);
      stripAffiliate(root);
      scanImagesForSmart(root);
    });
    // These features inspect page-level structures, but their own id/marker
    // guards make one batch-level pass cheaper than a document scan per root.
    scoreReviews();
    requestWhiteBackgroundSweep();
    runFeaturePack();
    mutationScanMetrics.targetedScanBatches++;
    mutationScanMetrics.targetedRootScans += compacted.length;
    mutationScanMetrics.targetedScanWorkMs += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    exposeMutationScanMetrics();
  }

  function queueMutationRecords(muts) {
    mutationScanMetrics.observerCallbacks++;
    mutationScanMetrics.mutationRecords += muts.length;
    const roots = [];
    for (const mut of muts) {
      if (!mut.addedNodes || !mut.addedNodes.length) continue;
      mut.addedNodes.forEach(node => {
        const root = rootForMutationNode(node);
        if (root) roots.push(root);
      });
    }
    if (!roots.length) return;
    if (!mutationQueue) {
      schedule();
      return;
    }
    mutationQueue.addMany(compactMutationRoots(roots));
    exposeMutationScanMetrics();
  }

  function startObserver() {
    if (domObserver) return;
    domObserver = new MutationObserver((muts) => {
      queueMutationRecords(muts);
    });
    domObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  // -------------------------------------------------------------------
  // 10. Messaging from popup
  // -------------------------------------------------------------------

  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'AMZE_SETTINGS_UPDATED') {
        settings = mergeSettings(msg.settings);
        applyFlagAttributes();
        // Re-scan fresh tiles under new rules.
        document.querySelectorAll('[data-amze-processed]').forEach(el => delete el.dataset.amzeProcessed);
        document.querySelectorAll('.amze-hidden-by-brand').forEach(el => el.classList.remove('amze-hidden-by-brand'));
        // Reset image-smart markers so the new mode re-evaluates.
        document.querySelectorAll('[data-amze-img], [data-amze-img-observed]').forEach(el => {
          delete el.dataset.amzeImg;
          delete el.dataset.amzeImgObserved;
          el.removeAttribute('data-amze-invert');
        });
        if (smartImageObserver) {
          smartImageObserver.disconnect();
          smartImageObserver = null;
        }
        // Reset white-bg sweep markers.
        document.querySelectorAll('[data-amze-kw]').forEach(el => {
          el.removeAttribute('data-amze-kw');
        });
        // Re-run v2.0 features under new flags.
        document.querySelectorAll('[data-amze-country="1"]').forEach(el => delete el.dataset.amzeCountry);
        document.querySelectorAll('[data-amze-deal-normalized]').forEach(el => {
          delete el.dataset.amzeDealNormalized;
          el.style.display = '';
          el.removeAttribute('title');
        });
        delete document.documentElement.dataset.amzeDealNormalized;
        document.querySelector('#amze-deal-normalizer')?.remove();
        document.querySelector('#amze-counterfeit-warn')?.remove();
        document.querySelector('.amze-seller-lookup')?.remove();
        document.querySelector('#amze-seller-reveal')?.removeAttribute('data-amze-seller-lookup');
        sparklineRenderState = null;
        document.querySelector('#amze-sparkline')?.remove();
        removeVariantPriceMap();
        checkoutShippingState = null;
        document.querySelector('#amze-shipping-change-warn')?.remove();
        document.querySelector('#amze-frequently-returned-warn')?.remove();
        if (!wishlistImportJobId) {
          document.querySelector('#amze-wl-tools')?.remove();
          wishlistImportItems = [];
        }
        if (!settings.flags.orderExport) {
          document.querySelectorAll('[data-amze-receipt-md]').forEach(el => el.remove());
        }
        document.documentElement.toggleAttribute('data-amze-large-text',   !!settings.flags.largeText);
        document.documentElement.toggleAttribute('data-amze-high-contrast', !!settings.flags.highContrast);
        schedule();
        try { runFeaturePack(); } catch (e) {}
        toast('AmazonEnhanced settings updated');
        sendResponse({ ok: true });
      } else if (msg.type === 'AMZE_GET_STATE') {
        sendResponse({ ok: true, locale: LOCALE_TLD });
      } else if (msg.type === 'AMZE_WISHLIST_IMPORT_ITEM') {
        processWishlistImportItem(msg)
          .then(result => sendResponse(result))
          .catch(() => sendResponse({ ok: false, asin: msg.asin || '', reason: 'item_processing_failed' }));
        return true;
      } else if (msg.type === 'AMZE_WISHLIST_IMPORT_PROGRESS') {
        updateWishlistImportUi(msg);
        sendResponse({ ok: true });
      }
      return true;
    });
  } catch (e) {}

  // -------------------------------------------------------------------
  // 12. v2.0.0 FEATURE PACK
  //     Each feature is scoped and individually flag-gated. All share
  //     the same settings/message plumbing above.
  // -------------------------------------------------------------------

  function getAsin() {
    const m = location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : null;
  }

  function isPdp() { return !!getAsin(); }
  function isCartPage() { return /\/cart|\/gp\/cart/.test(location.pathname); }
  function isCheckoutPage() { return /\/checkout|\/gp\/buy|\/ap\/signin/.test(location.pathname); }
  function isOrdersPage() { return /\/your-orders|\/gp\/your-account\/order-history/.test(location.pathname); }
  function isWishlistPage() { return /\/hz\/wishlist/.test(location.pathname); }

  // -------------------------------------------------------------------
  // 12.1 Auto-decline protection plans / extended warranty
  //      Targets SquareTrade/Allstate upsell on PDP, cart, and interstitials.
  // -------------------------------------------------------------------

  function autoDeclineWarranty() {
    if (!settings.flags.autoDeclineWarranty) return;
    // Post-ATC interstitial (SI page)
    const noCoverage = document.querySelector('#siNoCoverage input, #siNoCoverage button, #attach-warranty-pane input[value*="no" i], input[name="attach"][value="0"]');
    if (noCoverage && !noCoverage.dataset.amzeDeclined) {
      noCoverage.dataset.amzeDeclined = '1';
      try { noCoverage.click(); toast('Declined warranty upsell'); } catch (e) {}
    }
    // PDP variants that inline the upsell
    const pdpNo = document.querySelectorAll('[data-feature-name="attachWarranty"] input[type="radio"][value="-1"], [data-feature-name="attachWarranty"] input[type="radio"]:first-of-type');
    pdpNo.forEach(r => {
      if (r.dataset.amzeDeclined) return;
      r.dataset.amzeDeclined = '1';
      // Only select if the "no" option exists
      const label = r.closest('label');
      if (label && /no thanks|don't add|not now|no coverage/i.test(label.textContent || '')) {
        try { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      }
    });
    // Cart-page service-contract row
    const cartWarranty = document.querySelectorAll('[id^="sc-warranty"] select, select[name*="sc-service-contract"]');
    cartWarranty.forEach(sel => {
      if (sel.dataset.amzeDeclined) return;
      sel.dataset.amzeDeclined = '1';
      for (const opt of sel.options) {
        if (/no thanks|none|no coverage|do not add/i.test(opt.textContent)) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    });
  }

  // -------------------------------------------------------------------
  // 12.2 Force one-time purchase (Subscribe & Save pre-tick guard)
  // -------------------------------------------------------------------

  function forceOneTimePurchase() {
    if (!settings.flags.forceOneTimePurchase) return;
    const oneTime = document.querySelector(
      '#oneTimePurchase input[type="radio"], ' +
      'input[name="subscriptionPlan"][value="onetime"], ' +
      '#newAccordionRow_0 input[type="radio"]'
    );
    const subs = document.querySelector(
      '#snsAccordionRowMiddle input[type="radio"]:checked, ' +
      'input[name="subscriptionPlan"][value="subscribe"]:checked'
    );
    if (oneTime && subs && !oneTime.dataset.amzeForced) {
      oneTime.dataset.amzeForced = '1';
      try {
        oneTime.checked = true;
        oneTime.dispatchEvent(new Event('change', { bubbles: true }));
        oneTime.click();
        toast('Switched to one-time purchase');
      } catch (e) {}
    }
  }

  // -------------------------------------------------------------------
  // 12.3 Auto-uncheck gift-receipt / share-info / add-on dark patterns
  // -------------------------------------------------------------------

  function autoUncheckDarkPatterns() {
    if (!settings.flags.autoUncheckDarkPatterns) return;
    const patterns = [
      'input[name*="giftReceipt"][checked]',
      'input[name*="gift-receipt"][checked]',
      'input[name*="shareWith"][checked]',
      'input[name*="promotion"][checked]',
      'input[id*="giftMessage"][checked]',
      'input[id*="addonItem"][checked]'
    ];
    patterns.forEach(sel => {
      document.querySelectorAll(sel).forEach(cb => {
        if (cb.dataset.amzeUnchecked) return;
        cb.dataset.amzeUnchecked = '1';
        if (cb.checked) {
          cb.checked = false;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
  }

  // -------------------------------------------------------------------
  // 12.3b Skip recommended-upgrade prompts in cart / post-ATC flows.
  //      Only explicit decline actions are eligible; generic Continue or
  //      recommendation controls are intentionally left untouched.
  // -------------------------------------------------------------------

  function isUpgradeFlowContext() {
    if (isCartPage() || isCheckoutPage()) return true;
    return !!document.querySelector(
      '#addToCartLayer, #add-to-cart-confirmation, #sw-atc-details-single-container, ' +
      '#attach-warranty-pane, [data-feature-name*="upgrade" i], [data-csa-c-content-id*="upgrade" i]'
    );
  }

  function getUpgradeControlText(control) {
    return [
      control.getAttribute('aria-label'),
      control.getAttribute('title'),
      control.value,
      control.textContent
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function skipRecommendedUpgradePrompts() {
    if (!settings.flags.skipRecommendedUpgrade || !isUpgradeFlowContext()) return;
    const promptSelectors = [
      'div[role="dialog"]',
      '[id*="upgrade" i]',
      '[class*="upgrade" i]',
      '[data-feature-name*="upgrade" i]',
      '[data-cel-widget*="upgrade" i]',
      '.a-box',
      '.a-popover'
    ].join(',');
    const prompts = document.querySelectorAll(promptSelectors);
    const clicked = new Set();
    let skipped = 0;
    prompts.forEach(prompt => {
      const text = (prompt.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 1600) return;
      const isPrompt = typeof UPGRADE_SKIP.isRecommendedUpgradePrompt === 'function'
        ? UPGRADE_SKIP.isRecommendedUpgradePrompt(text)
        : (/\brecommended\b/i.test(text) && /\bupgrade\b/i.test(text));
      if (!isPrompt) return;
      const controls = prompt.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"], a');
      for (const control of controls) {
        if (clicked.has(control) || control.disabled || control.dataset.amzeUpgradeSkipped === '1') continue;
        const actionText = getUpgradeControlText(control);
        const safe = typeof UPGRADE_SKIP.isSafeSkipAction === 'function'
          ? UPGRADE_SKIP.isSafeSkipAction(actionText)
          : /^(?:no\s*,?\s*thanks|skip(?:\s+upgrade)?|continue\s+without\s+(?:the\s+)?upgrade|not\s+now)$/i.test(actionText);
        if (!safe) continue;
        control.dataset.amzeUpgradeSkipped = '1';
        prompt.dataset.amzeUpgradeSkipped = '1';
        clicked.add(control);
        try {
          control.click();
          skipped++;
        } catch (e) {}
        break;
      }
    });
    if (skipped) toast(`Skipped ${skipped} recommended upgrade${skipped === 1 ? '' : 's'}`);
  }

  // -------------------------------------------------------------------
  // 12.3c Disable Prime 30-day-trial pre-checks at checkout.
  // -------------------------------------------------------------------

  function getPrimeChoiceText(control) {
    const parts = [control.getAttribute('aria-label'), control.getAttribute('title'), control.value, control.textContent];
    if (control.id) {
      document.querySelectorAll('label[for]').forEach(label => {
        if (label.getAttribute('for') === control.id) parts.push(label.textContent);
      });
    }
    const ownLabel = control.closest('label');
    if (ownLabel) parts.push(ownLabel.textContent);
    return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function getPrimeControlScope(control) {
    return control.closest('fieldset, [role="radiogroup"], [role="group"], .a-box-inner, .a-section') || control.parentElement;
  }

  function isPrimeTrialControl(control, scope) {
    const attrs = [control.id, control.name, control.className, control.getAttribute('data-testid'), control.getAttribute('data-feature-name')]
      .filter(Boolean).join(' ');
    const text = getPrimeChoiceText(control) + ' ' + attrs + ' ' + (scope?.textContent || '');
    return typeof PRIME_TRIAL.isPrimeTrialText === 'function'
      ? PRIME_TRIAL.isPrimeTrialText(text)
      : (/\bprime\b/i.test(text) && (/\btrial\b/i.test(text) || /\b30\s*[- ]?\s*day/i.test(text)));
  }

  function isPrimeTrialDecline(control) {
    const text = getPrimeChoiceText(control);
    return typeof PRIME_TRIAL.isPrimeTrialDeclineText === 'function'
      ? PRIME_TRIAL.isPrimeTrialDeclineText(text)
      : /^(?:no\s*,?\s*thanks|continue\s+without\s+(?:prime|the\s+trial)|not\s+now|decline)$/i.test(text);
  }

  function disablePrimeTrialPrechecks() {
    if (!settings.flags.disablePrimeTrial || !isCheckoutPage()) return;
    const controls = document.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]');
    let disabled = 0;
    controls.forEach(control => {
      if (control.dataset.amzePrimeTrialDisabled === '1') return;
      const scope = getPrimeControlScope(control);
      if (!scope || !isPrimeTrialControl(control, scope)) return;
      const selected = control.checked || control.getAttribute('aria-checked') === 'true';
      if (!selected) return;

      if (control.matches('input[type="radio"], [role="radio"]')) {
        const choices = scope.querySelectorAll('input[type="radio"], [role="radio"]');
        for (const choice of choices) {
          if (!isPrimeTrialDecline(choice)) continue;
          choice.dataset.amzePrimeTrialDisabled = '1';
          control.dataset.amzePrimeTrialDisabled = '1';
          try { choice.click(); disabled++; } catch (e) {}
          break;
        }
        return;
      }

      control.dataset.amzePrimeTrialDisabled = '1';
      try {
        // Native click preserves Amazon's input/change handlers and toggles
        // a checked checkbox off. Custom role=checkbox controls get the same
        // click opportunity without assuming their implementation details.
        control.click();
        disabled++;
      } catch (e) {}
    });
    if (disabled) toast(`Disabled ${disabled} Prime free-trial pre-check${disabled === 1 ? '' : 's'}`);
  }

  // -------------------------------------------------------------------
  // 12.3d Warn when checkout shipping tier or delivery slot changes.
  //      Require a stable baseline and a stable changed value to avoid
  //      warning while Amazon is still rendering the checkout page.
  // -------------------------------------------------------------------

  const SHIPPING_CONTEXT_SELECTORS = [
    '#shippingOptionForm',
    '#shipping-options',
    '#deliveryOptions',
    '[id*="shipping" i]',
    '[id*="delivery" i]',
    '[data-testid*="shipping" i]',
    '[data-testid*="delivery" i]',
    '[data-test-id*="shipping" i]',
    '[data-test-id*="delivery" i]',
    '[class*="shipping" i]',
    '[class*="delivery" i]',
    'fieldset'
  ].join(',');

  const SHIPPING_SLOT_SELECTORS = [
    '[data-testid*="delivery-date" i]',
    '[data-test-id*="delivery-date" i]',
    '[id*="delivery-date" i]',
    '[class*="delivery-date" i]',
    '[data-testid*="arrival" i]',
    '[data-test-id*="arrival" i]',
    '[class*="arrival" i]',
    '[class*="promise" i]'
  ].join(',');

  function getShippingChoiceText(control) {
    const parts = [control.getAttribute('aria-label'), control.getAttribute('title'), control.value, control.textContent];
    if (control.id) {
      document.querySelectorAll('label[for]').forEach(label => {
        if (label.getAttribute('for') === control.id) parts.push(label.textContent);
      });
    }
    const ownLabel = control.closest('label');
    if (ownLabel) parts.push(ownLabel.textContent);
    if (control.tagName === 'SELECT') {
      const option = control.options[control.selectedIndex];
      if (option) parts.push(option.textContent);
    }
    return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function getShippingScope(control) {
    return control.closest(SHIPPING_CONTEXT_SELECTORS) || control.parentElement;
  }

  function isShippingChoice(text) {
    return /shipping|delivery|arriv|ship\s+to|standard|expedited|priority|overnight|slot|window/i.test(text) &&
      !/payment|credit\s+card|billing\s+address/i.test(text);
  }

  function extractShippingSlot(text) {
    const match = String(text || '').match(/(?:arrives?|delivery|deliver(?:y)?\s+by|get\s+it)[^.;|]{0,110}/i);
    if (!match || !/(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|morning|afternoon|evening)/i.test(match[0])) return '';
    return match[0].replace(/\s+/g, ' ').trim();
  }

  function readShippingSnapshot() {
    const controls = document.querySelectorAll(
      'input[type="radio"]:checked, [role="radio"][aria-checked="true"], select'
    );
    for (const control of controls) {
      const scope = getShippingScope(control);
      if (!scope) continue;
      const choiceText = getShippingChoiceText(control);
      const contextText = choiceText + ' ' + (scope.textContent || '');
      if (!isShippingChoice(contextText)) continue;
      const slotNode = scope.querySelector(SHIPPING_SLOT_SELECTORS);
      const slotText = slotNode?.textContent?.replace(/\s+/g, ' ').trim() || extractShippingSlot(choiceText);
      const tier = typeof SHIPPING_DIFF.normalizeShippingText === 'function'
        ? SHIPPING_DIFF.normalizeShippingText(choiceText)
        : choiceText.trim();
      const slot = typeof SHIPPING_DIFF.normalizeShippingText === 'function'
        ? SHIPPING_DIFF.normalizeShippingText(slotText)
        : slotText.trim();
      if (tier || slot) return { tier, slot };
    }
    return null;
  }

  function shippingSnapshotSignature(snapshot) {
    return `${snapshot?.tier || ''}|${snapshot?.slot || ''}`;
  }

  function renderShippingChangeWarning(changes) {
    const existing = document.getElementById('amze-shipping-change-warn');
    const messageKey = changes.map(change => `${change.field}:${change.before}:${change.after}`).join('|');
    if (existing?.dataset.messageKey === messageKey) return;
    existing?.remove();
    const warning = document.createElement('div');
    warning.id = 'amze-shipping-change-warn';
    warning.className = 'amze-pdp-badge amze-pdp-warn';
    warning.setAttribute('role', 'alert');
    warning.dataset.messageKey = messageKey;
    appendStrong(warning, 'Checkout shipping changed:');
    changes.forEach(change => {
      const line = document.createElement('div');
      appendText(line, `${change.field}: `);
      appendStrong(line, change.before);
      appendText(line, ' → ');
      appendStrong(line, change.after);
      warning.appendChild(line);
    });
    appendText(warning, ' Verify the shipping choice before placing the order.');
    const target = document.querySelector('#shippingOptionForm, #shipping-options, #deliveryOptions, main, #centerCol');
    if (target) target.insertBefore(warning, target.firstChild);
  }

  function inspectShippingChange() {
    if (!settings.flags.warnShippingChange || !isCheckoutPage()) {
      checkoutShippingState = null;
      document.getElementById('amze-shipping-change-warn')?.remove();
      return;
    }
    const snapshot = readShippingSnapshot();
    if (!snapshot) return;
    const signature = shippingSnapshotSignature(snapshot);
    if (!checkoutShippingState) {
      checkoutShippingState = { baseline: null, candidate: snapshot, candidateSignature: signature, stableCount: 1 };
      return;
    }
    if (checkoutShippingState.candidateSignature !== signature) {
      checkoutShippingState.candidate = snapshot;
      checkoutShippingState.candidateSignature = signature;
      checkoutShippingState.stableCount = 1;
      return;
    }
    checkoutShippingState.stableCount++;
    if (!checkoutShippingState.baseline) {
      if (checkoutShippingState.stableCount >= 2) checkoutShippingState.baseline = snapshot;
      return;
    }
    const changes = typeof SHIPPING_DIFF.compareShippingSnapshots === 'function'
      ? SHIPPING_DIFF.compareShippingSnapshots(checkoutShippingState.baseline, snapshot)
      : [];
    if (changes.length && checkoutShippingState.stableCount >= 2) renderShippingChangeWarning(changes);
  }

  // -------------------------------------------------------------------
  // 12.3e Frequently returned item disclosure and reason breakdown.
  // -------------------------------------------------------------------

  const FREQUENT_RETURN_SELECTORS = [
    '#frequently-returned-item',
    '#frequentlyReturned',
    '#productFactsDesktopExpander',
    '[id*="frequently-return" i]',
    '[class*="frequently-return" i]',
    '[data-feature-name*="return" i]',
    '[data-testid*="return" i]',
    '[data-test-id*="return" i]',
    '[id*="return" i]',
    '[class*="return" i]',
    '.a-box',
    '.a-section'
  ].join(',');

  function findFrequentlyReturnedDisclosure() {
    const candidates = document.querySelectorAll(FREQUENT_RETURN_SELECTORS);
    for (const candidate of candidates) {
      const text = (candidate.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 1400) continue;
      const isDisclosure = typeof RETURN_REASONS.isFrequentlyReturnedText === 'function'
        ? RETURN_REASONS.isFrequentlyReturnedText(text)
        : /frequently\s+returned|returned\s+more\s+often/i.test(text);
      if (isDisclosure) return candidate;
    }
    return null;
  }

  function renderFrequentlyReturnedWarning(container) {
    if (document.getElementById('amze-frequently-returned-warn')) return;
    const warning = document.createElement('div');
    warning.id = 'amze-frequently-returned-warn';
    warning.className = 'amze-pdp-badge amze-pdp-warn';
    warning.setAttribute('role', 'alert');
    appendStrong(warning, 'Frequently returned item:');
    appendText(warning, ' Amazon reports that this item is returned more often than similar items.');

    const reasonNodes = container.querySelectorAll('li, [role="listitem"], dt, dd, tr, p');
    const values = Array.from(reasonNodes).map(node => node.textContent || '');
    const reasons = typeof RETURN_REASONS.extractReturnReasons === 'function'
      ? RETURN_REASONS.extractReturnReasons(values)
      : [];
    if (reasons.length) {
      appendText(warning, ' Reasons shown by Amazon:');
      const list = document.createElement('ul');
      list.className = 'amze-return-reasons';
      reasons.forEach(reason => {
        const item = document.createElement('li');
        item.textContent = reason;
        list.appendChild(item);
      });
      warning.appendChild(list);
    } else {
      appendText(warning, ' Amazon did not expose a reason breakdown on this page.');
    }
    const target = document.querySelector('#titleSection, #centerCol, #productFactsDesktopExpander') || container;
    if (target.parentElement) target.parentElement.insertBefore(warning, target.nextSibling);
  }

  function detectFrequentlyReturnedItem() {
    if (!settings.flags.frequentlyReturnedWarn || !isPdp()) return;
    const disclosure = findFrequentlyReturnedDisclosure();
    if (disclosure) renderFrequentlyReturnedWarning(disclosure);
  }

  // -------------------------------------------------------------------
  // 12.4 Extra "Sort by" options — inject Review-count, Newest, Best $/unit.
  //      Client-side DOM reorder only; works on search + category pages.
  // -------------------------------------------------------------------

  function injectExtraSortOptions() {
    if (!settings.flags.extraSortOptions) return;
    const select = document.querySelector('select#s-result-sort-select, select[name="s-result-sort-select"]');
    if (!select || select.dataset.amzeExtra === '1') return;
    select.dataset.amzeExtra = '1';

    const add = (value, label) => {
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = label;
      opt.setAttribute('data-amze-custom', '1');
      select.appendChild(opt);
    };
    add('amze-reviewcount', 'Most reviews (AmazonEnhanced)');
    add('amze-newest',      'Newest first (AmazonEnhanced)');
    add('amze-unitprice',   'Best $/unit (AmazonEnhanced)');

    select.addEventListener('change', (e) => {
      if (!select.value.startsWith('amze-')) return;
      e.stopPropagation();
      e.preventDefault();
      clientSideSort(select.value);
    }, true);
  }

  function clientSideSort(mode) {
    const container = document.querySelector('.s-main-slot');
    if (!container) return;
    const tiles = Array.from(container.querySelectorAll('[data-component-type="s-search-result"]'));
    const score = (t) => {
      if (mode === 'amze-reviewcount') {
        const m = t.querySelector('[aria-label*="ratings" i], [aria-label*="reviews" i]');
        if (!m) return 0;
        const n = parseNumber((m.getAttribute('aria-label') || '').replace(/,/g, ''));
        return isFinite(n) ? n : 0;
      }
      if (mode === 'amze-newest') {
        // Heuristic: Amazon sometimes exposes a date via `data-pl-last-stock-index`; fallback: preserve order
        return parseInt(t.getAttribute('data-index') || '0', 10);
      }
      if (mode === 'amze-unitprice') {
        const title = extractTileTitle(t);
        const qty = extractQuantity(title);
        const price = extractTilePrice(t);
        if (!qty || !isFinite(price) || qty.qty <= 0) return Infinity;
        return price / qty.qty;
      }
      return 0;
    };
    const sorted = tiles.slice().sort((a, b) => {
      const sa = score(a), sb = score(b);
      return mode === 'amze-unitprice' ? sa - sb : sb - sa;
    });
    sorted.forEach(t => container.appendChild(t));
    toast('Sorted by ' + mode.replace('amze-', ''));
  }

  // -------------------------------------------------------------------
  // 12.5 CPU Tamer — throttle background setInterval/setTimeout when tab is hidden.
  //      Injected into MAIN world via a <script> tag.
  // -------------------------------------------------------------------

  function injectCpuTamer() {
    if (!settings.flags.cpuTamer) return;
    if (document.getElementById('amze-cpu-tamer')) return;
    const code = `
      (function(){
        if (window.__amzeCpuTamer) return;
        window.__amzeCpuTamer = true;
        const origST = window.setTimeout;
        const origSI = window.setInterval;
        const minHiddenMs = 1000;
        window.setTimeout = function(fn, ms, ...a) {
          if (document.hidden) ms = Math.max(ms || 0, minHiddenMs);
          return origST.call(this, fn, ms, ...a);
        };
        window.setInterval = function(fn, ms, ...a) {
          if (document.hidden) ms = Math.max(ms || 0, minHiddenMs);
          return origSI.call(this, fn, ms, ...a);
        };
      })();
    `;
    const s = document.createElement('script');
    s.id = 'amze-cpu-tamer';
    s.textContent = code;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }

  // -------------------------------------------------------------------
  // 12.6 Country-of-origin badge on PDP (plus cache for search tiles).
  // -------------------------------------------------------------------

  async function cacheOrigin(asin, country) {
    try {
      await sendMessageWithTimeout({ type: 'AMZE_IDB_PUT_ORIGIN', asin, country });
    } catch (e) {}
  }
  async function readOriginCache() {
    try {
      const res = await sendMessageWithTimeout({ type: 'AMZE_IDB_GET_ORIGINS' });
      return (res && res.origins) || {};
    } catch (e) { return {}; }
  }

  function extractOriginFromPdp() {
    // Product Details tables
    const rows = document.querySelectorAll(
      '#productDetails_techSpec_section_1 tr, ' +
      '#productDetails_detailBullets_sections1 tr, ' +
      '#detailBullets_feature_div li, ' +
      '#prodDetails tr, ' +
      'table.prodDetTable tr'
    );
    for (const r of rows) {
      const txt = (r.textContent || '').trim();
      const m = txt.match(/Country of Origin[:\s]+([A-Z][A-Za-z ,'-]{1,40})/i);
      if (m) return m[1].trim().replace(/\s+/g, ' ');
    }
    return null;
  }

  async function annotateCountry() {
    if (!settings.flags.countryBadge) return;
    if (isPdp()) {
      const asin = getAsin();
      const origin = extractOriginFromPdp();
      if (origin && asin) {
        await cacheOrigin(asin, origin);
        renderCountryBadge(origin);
      }
    }
    // Annotate search tiles from cache
    const cache = await readOriginCache();
    document.querySelectorAll('[data-component-type="s-search-result"]').forEach(tile => {
      if (tile.dataset.amzeCountry) return;
      const link = tile.querySelector('a.a-link-normal[href*="/dp/"]');
      if (!link) return;
      const m = link.href.match(/\/dp\/([A-Z0-9]{10})/i);
      if (!m) return;
      const entry = cache[m[1].toUpperCase()];
      if (!entry) return;
      tile.dataset.amzeCountry = '1';
      const badge = document.createElement('span');
      badge.className = 'amze-badge amze-badge-country';
      badge.textContent = '🌐 ' + entry.country;
      badge.setAttribute('aria-label', 'Country of origin: ' + entry.country);
      const host = tile.querySelector('.a-row.a-size-base') || tile.querySelector('.a-price')?.parentElement;
      (host || tile).appendChild(badge);
    });
  }

  function renderCountryBadge(country) {
    if (document.getElementById('amze-country-badge')) return;
    const title = document.querySelector('#productTitle');
    if (!title) return;
    const badge = document.createElement('div');
    badge.id = 'amze-country-badge';
    badge.className = 'amze-pdp-badge';
    badge.setAttribute('aria-label', 'Country of Origin: ' + country);
    appendStrong(badge, 'Country of Origin:');
    appendText(badge, ' ' + country);
    title.parentElement.insertBefore(badge, title.nextSibling);
  }

  // -------------------------------------------------------------------
  // 12.7 Reveal seller (SoldBy-clone)
  // -------------------------------------------------------------------

  function revealSellerPdp() {
    if (!settings.flags.revealSeller && !settings.flags.sellerLookup) return;
    if (!isPdp()) return;
    if (document.getElementById('amze-seller-reveal')) return;
    const merchantEl = document.querySelector('#sellerProfileTriggerId, #merchant-info a');
    if (!merchantEl) return;
    const name = normalizeReadableText(merchantEl.textContent);
    const href = merchantEl.href;
    const panel = document.createElement('div');
    panel.id = 'amze-seller-reveal';
    panel.className = 'amze-pdp-badge';
    panel.setAttribute('aria-label', 'Sold by: ' + name);
    appendStrong(panel, 'Sold by:');
    appendText(panel, ' ' + name);
    if (href) {
      const link = createTextElement('a', '', 'View seller page →');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.style.marginLeft = '8px';
      link.style.fontSize = '11px';
      panel.appendChild(link);
    }
    const target = document.querySelector('#titleSection, #centerCol .a-row');
    if (target) target.parentElement.insertBefore(panel, target.nextSibling);
    enrichSellerIdentity(panel, name);
  }

  function isAmazonSellerName(name) {
    return /\bamazon(\.com|\s+retail|\s+services|\s+eu|\s+export)?\b/i.test(name || '');
  }

  function renderSellerLookupLine(panel, text, tone) {
    let line = panel.querySelector('.amze-seller-lookup');
    if (!line) {
      line = document.createElement('div');
      line.className = 'amze-seller-lookup';
      panel.appendChild(line);
    }
    line.textContent = text;
    line.dataset.tone = tone || 'neutral';
    return line;
  }

  async function enrichSellerIdentity(panel, sellerName) {
    if (!settings.flags.sellerLookup) return;
    if (!panel || panel.dataset.amzeSellerLookup === '1') return;
    if (!sellerName || isAmazonSellerName(sellerName)) return;
    panel.dataset.amzeSellerLookup = '1';
    renderSellerLookupLine(panel, 'OpenCorporates lookup queued...', 'neutral');
    const res = await sendMessageWithTimeout({ type: 'AMZE_LOOKUP_SELLER', sellerName }, 10000);
    if (!res || !res.ok) {
      if (res && res.reason === 'missing_token') {
        renderSellerLookupLine(panel, 'OpenCorporates lookup needs a local API token in settings.', 'warn');
      } else {
        renderSellerLookupLine(panel, 'OpenCorporates lookup unavailable right now.', 'warn');
      }
      return;
    }
    const result = res.result || {};
    if (result.noMatch) {
      renderSellerLookupLine(panel, 'OpenCorporates: no company match found for seller name.', 'warn');
      return;
    }
    const line = renderSellerLookupLine(panel, '', 'ok');
    appendStrong(line, 'OpenCorporates:');
    appendText(line, ' ' + (result.companyName || sellerName));
    const bits = [result.companyType, result.jurisdictionCode, result.country, result.status].filter(Boolean);
    if (bits.length) appendText(line, ' - ' + bits.join(' / '));
    if (result.url) {
      appendText(line, ' ');
      const a = createTextElement('a', '', 'Company record');
      a.href = result.url;
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      line.appendChild(a);
    }
  }

  function extractPdpBrand() {
    const byline = normalizeReadableText(document.querySelector('#bylineInfo')?.textContent || '');
    if (byline) {
      const cleaned = byline
        .replace(/^visit\s+the\s+/i, '')
        .replace(/\s+store$/i, '')
        .replace(/^brand\s*:\s*/i, '')
        .trim();
      if (cleaned && cleaned.length <= 80) return cleaned;
    }

    const rows = document.querySelectorAll(
      '#productDetails_techSpec_section_1 tr, ' +
      '#productDetails_detailBullets_sections1 tr, ' +
      '#detailBullets_feature_div li, ' +
      '#prodDetails tr, table.prodDetTable tr'
    );
    for (const row of rows) {
      const txt = normalizeReadableText(row.textContent || '');
      const m = txt.match(/\bBrand\s*[:\s]+([A-Za-z0-9][A-Za-z0-9 &'._-]{1,80})/i);
      if (m) return normalizeReadableText(m[1], 80);
    }
    return '';
  }

  function getPdpSellerName() {
    const merchantEl = document.querySelector('#sellerProfileTriggerId, #merchant-info a');
    return normalizeReadableText(merchantEl?.textContent || '');
  }

  function tokenizeForCompare(value) {
    return normalizeCompareKey(value)
      .split(/\s+/)
      .filter(t => t.length >= 3 && !/^(usa|inc|llc|ltd|the|and|for|shop|store)$/.test(t));
  }

  function hasTokenOverlap(a, b) {
    const aa = tokenizeForCompare(a);
    const bb = new Set(tokenizeForCompare(b));
    return aa.some(t => bb.has(t));
  }

  function detectCounterfeitRisk() {
    if (!settings.flags.counterfeitWarn) return;
    if (!isPdp()) return;
    if (document.getElementById('amze-counterfeit-warn')) return;
    const brand = extractPdpBrand();
    const seller = getPdpSellerName();
    if (!brand || !seller || isAmazonSellerName(seller)) return;
    if (AMAZON_BRANDS_RE.test(brand)) return;
    if (hasTokenOverlap(brand, seller)) return;

    const sellerKey = normalizeCompareKey(seller);
    const suspiciousSellerShape = /^[a-z]{5,10}$/.test(sellerKey.replace(/\s+/g, '')) ||
      /\b(trading|import|export|factory|wholesale|marketplace|direct)\b/i.test(seller);

    const warn = document.createElement('div');
    warn.id = 'amze-counterfeit-warn';
    warn.className = 'amze-pdp-badge amze-pdp-warn';
    warn.setAttribute('role', 'alert');
    appendStrong(warn, 'Counterfeit risk check:');
    appendText(warn, ' product brand "' + brand + '" does not resemble seller "' + seller + '".');
    if (suspiciousSellerShape) {
      appendText(warn, ' Seller naming also matches a higher-risk marketplace pattern.');
    }
    appendText(warn, ' Verify the seller before buying.');
    const target = document.querySelector('#amze-seller-reveal, #titleSection') || document.querySelector('#centerCol');
    if (target) target.parentElement.insertBefore(warn, target.nextSibling);
  }

  // -------------------------------------------------------------------
  // 12.8 Variation bait detector
  // -------------------------------------------------------------------

  function detectVariationBait() {
    if (!settings.flags.variationBait) return;
    if (!isPdp()) return;
    if (document.getElementById('amze-variation-warn')) return;
    // Pull twister state from inline script
    let twisterJson = null;
    for (const s of document.querySelectorAll('script')) {
      const t = s.textContent || '';
      if (t.includes('dimensionValuesDisplayData')) {
        const m = t.match(/"dimensionValuesDisplayData"\s*:\s*(\{[\s\S]*?\})/);
        if (m) { try { twisterJson = JSON.parse(m[1]); } catch (e) {} break; }
      }
    }
    // Parse variation prices from rendered DOM buttons
    const variantButtons = document.querySelectorAll('.twisterSwatchWrapper, #variation_size_name li, #variation_color_name li, #variation_style_name li');
    const prices = [];
    variantButtons.forEach(v => {
      const p = v.querySelector('.a-price .a-offscreen');
      if (p) {
        const n = parseNumber(p.textContent);
        if (isFinite(n)) prices.push(n);
      }
    });
    if (prices.length < 2) return;
    const min = Math.min(...prices), max = Math.max(...prices);
    if (min <= 0) return;
    const ratio = max / min;
    if (ratio > 3) {
      const warn = document.createElement('div');
      warn.id = 'amze-variation-warn';
      warn.className = 'amze-pdp-badge amze-pdp-warn';
      warn.setAttribute('role', 'alert');
      warn.setAttribute('aria-label', 'Variation price spread warning');
      appendText(warn, '⚠ ');
      appendStrong(warn, 'Variation price spread:');
      appendText(warn, ` this listing groups ${prices.length} variants ranging `);
      appendStrong(warn, min.toFixed(2));
      appendText(warn, ' to ');
      appendStrong(warn, max.toFixed(2));
      appendText(warn, ` (${ratio.toFixed(1)}× spread). Reviews may apply to very different products.`);
      const target = document.querySelector('#titleSection') || document.querySelector('#centerCol');
      if (target) target.insertBefore(warn, target.firstChild);
    }
  }

  // -------------------------------------------------------------------
  // 12.8b Cross-variant local price map
  // -------------------------------------------------------------------

  const VARIATION_GROUP_SELECTORS = [
    '#variation_color_name',
    '#variation_size_name',
    '#variation_style_name',
    '#variation_pattern_name',
    '#variation_material_name',
    '#variation_flavor_name',
    '[id^="variation_"][id$="_name"]'
  ].join(',');

  const VARIATION_OPTION_SELECTORS = [
    'li',
    'button',
    '[role="radio"]',
    '[role="option"]',
    '.twisterSwatchWrapper',
    '[data-defaultasin]',
    '[data-asin]',
    '[data-dp-url]',
    '[data-csa-c-item-id*="amzn1.asin"]',
    'a[href*="/dp/"]'
  ].join(',');

  function variationGroupLabel(group) {
    const labelNode = group.querySelector('label, .a-form-label, .a-form-label span, .a-form-label a');
    if (labelNode && labelNode.textContent) {
      return String(labelNode.textContent).replace(/\s*:\s*$/, '').replace(/\s+/g, ' ').trim();
    }
    const id = group.id || '';
    const key = id.replace(/^variation_/, '').replace(/_name$/, '').replace(/_/g, ' ').trim();
    return key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Variant';
  }

  function getVariantAsinFromNode(node) {
    if (!node) return '';
    const attrs = [
      node.getAttribute('data-defaultasin'),
      node.getAttribute('data-asin'),
      node.getAttribute('data-dp-url'),
      node.getAttribute('data-csa-c-item-id'),
      node.getAttribute('href')
    ];
    for (const value of attrs) {
      const asin = typeof VARIANT_PRICE.extractAsin === 'function'
        ? VARIANT_PRICE.extractAsin(value)
        : String(value || '').match(/\/dp\/([A-Z0-9]{10})/i)?.[1] || '';
      if (asin) return asin;
    }
    return '';
  }

  function variantOptionLabel(node, groupLabel) {
    const labelNode = node.querySelector('[aria-label], .a-button-text, .twisterTextDiv, img[alt], .a-size-base') || node;
    const raw = labelNode.getAttribute?.('aria-label') || labelNode.getAttribute?.('alt') ||
      node.getAttribute?.('title') || labelNode.textContent || '';
    const clean = String(raw)
      .replace(/\s+/g, ' ')
      .replace(/(?:[$€£]\s*)\d[\d,.]*(?:\s*[-–]\s*[$€£]?\d[\d,.]*)?/g, '')
      .replace(/\b(?:currently\s+)?unavailable\b/ig, '')
      .trim();
    const label = typeof VARIANT_PRICE.normalizeLabel === 'function'
      ? VARIANT_PRICE.normalizeLabel(clean, 'Option')
      : (clean || 'Option');
    return groupLabel ? groupLabel + ': ' + label : label;
  }

  function collectPdpVariantRecords() {
    if (!isPdp()) return [];
    const records = [];
    document.querySelectorAll(VARIATION_GROUP_SELECTORS).forEach(group => {
      const groupLabel = variationGroupLabel(group);
      const seenNodes = new Set();
      const options = group.querySelectorAll(VARIATION_OPTION_SELECTORS);
      options.forEach(option => {
        if (seenNodes.has(option)) return;
        seenNodes.add(option);
        const asin = getVariantAsinFromNode(option);
        if (!asin) return;
        records.push({ asin, label: variantOptionLabel(option, groupLabel) });
      });
    });

    if (records.length < 2) return [];
    const merged = typeof VARIANT_PRICE.mergeVariantRecords === 'function'
      ? VARIANT_PRICE.mergeVariantRecords(records)
      : records;
    const currentAsin = getAsin();
    if (currentAsin && !merged.some(entry => entry.asin === currentAsin)) {
      merged.unshift({ asin: currentAsin, label: 'Current selection' });
    }
    return merged;
  }

  function removeVariantPriceMap() {
    variantPriceMapRequest++;
    variantPriceMapState = null;
    document.getElementById('amze-variant-price-map')?.remove();
  }

  function variantPriceMapTarget() {
    const group = document.querySelector(VARIATION_GROUP_SELECTORS);
    if (group) return group.closest('.celwidget, .a-section') || group;
    return document.querySelector('#centerCol');
  }

  function renderVariantPriceMapPanel(variants, currentAsin) {
    const panel = document.createElement('section');
    panel.id = 'amze-variant-price-map';
    panel.className = 'amze-pdp-badge amze-variant-price-map';
    panel.setAttribute('aria-labelledby', 'amze-variant-price-map-title');

    const title = createTextElement('div', '', 'Variant local price map');
    title.id = 'amze-variant-price-map-title';
    title.style.fontWeight = '600';
    panel.appendChild(title);
    const note = createTextElement('div', 'amze-variant-price-map-note', 'Lowest price seen locally for each option.');
    panel.appendChild(note);

    const table = document.createElement('table');
    table.className = 'amze-variant-price-table';
    table.setAttribute('aria-label', 'Lowest local prices by product variant');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Variant', 'Lowest local price'].forEach(text => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = text;
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    table.appendChild(head);
    const body = document.createElement('tbody');
    variants.forEach(variant => {
      const row = document.createElement('tr');
      if (variant.asin === currentAsin) row.className = 'amze-variant-current';
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = variant.label;
      const price = document.createElement('td');
      if (Number.isFinite(variant.lowestPrice)) {
        price.textContent = '$' + variant.lowestPrice.toFixed(2);
        if (variant.source === 'current') price.title = 'Current price; local history will replace this after it is recorded.';
      } else {
        price.textContent = 'No local history';
        price.className = 'amze-variant-no-history';
      }
      row.appendChild(name);
      row.appendChild(price);
      body.appendChild(row);
    });
    table.appendChild(body);
    panel.appendChild(table);

    const target = variantPriceMapTarget();
    if (target && target.parentElement) target.parentElement.insertBefore(panel, target.nextSibling);
    return panel;
  }

  async function renderVariantPriceMap() {
    if (!settings.flags.variantPriceMap || !settings.flags.priceHistory || !isPdp()) {
      removeVariantPriceMap();
      return;
    }
    const variants = collectPdpVariantRecords();
    if (variants.length < 2) {
      removeVariantPriceMap();
      return;
    }
    const currentAsin = getAsin();
    const signature = variants.map(variant => variant.asin + ':' + variant.label).join('|');
    if (variantPriceMapState && variantPriceMapState.signature === signature && document.getElementById('amze-variant-price-map')) return;
    const request = ++variantPriceMapRequest;
    const response = await sendMessageWithTimeout({ type: 'AMZE_IDB_GET_ALL_PRICE_HISTORY' });
    if (request !== variantPriceMapRequest || !settings.flags.variantPriceMap || !settings.flags.priceHistory) return;
    const entries = response && Array.isArray(response.entries) ? response.entries : [];
    const decorated = typeof VARIANT_PRICE.decorateVariants === 'function'
      ? VARIANT_PRICE.decorateVariants(variants, entries, currentAsin, getPdpPrice())
      : variants;
    document.getElementById('amze-variant-price-map')?.remove();
    renderVariantPriceMapPanel(decorated, currentAsin);
    variantPriceMapState = { signature };
  }

  // -------------------------------------------------------------------
  // 12.9 Local price history sparkline
  // -------------------------------------------------------------------

  async function readPriceHistory(asin) {
    try {
      const res = await sendMessageWithTimeout({ type: 'AMZE_IDB_GET_PRICE_HISTORY', asin });
      return res && Array.isArray(res.points) ? res.points : [];
    } catch (e) { return []; }
  }
  async function writePriceHistory(asin, points) {
    try {
      await sendMessageWithTimeout({ type: 'AMZE_IDB_PUT_PRICE_HISTORY', asin, points });
    } catch (e) {}
  }

  function getPriceHistoryRange(points, rangeDays) {
    if (typeof PRICE_HISTORY.filterPointsByDays === 'function') {
      return PRICE_HISTORY.filterPointsByDays(points, rangeDays);
    }
    const cutoff = Date.now() - (rangeDays * 24 * 60 * 60 * 1000);
    return (Array.isArray(points) ? points : [])
      .filter(point => point && Number.isFinite(Number(point.t)) && Number.isFinite(Number(point.p)) && Number(point.t) >= cutoff)
      .map(point => ({ p: Number(point.p), t: Number(point.t) }))
      .sort((a, b) => a.t - b.t);
  }

  function getPriceHistorySignature(points) {
    if (typeof PRICE_HISTORY.historySignature === 'function') {
      return PRICE_HISTORY.historySignature(points);
    }
    return (Array.isArray(points) ? points : [])
      .map(point => `${Number(point && point.t) || 0}:${Number(point && point.p) || 0}`)
      .join('|');
  }

  async function logAndRenderPrice() {
    if (!settings.flags.priceHistory) return;
    if (!isPdp()) return;
    const asin = getAsin();
    const price = getPdpPrice();
    if (!asin || !isFinite(price)) return;
    let points = await readPriceHistory(asin);
    const last = points[points.length - 1];
    if (!last || Math.abs(last.p - price) > 0.01 || (Date.now() - last.t) > 86400000) {
      points.push({ p: price, t: Date.now() });
      // Cap to last 60 entries per ASIN
      if (points.length > 60) points = points.slice(-60);
      await writePriceHistory(asin, points);
    }
    renderSparkline(asin, points);
  }

  function findDealBadgeElements() {
    return Array.from(document.querySelectorAll(
      '#dealBadge_feature_div, [id*="dealBadge"], .dealBadge, .badge-link, .a-badge, .a-color-price'
    )).filter(el => /limited\s+time\s+deal|deal|discount|coupon/i.test(el.textContent || ''));
  }

  function renderDealNormalizerNote(currentPrice, baselinePrice, pointCount) {
    if (document.getElementById('amze-deal-normalizer')) return;
    const note = document.createElement('div');
    note.id = 'amze-deal-normalizer';
    note.className = 'amze-pdp-badge amze-pdp-warn';
    appendStrong(note, 'Deal label normalized:');
    appendText(note, ' current price $' + currentPrice.toFixed(2));
    appendText(note, ' matches your recent local baseline of $' + baselinePrice.toFixed(2));
    appendText(note, ' from ' + pointCount + ' price-history points.');
    const target = document.querySelector('#corePriceDisplay_desktop_feature_div, #price, #centerCol');
    if (target) target.parentElement.insertBefore(note, target.nextSibling);
  }

  async function normalizeDealBadges() {
    if (!settings.flags.dealBadgeNormalizer) return;
    if (!isPdp()) return;
    if (document.documentElement.dataset.amzeDealNormalized === '1') return;
    const badges = findDealBadgeElements();
    if (!badges.length) return;
    const asin = getAsin();
    const currentPrice = getPdpPrice();
    if (!asin || !isFinite(currentPrice)) return;
    const points = await readPriceHistory(asin);
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recent = points
      .filter(pt => pt && pt.t >= cutoff && Number.isFinite(pt.p))
      .map(pt => pt.p);
    if (recent.length < 2) return;
    const baseline = median(recent);
    if (!isFinite(baseline) || baseline <= 0) return;
    const tolerance = Math.max(0.50, baseline * 0.02);
    if (Math.abs(currentPrice - baseline) > tolerance) return;
    document.documentElement.dataset.amzeDealNormalized = '1';
    badges.forEach(badge => {
      badge.dataset.amzeDealNormalized = '1';
      badge.style.display = 'none';
      badge.title = 'AmazonEnhanced hid this deal badge because local price history shows no real discount.';
    });
    renderDealNormalizerNote(currentPrice, baseline, recent.length);
  }

  function renderSparkline(asin, points, rangeDays = 365) {
    if (!points || points.length < 2) return;
    const sourceSignature = getPriceHistorySignature(points);
    const existing = document.getElementById('amze-sparkline');
    if (existing && sparklineRenderState &&
        sparklineRenderState.asin === asin &&
        sparklineRenderState.rangeDays === rangeDays &&
        sparklineRenderState.sourceSignature === sourceSignature) {
      return;
    }
    existing?.remove();
    sparklineRenderState = { asin, rangeDays, sourceSignature };

    const visiblePoints = getPriceHistoryRange(points, rangeDays);
    if (!visiblePoints.length) return;
    const prices = visiblePoints.map(p => p.p);
    const min = Math.min(...prices), max = Math.max(...prices);
    const range = max - min || 1;
    const w = 280, h = 48;
    const stepX = w / Math.max(visiblePoints.length - 1, 1);
    let d = '';
    visiblePoints.forEach((pt, i) => {
      const x = i * stepX;
      const y = h - ((pt.p - min) / range) * (h - 6) - 3;
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
    });
    const current = prices[prices.length - 1];
    const rangeLabel = `${rangeDays}-day`;
    const sparklineLabel = `Price history for ${asin}, last ${rangeLabel}: ${visiblePoints.length} points, low $${min.toFixed(2)}, high $${max.toFixed(2)}, current $${current.toFixed(2)}`;
    const panel = document.createElement('div');
    panel.id = 'amze-sparkline';
    panel.className = 'amze-pdp-badge';
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.gap = '8px';

    const copy = document.createElement('div');
    const label = createTextElement('div', '', `AmazonEnhanced — your price history (${rangeLabel}, ${visiblePoints.length} pts)`);
    label.style.fontSize = '11px';
    label.style.color = 'var(--amze-text-muted,#9399b2)';
    copy.appendChild(label);

    const summary = createTextElement('div');
    summary.style.fontSize = '12px';
    summary.style.marginTop = '2px';
    appendText(summary, 'Low ');
    appendStrong(summary, '$' + min.toFixed(2));
    appendText(summary, ' · High ');
    appendStrong(summary, '$' + max.toFixed(2));
    appendText(summary, ' · Now ');
    appendStrong(summary, '$' + current.toFixed(2));
    copy.appendChild(summary);

    const rangeControls = createTextElement('div', 'amze-sparkline-ranges');
    rangeControls.setAttribute('role', 'group');
    rangeControls.setAttribute('aria-label', 'Price history range');
    appendText(rangeControls, 'Range: ');
    const rangeDaysOptions = Array.isArray(PRICE_HISTORY.RANGE_DAYS) && PRICE_HISTORY.RANGE_DAYS.length
      ? PRICE_HISTORY.RANGE_DAYS
      : [90, 180, 365];
    rangeDaysOptions.forEach(days => {
      const rangeBtn = createActionButton('', `${days}d`, `Show the last ${days} days of price history`);
      rangeBtn.classList.add('amze-sparkline-range');
      rangeBtn.setAttribute('aria-pressed', String(days === rangeDays));
      if (days === rangeDays) rangeBtn.classList.add('amze-sparkline-range-active');
      rangeBtn.addEventListener('click', () => renderSparkline(asin, points, days));
      rangeControls.appendChild(rangeBtn);
    });
    copy.appendChild(rangeControls);
    row.appendChild(copy);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', sparklineLabel);
    svg.style.flexShrink = '0';
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = sparklineLabel;
    svg.appendChild(title);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d.trim());
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'var(--amze-accent,#89b4fa)');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    row.appendChild(svg);
    panel.appendChild(row);

    // CSV export button for the selected price-history range.
    const exportRow = document.createElement('div');
    exportRow.style.marginTop = '6px';
    exportRow.style.display = 'flex';
    exportRow.style.gap = '6px';
    const csvBtn = createActionButton('amze-sparkline-csv', 'Export CSV', 'Export price history as CSV for ' + asin);
    csvBtn.style.fontSize = '10px';
    csvBtn.style.padding = '3px 8px';
    csvBtn.addEventListener('click', () => {
      const esc = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
      const lines = ['asin,date,price'];
      visiblePoints.forEach(pt => {
        const d = new Date(pt.t);
        lines.push([esc(asin), esc(d.toISOString()), pt.p.toFixed(2)].join(','));
      });
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      downloadBlob(blob, `amazon-price-history-${asin}-${Date.now()}.csv`);
      toast('Exported ' + visiblePoints.length + ' price points from the last ' + rangeDays + ' days');
    });
    exportRow.appendChild(csvBtn);
    const jsonBtn = createActionButton('amze-sparkline-json', 'Export JSON', 'Export full local price history as JSON for ' + asin);
    jsonBtn.style.fontSize = '10px';
    jsonBtn.style.padding = '3px 8px';
    jsonBtn.addEventListener('click', () => {
      const payload = typeof PRICE_HISTORY_IO.serializePriceHistory === 'function'
        ? PRICE_HISTORY_IO.serializePriceHistory([{ asin, points }])
        : JSON.stringify({ format: 'AmazonEnhanced price history', version: 1, exportedAt: Date.now(), entries: [{ asin, points }] }, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      downloadBlob(blob, `amazon-price-history-${asin}-${Date.now()}.json`);
      toast('Exported full JSON history for ' + asin);
    });
    exportRow.appendChild(jsonBtn);
    panel.appendChild(exportRow);

    const target = document.querySelector('#corePriceDisplay_desktop_feature_div, #price, #centerCol');
    if (target) target.parentElement.insertBefore(panel, target.nextSibling);
  }

  // -------------------------------------------------------------------
  // 12.9b Price alert — set target price, background notifies when met
  // -------------------------------------------------------------------

  async function injectPriceAlertUI() {
    if (!settings.flags.priceAlert) return;
    if (!isPdp()) return;
    if (document.getElementById('amze-price-alert')) return;
    const asin = getAsin();
    if (!asin) return;

    const currentPrice = getPdpPrice();
    const titleEl = document.querySelector('#productTitle');
    const productTitle = (titleEl?.textContent || '').trim().slice(0, 100);

    // Check existing alert
    let existingAlert = null;
    try {
      const res = await sendMessageWithTimeout({ type: 'AMZE_GET_PRICE_ALERTS' });
      if (res && res.alerts && res.alerts[asin]) {
        existingAlert = res.alerts[asin];
      }
    } catch (e) {}

    const panel = document.createElement('div');
    panel.id = 'amze-price-alert';
    panel.className = 'amze-pdp-badge';
    panel.style.display = 'flex';
    panel.style.alignItems = 'center';
    panel.style.gap = '8px';
    panel.style.flexWrap = 'wrap';

    const label = createTextElement('span', '', 'Alert when under $');
    label.style.fontSize = '12px';

    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.min = '0.01';
    input.placeholder = isFinite(currentPrice) ? (currentPrice * 0.9).toFixed(2) : '0.00';
    input.style.width = '80px';
    input.style.padding = '3px 6px';
    input.style.borderRadius = '4px';
    input.style.border = '1px solid var(--amze-border, #45475a)';
    input.style.background = 'var(--amze-bg-raise, #313244)';
    input.style.color = 'var(--amze-text, #cdd6f4)';
    input.style.fontSize = '12px';
    input.setAttribute('aria-label', 'Target price for price drop alert');

    if (existingAlert && !existingAlert.notified) {
      input.value = existingAlert.target.toFixed(2);
    }

    const setBtn = createActionButton('amze-price-alert-set', existingAlert && !existingAlert.notified ? 'Update' : 'Set alert', 'Set price drop alert');
    setBtn.style.fontSize = '11px';
    setBtn.style.padding = '3px 8px';

    const clearBtn = createActionButton('amze-price-alert-clear', 'Clear', 'Remove price drop alert');
    clearBtn.style.fontSize = '11px';
    clearBtn.style.padding = '3px 8px';
    if (!existingAlert) clearBtn.style.display = 'none';

    const status = createTextElement('span', '');
    status.style.fontSize = '11px';
    status.style.color = 'var(--amze-text-muted, #9399b2)';
    if (existingAlert && !existingAlert.notified) {
      status.textContent = 'Alert active: $' + existingAlert.target.toFixed(2);
    } else if (existingAlert && existingAlert.notified) {
      status.textContent = 'Alert triggered!';
    }

    setBtn.addEventListener('click', async () => {
      const target = parseFloat(input.value);
      if (!isFinite(target) || target <= 0) { toast('Enter a valid price'); return; }
      try {
        await sendMessageWithTimeout({ type: 'AMZE_SET_PRICE_ALERT', asin, target, title: productTitle });
        status.textContent = 'Alert set: $' + target.toFixed(2);
        setBtn.textContent = 'Update';
        clearBtn.style.display = '';
        toast('Price alert set for $' + target.toFixed(2));
      } catch (e) { toast('Could not set alert'); }
    });

    clearBtn.addEventListener('click', async () => {
      try {
        await sendMessageWithTimeout({ type: 'AMZE_SET_PRICE_ALERT', asin, target: null });
        status.textContent = '';
        input.value = '';
        setBtn.textContent = 'Set alert';
        clearBtn.style.display = 'none';
        toast('Price alert cleared');
      } catch (e) { toast('Could not clear alert'); }
    });

    panel.appendChild(label);
    panel.appendChild(input);
    panel.appendChild(setBtn);
    panel.appendChild(clearBtn);
    panel.appendChild(status);

    const target = document.querySelector('#amze-sparkline, #corePriceDisplay_desktop_feature_div, #price, #centerCol');
    if (target) target.parentElement.insertBefore(panel, target.nextSibling);
  }

  // -------------------------------------------------------------------
  // 12.10 Copy clean product link
  // -------------------------------------------------------------------

  function injectCopyLinkButton() {
    if (!settings.flags.copyCleanLink) return;
    if (!isPdp()) return;
    if (document.getElementById('amze-copy-link-btn')) return;
    const asin = getAsin();
    if (!asin) return;
    const host = document.querySelector('#title_feature_div, #titleSection');
    if (!host) return;
    const btn = document.createElement('button');
    btn.id = 'amze-copy-link-btn';
    btn.type = 'button';
    btn.className = 'amze-action-btn';
    btn.textContent = '📋 Copy clean link';
    btn.setAttribute('aria-label', 'Copy clean Amazon product link as Markdown');
    btn.addEventListener('click', async () => {
      const title = (document.querySelector('#productTitle')?.textContent || '').trim();
      const priceEl = document.querySelector('#corePrice_feature_div .a-offscreen, #priceblock_ourprice, .a-price .a-offscreen');
      const price = priceEl ? priceEl.textContent.trim() : '';
      const url = `https://${location.host}/dp/${asin}`;
      const md = `[${title}](${url})${price ? ' — ' + price : ''}`;
      try {
        await navigator.clipboard.writeText(md);
        toast('Copied Markdown link to clipboard');
      } catch (e) {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = md; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); toast('Copied link'); } catch (e2) {}
        ta.remove();
      }
    });
    host.appendChild(btn);
  }

  // -------------------------------------------------------------------
  // 12.11 Order history export
  // -------------------------------------------------------------------

  function injectOrderExportButton() {
    if (!settings.flags.orderExport) return;
    if (!isOrdersPage()) return;
    if (document.getElementById('amze-order-export-btn')) return;
    const host = document.querySelector('#navFiller, .your-orders-content-container, main');
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.className = 'amze-export-wrap';
    wrap.appendChild(createTextElement('div', 'amze-export-title', 'Export orders'));
    const csvButton = createActionButton('amze-order-export-btn', 'CSV', 'Export visible orders as CSV');
    const jsonButton = createActionButton('amze-order-export-json', 'JSON', 'Export visible orders as JSON');
    const icsButton = createActionButton('amze-order-export-ics', '.ics Calendar', 'Export delivery dates as calendar events');
    const invoiceButton = createActionButton('amze-order-export-invoices', 'Invoice ZIP', 'Export visible order invoices as a ZIP of PDFs');
    const invoiceCancelButton = createActionButton('amze-order-export-invoices-cancel', 'Cancel', 'Cancel invoice PDF export');
    invoiceCancelButton.disabled = true;
    const invoiceStatus = createTextElement('div', 'amze-invoice-export-status', 'Only direct PDF responses are included; unavailable or non-PDF invoices are reported.');
    invoiceStatus.id = 'amze-invoice-export-status';
    wrap.appendChild(csvButton);
    wrap.appendChild(jsonButton);
    wrap.appendChild(icsButton);
    wrap.appendChild(invoiceButton);
    wrap.appendChild(invoiceCancelButton);
    wrap.appendChild(invoiceStatus);
    host.parentElement.insertBefore(wrap, host);
    csvButton.addEventListener('click', () => exportOrders('csv'));
    jsonButton.addEventListener('click', () => exportOrders('json'));
    icsButton.addEventListener('click', () => exportOrdersAsIcs());
    invoiceButton.addEventListener('click', () => exportInvoiceZip());
    invoiceCancelButton.addEventListener('click', () => cancelInvoiceZip());
  }

  function extractOrdersFromCurrentPage() {
    const out = [];
    const orders = document.querySelectorAll('.order-card, .order, .js-order-card');
    orders.forEach(card => {
      const record = extractOrderRecordFromCard(card);
      if (record) out.push(record);
    });
    return out;
  }

  function extractOrderRecordFromCard(card) {
    if (!card || card.getAttribute('aria-hidden') === 'true') return null;
    const orderId = (card.querySelector('[class*="order-id"], .a-col-right .a-size-mini .a-color-secondary')?.textContent || '').trim();
    const total = (card.querySelector('[class*="total"], .a-col-right .a-size-base')?.textContent || '').trim();
    const date = (card.querySelector('[class*="order-date"], .a-col-left .a-size-base')?.textContent || '').trim();
    const items = [];
    card.querySelectorAll('.yohtmlc-item, .a-fixed-left-grid').forEach(it => {
      const title = (it.querySelector('.a-link-normal, h3')?.textContent || '').trim();
      if (title) items.push(title);
    });
    if (!orderId && !total && !date && !items.length) return null;
    return { orderId, date, total, items };
  }

  function injectMarkdownReceiptButtons() {
    if (!settings.flags.orderExport || !isOrdersPage()) return;
    if (typeof RECEIPT_MARKDOWN.formatReceiptMarkdown !== 'function') return;
    document.querySelectorAll('.order-card, .order, .js-order-card').forEach(card => {
      if (!card || card.getAttribute('aria-hidden') === 'true' || card.querySelector('[data-amze-receipt-md]')) return;
      const record = extractOrderRecordFromCard(card);
      if (!record) return;
      const host = card.querySelector('.yohtmlc-order-level-connections, [class*="order-level-connections"], [class*="order-actions"]') || card;
      const button = createActionButton('', 'Markdown', 'Download this order as a Markdown receipt');
      button.dataset.amzeReceiptMd = '1';
      button.classList.add('amze-order-receipt-md');
      button.addEventListener('click', () => {
        const current = extractOrderRecordFromCard(card) || record;
        const markdown = RECEIPT_MARKDOWN.formatReceiptMarkdown(current);
        const filename = RECEIPT_MARKDOWN.buildReceiptFilename(current);
        downloadBlob(new Blob([markdown], { type: 'text/markdown' }), filename);
        toast('Downloaded Markdown receipt');
      });
      host.appendChild(button);
    });
  }

  async function exportOrders(format) {
    toast('Scanning this orders page...');
    const rows = extractOrdersFromCurrentPage();
    if (!rows.length) { toast('No orders found on this page'); return; }
    let blob;
    if (format === 'json') {
      blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    } else {
      const esc = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
      const lines = ['orderId,date,total,items'];
      rows.forEach(r => lines.push([esc(r.orderId), esc(r.date), esc(r.total), esc((r.items || []).join(' | '))].join(',')));
      blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    }
    downloadBlob(blob, `amazon-orders-${Date.now()}.${format}`);
    toast(`Exported ${rows.length} orders`);
  }

  function waitForInvoiceExport(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function setInvoiceExportControls(running) {
    const start = document.querySelector('#amze-order-export-invoices');
    const cancel = document.querySelector('#amze-order-export-invoices-cancel');
    if (start) start.disabled = running;
    if (cancel) cancel.disabled = !running;
  }

  function setInvoiceExportStatus(text) {
    const status = document.querySelector('#amze-invoice-export-status');
    if (status) status.textContent = text;
  }

  function cancelInvoiceZip() {
    if (!invoiceExportState) return;
    invoiceExportState.cancelled = true;
    try { invoiceExportState.controller?.abort(); } catch (e) {}
    setInvoiceExportStatus('Canceling after the current invoice request...');
  }

  async function exportInvoiceZip() {
    if (invoiceExportState) return;
    if (typeof INVOICE_EXPORT.extractInvoiceCandidatesFromPage !== 'function' || typeof ZIP_STORE.createZip !== 'function') {
      toast('Invoice export is unavailable in this build');
      return;
    }
    const candidates = INVOICE_EXPORT.extractInvoiceCandidatesFromPage(document, location.href);
    if (!candidates.length) {
      setInvoiceExportStatus('No visible invoice links or eligible order IDs found on this page.');
      toast('No invoice links found on this orders page');
      return;
    }

    const state = { cancelled: false, controller: null };
    invoiceExportState = state;
    setInvoiceExportControls(true);
    setInvoiceExportStatus(`Found ${candidates.length} invoice candidate${candidates.length === 1 ? '' : 's'}. Starting a ${INVOICE_EXPORT.INVOICE_FETCH_DELAY_MS / 1000}-second rate-limited export...`);
    const files = [];
    const failures = [];
    const nameCounts = new Map();

    try {
      for (let i = 0; i < candidates.length; i++) {
        if (state.cancelled) break;
        if (i > 0) await waitForInvoiceExport(INVOICE_EXPORT.INVOICE_FETCH_DELAY_MS);
        if (state.cancelled) break;
        const candidate = candidates[i];
        setInvoiceExportStatus(`Fetching invoice ${i + 1}/${candidates.length}${candidate.orderId ? ` (${candidate.orderId})` : ''}...`);
        state.controller = new AbortController();
        try {
          const response = await fetch(candidate.href, {
            credentials: 'include',
            cache: 'no-store',
            signal: state.controller.signal
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (!INVOICE_EXPORT.looksLikePdf(bytes)) {
            throw new Error('response was not a PDF');
          }
          const baseName = INVOICE_EXPORT.buildInvoiceFilename(candidate);
          const count = (nameCounts.get(baseName) || 0) + 1;
          nameCounts.set(baseName, count);
          const name = count > 1
            ? INVOICE_EXPORT.buildInvoiceFilename(candidate, count)
            : baseName;
          files.push({ name, data: bytes });
        } catch (e) {
          if (state.cancelled || (e && e.name === 'AbortError')) break;
          failures.push({ candidate, reason: e && e.message ? e.message : 'request failed' });
        } finally {
          state.controller = null;
        }
      }

      if (state.cancelled) {
        setInvoiceExportStatus(`Invoice export canceled. ${files.length} PDF${files.length === 1 ? '' : 's'} collected; no ZIP was downloaded.`);
        return;
      }
      if (!files.length) {
        setInvoiceExportStatus(`No PDF invoices were returned. ${failures.length} candidate${failures.length === 1 ? '' : 's'} failed or were unavailable.`);
        toast('No invoice PDFs were available');
        return;
      }
      const zipBytes = ZIP_STORE.createZip(files);
      downloadBlob(new Blob([zipBytes], { type: 'application/zip' }), `amazon-invoices-${Date.now()}.zip`);
      setInvoiceExportStatus(`Downloaded ${files.length} invoice PDF${files.length === 1 ? '' : 's'} in one ZIP; ${failures.length} unavailable.`);
      toast(`Exported ${files.length} invoice PDFs`);
    } finally {
      invoiceExportState = null;
      setInvoiceExportControls(false);
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  }

  // -------------------------------------------------------------------
  // 12.11b .ics calendar export of delivery dates
  // -------------------------------------------------------------------

  function parseDeliveryDate(text) {
    if (!text) return null;
    const m = text.match(/([A-Z][a-z]+)\s+(\d{1,2})(?:\s*[-,]\s*(\d{1,2}))?(?:\s*,?\s*(\d{4}))?/);
    if (!m) return null;
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const month = months.indexOf(m[1].toLowerCase().slice(0, 3));
    if (month < 0) return null;
    const day = parseInt(m[2], 10);
    const year = m[4] ? parseInt(m[4], 10) : new Date().getFullYear();
    return new Date(year, month, day);
  }

  function formatIcsDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  function extractOrderDeliveryDates() {
    const events = [];
    document.querySelectorAll('.order-card, .order, .js-order-card').forEach(card => {
      const orderId = (card.querySelector('[class*="order-id"], .a-col-right .a-size-mini .a-color-secondary')?.textContent || '').trim();
      const deliveryEl = card.querySelector('[class*="delivery-date"], [class*="promise"], .delivery-box__primary-text, .a-size-medium.a-color-base');
      const deliveryText = (deliveryEl?.textContent || '').trim();
      const deliveryDate = parseDeliveryDate(deliveryText);
      if (!deliveryDate) return;

      const items = [];
      card.querySelectorAll('.yohtmlc-item, .a-fixed-left-grid').forEach(it => {
        const title = (it.querySelector('.a-link-normal, h3')?.textContent || '').trim();
        if (title) items.push(title);
      });
      const summary = items.length ? items[0].slice(0, 60) : 'Amazon delivery';
      events.push({
        orderId,
        date: deliveryDate,
        summary: orderId ? `Amazon: ${summary} (${orderId})` : `Amazon: ${summary}`,
        description: items.join('\\n')
      });
    });
    return events;
  }

  function exportOrdersAsIcs() {
    const events = extractOrderDeliveryDates();
    if (!events.length) { toast('No delivery dates found on this page'); return; }
    const now = new Date();
    const stamp = formatIcsDate(now) + 'T' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + '00';
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AmazonEnhanced//Delivery Export//EN\r\nCALSCALE:GREGORIAN\r\n';
    events.forEach((ev, i) => {
      const dateStr = formatIcsDate(ev.date);
      const nextDay = new Date(ev.date);
      nextDay.setDate(nextDay.getDate() + 1);
      const endStr = formatIcsDate(nextDay);
      ics += 'BEGIN:VEVENT\r\n';
      ics += 'UID:amze-' + (ev.orderId || i) + '-' + dateStr + '@amazonenhanced\r\n';
      ics += 'DTSTAMP:' + stamp + '\r\n';
      ics += 'DTSTART;VALUE=DATE:' + dateStr + '\r\n';
      ics += 'DTEND;VALUE=DATE:' + endStr + '\r\n';
      ics += 'SUMMARY:' + ev.summary.replace(/[,;\\]/g, ' ') + '\r\n';
      if (ev.description) ics += 'DESCRIPTION:' + ev.description.replace(/[,;]/g, ' ').slice(0, 200) + '\r\n';
      ics += 'END:VEVENT\r\n';
    });
    ics += 'END:VCALENDAR\r\n';
    const blob = new Blob([ics], { type: 'text/calendar' });
    downloadBlob(blob, `amazon-deliveries-${Date.now()}.ics`);
    toast(`Exported ${events.length} delivery dates`);
  }

  // -------------------------------------------------------------------
  // 12.12 Wishlist export
  // -------------------------------------------------------------------

  function getWishlistImportTarget() {
    const idMatch = location.pathname.match(/\/hz\/wishlist\/ls\/([A-Z0-9-]+)/i);
    const nameEl = document.querySelector('#profile-list-name, #wl-list-info h1, #wl-list-info .a-size-large');
    let listName = (nameEl?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!listName) {
      const infoText = document.querySelector('#wl-list-info')?.textContent || '';
      listName = infoText.replace(/\s+/g, ' ').replace(/\b\d+\s+(?:items?|products?)\b.*$/i, '').trim();
    }
    listName = listName.slice(0, 120) || 'Wish List';
    return { listId: idMatch ? idMatch[1] : '', listName };
  }

  function updateWishlistImportUi(progress) {
    const status = document.querySelector('#amze-wl-import-status');
    if (!status || !progress) return;
    if (wishlistImportJobId && progress.jobId && progress.jobId !== wishlistImportJobId) return;
    if (progress.jobId && !wishlistImportJobId) wishlistImportJobId = progress.jobId;

    const startButton = document.querySelector('#amze-wl-import-start');
    const cancelButton = document.querySelector('#amze-wl-import-cancel');
    const fileInput = document.querySelector('#amze-wl-import-file');
    const chooseButton = document.querySelector('#amze-wl-import-choose');
    const total = Number(progress.total) || wishlistImportItems.length;
    const completed = Number(progress.completed) || 0;
    const succeeded = Number(progress.succeeded) || 0;
    const failed = Number(progress.failed) || 0;

    if (progress.status === 'running') {
      status.textContent = `Importing ${completed}/${total}: ${progress.current || progress.asin || 'next item'}... (${succeeded} added, ${failed} failed)`;
      if (startButton) startButton.disabled = true;
      if (fileInput) fileInput.disabled = true;
      if (cancelButton) cancelButton.disabled = false;
      return;
    }

    wishlistImportJobId = '';
    if (fileInput) fileInput.disabled = false;
    if (chooseButton) chooseButton.disabled = false;
    if (cancelButton) cancelButton.disabled = true;
    if (startButton) startButton.disabled = true;
    if (progress.status === 'complete') {
      status.textContent = `Import complete: ${succeeded} added, ${failed} failed out of ${total}.`;
      toast(`Wishlist import finished: ${succeeded} added`);
    } else if (progress.status === 'canceled') {
      status.textContent = `Import canceled after ${completed}/${total}: ${succeeded} added, ${failed} failed.`;
      toast('Wishlist import canceled');
    }
  }

  function injectWishlistExportButton() {
    const exportEnabled = !!settings.flags.wishlistExport;
    const importEnabled = !!settings.flags.wishlistImport;
    if (!exportEnabled && !importEnabled) return;
    if (!isWishlistPage()) return;
    if (document.getElementById('amze-wl-tools')) return;
    const host = document.querySelector('#profile-list-name, #wl-list-info, main, #left-nav');
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.id = 'amze-wl-tools';
    wrap.className = 'amze-export-wrap';
    wrap.appendChild(createTextElement('div', 'amze-export-title', exportEnabled && importEnabled ? 'Wishlist tools' : (exportEnabled ? 'Export wishlist' : 'Import wishlist')));
    if (exportEnabled) {
      const csvButton = createActionButton('amze-wl-export-btn', 'CSV', 'Export wishlist as CSV');
      const jsonButton = createActionButton('amze-wl-export-json', 'JSON', 'Export wishlist as JSON');
      const mdButton = createActionButton('amze-wl-export-md', 'Markdown', 'Export wishlist as Markdown');
      wrap.appendChild(csvButton);
      wrap.appendChild(jsonButton);
      wrap.appendChild(mdButton);
      csvButton.addEventListener('click', () => exportWishlist('csv'));
      jsonButton.addEventListener('click', () => exportWishlist('json'));
      mdButton.addEventListener('click', () => exportWishlist('md'));
    }
    if (importEnabled) {
      const importBox = createTextElement('div', 'amze-wl-import-box');
      const target = getWishlistImportTarget();
      importBox.appendChild(createTextElement('div', 'amze-wl-import-target', `Target list: ${target.listName}`));
      importBox.appendChild(createTextElement('div', 'amze-wl-import-help', 'Choose an AmazonEnhanced wishlist JSON export. Items are added one at a time through Amazon controls.'));
      const fileInput = document.createElement('input');
      fileInput.id = 'amze-wl-import-file';
      fileInput.type = 'file';
      fileInput.accept = '.json,application/json';
      fileInput.hidden = true;
      const chooseButton = createActionButton('amze-wl-import-choose', 'Choose JSON', 'Choose a wishlist JSON export');
      const startButton = createActionButton('amze-wl-import-start', 'Import items', 'Start importing wishlist items');
      const cancelButton = createActionButton('amze-wl-import-cancel', 'Cancel', 'Cancel wishlist import');
      startButton.disabled = true;
      cancelButton.disabled = true;
      const status = createTextElement('div', 'amze-wl-import-status', 'No file selected.');
      status.id = 'amze-wl-import-status';
      importBox.appendChild(fileInput);
      importBox.appendChild(chooseButton);
      importBox.appendChild(startButton);
      importBox.appendChild(cancelButton);
      importBox.appendChild(status);
      wrap.appendChild(importBox);

      chooseButton.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try {
          if (typeof WISHLIST_IMPORT.parseWishlistImport !== 'function') throw new Error('Wishlist import is unavailable');
          const text = typeof file.text === 'function'
            ? await file.text()
            : await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(reader.error || new Error('Could not read file'));
              reader.readAsText(file);
            });
          wishlistImportItems = WISHLIST_IMPORT.parseWishlistImport(text);
          startButton.disabled = false;
          status.textContent = `Loaded ${wishlistImportItems.length} items. Review the count, then click Import items.`;
        } catch (e) {
          wishlistImportItems = [];
          startButton.disabled = true;
          status.textContent = e && e.message ? e.message : 'Could not read wishlist JSON.';
        }
      });
      startButton.addEventListener('click', async () => {
        if (!wishlistImportItems.length || wishlistImportJobId) return;
        startButton.disabled = true;
        chooseButton.disabled = true;
        status.textContent = 'Starting wishlist import...';
        const response = await sendMessageWithTimeout({
          type: 'AMZE_START_WISHLIST_IMPORT',
          items: wishlistImportItems,
          wishlist: getWishlistImportTarget()
        }, 7000);
        if (!response || !response.ok || !response.jobId) {
          startButton.disabled = false;
          chooseButton.disabled = false;
          status.textContent = response && response.reason
            ? `Could not start import: ${response.reason}`
            : 'Could not start wishlist import. Keep this wishlist tab open and try again.';
          return;
        }
        wishlistImportJobId = response.jobId;
        cancelButton.disabled = false;
        status.textContent = `Queued ${response.total || wishlistImportItems.length} items...`;
      });
      cancelButton.addEventListener('click', async () => {
        if (!wishlistImportJobId) return;
        cancelButton.disabled = true;
        const jobId = wishlistImportJobId;
        const response = await sendMessageWithTimeout({ type: 'AMZE_CANCEL_WISHLIST_IMPORT', jobId }, 5000);
        if (!response || !response.ok) {
          cancelButton.disabled = false;
          status.textContent = 'Could not cancel yet; the current item may still be finishing.';
        }
      });
    }
    host.parentElement.insertBefore(wrap, host);
  }

  function extractWishlistItems() {
    const items = [];
    document.querySelectorAll('[data-itemid], li.g-item-sortable').forEach(li => {
      const titleEl = li.querySelector('h3 a, a[href*="/dp/"] span');
      const priceEl = li.querySelector('.a-price .a-offscreen, .a-color-price');
      const link = li.querySelector('a[href*="/dp/"]');
      const asinMatch = link ? link.href.match(/\/dp\/([A-Z0-9]{10})/i) : null;
      items.push({
        asin:  asinMatch ? asinMatch[1].toUpperCase() : '',
        title: (titleEl?.textContent || '').trim(),
        price: (priceEl?.textContent || '').trim(),
        url:   link ? link.href.split('?')[0] : ''
      });
    });
    return items.filter(i => i.title);
  }

  async function exportWishlist(format) {
    const items = extractWishlistItems();
    if (!items.length) { toast('No wishlist items found'); return; }
    let blob;
    if (format === 'json') {
      blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    } else if (format === 'md') {
      const md = items.map(i => `- [${i.title}](${i.url}) ${i.price ? '— ' + i.price : ''}`).join('\n');
      blob = new Blob([md], { type: 'text/markdown' });
    } else {
      const esc = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
      const lines = ['asin,title,price,url'];
      items.forEach(i => lines.push([esc(i.asin), esc(i.title), esc(i.price), esc(i.url)].join(',')));
      blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    }
    downloadBlob(blob, `amazon-wishlist-${Date.now()}.${format === 'md' ? 'md' : format}`);
    toast(`Exported ${items.length} wishlist items`);
  }

  function wishlistImportElementLabel(el) {
    return [el.getAttribute('aria-label'), el.getAttribute('title'), el.value, el.textContent]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function isWishlistImportVisible(el) {
    if (!el || el.hidden || el.disabled) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function normalizeWishlistImportLabel(value) {
    return String(value || '').toLowerCase()
      .replace(/\(\s*\d+\s*\)/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function wishlistImportTargetMatches(el, target) {
    const targetId = String(target.listId || '').toLowerCase();
    if (targetId) {
      const attributes = ['data-list-id', 'data-listid', 'data-list-id-value']
        .map(name => String(el.getAttribute(name) || '').toLowerCase());
      const href = String(el.getAttribute('href') || '').toLowerCase();
      if (attributes.includes(targetId) || href.includes(targetId)) return true;
    }
    const targetName = normalizeWishlistImportLabel(target.listName);
    if (!targetName) return false;
    const label = normalizeWishlistImportLabel(wishlistImportElementLabel(el));
    return label === targetName || label.startsWith(targetName + ' ') || label.includes(targetName);
  }

  function collectWishlistImportListControls() {
    const scopes = document.querySelectorAll(
      '[data-add-to-list-popover], [id*="add-to-list"], [id*="wishlist"], [class*="add-to-list"], [class*="wishlist"], [role="menu"], [role="listbox"]'
    );
    const controls = [];
    const seen = new Set();
    scopes.forEach(scope => {
      if (scope.matches('[data-list-id], [data-listid], [role="option"], [role="menuitem"]') && !seen.has(scope)) {
        seen.add(scope);
        controls.push(scope);
      }
      scope.querySelectorAll('button, a, input, label, li, [data-list-id], [data-listid], [role="option"], [role="menuitem"]')
        .forEach(el => {
          if (!seen.has(el)) {
            seen.add(el);
            controls.push(el);
          }
        });
    });
    return controls;
  }

  function findWishlistImportTargetControl(target) {
    return collectWishlistImportListControls()
      .find(el => isWishlistImportVisible(el) && wishlistImportTargetMatches(el, target)) || null;
  }

  function wishlistImportChooserVisible() {
    const selectors = [
      '[role="menu"]',
      '[role="listbox"]',
      '.a-popover:not([aria-hidden="true"])',
      '[data-add-to-list-popover]'
    ];
    return selectors.some(selector => Array.from(document.querySelectorAll(selector)).some(isWishlistImportVisible));
  }

  function findWishlistImportAddControl() {
    const selectors = [
      '#add-to-wishlist-button-submit',
      '#add-to-list-button',
      '#add-to-list-button-announce',
      '[data-action="add-to-list"] button',
      '[data-action="add-to-list"] input',
      'input[name*="add-to-list"]',
      'input[name*="add-to-registry.wishlist"]',
      'button[aria-label*="add to list" i]',
      'input[aria-label*="add to list" i]'
    ];
    const candidates = [];
    const seen = new Set();
    selectors.forEach(selector => document.querySelectorAll(selector).forEach(el => {
      if (!seen.has(el)) {
        seen.add(el);
        candidates.push(el);
      }
    }));
    return candidates.find(el => {
      if (!isWishlistImportVisible(el)) return false;
      const label = wishlistImportElementLabel(el);
      return el.id === 'add-to-wishlist-button-submit' || /add to (?:wish )?list|save to list/i.test(label);
    }) || null;
  }

  function wishlistImportSuccessVisible(target) {
    const successText = Array.from(document.querySelectorAll(
      '.add-to-list-success-label, [class*="add-to-list"][class*="success"], [data-add-to-list-success]'
    )).filter(isWishlistImportVisible).map(el => el.textContent || '').join(' ');
    const normalizedSuccess = normalizeWishlistImportLabel(successText);
    if (!normalizedSuccess) return false;
    const targetName = normalizeWishlistImportLabel(target && target.listName);
    const namedSuccess = /(?:added|saved) to|already (?:in|on)/i.test(normalizedSuccess);
    if (!namedSuccess) return false;
    if (targetName && targetName !== 'wish list') return normalizedSuccess.includes(targetName);
    return true;
  }

  function waitForWishlistImport(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function processWishlistImportItem(msg) {
    const asin = typeof WISHLIST_IMPORT.extractAsin === 'function'
      ? WISHLIST_IMPORT.extractAsin(msg && msg.asin)
      : String(msg && msg.asin || '').toUpperCase();
    if (!asin || asin !== getAsin()) return { ok: false, asin, reason: 'asin_mismatch' };
    const addControl = findWishlistImportAddControl();
    if (!addControl) return { ok: false, asin, reason: 'add_to_list_control_not_found' };
    const beforeLabel = wishlistImportElementLabel(addControl);
    if (/already (?:in|on)|added to|in your wish list/i.test(beforeLabel)) {
      return { ok: true, asin, reason: 'already_present' };
    }

    try { addControl.click(); } catch (e) { return { ok: false, asin, reason: 'add_to_list_click_failed' }; }
    const target = {
      listId: String(msg && msg.targetListId || ''),
      listName: String(msg && msg.targetListName || '')
    };
    let chosenTarget = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      await waitForWishlistImport(300);
      const targetControl = findWishlistImportTargetControl(target);
      if (targetControl) {
        try { targetControl.click(); chosenTarget = true; } catch (e) {}
        break;
      }
      if (!wishlistImportChooserVisible()) break;
    }

    if (!chosenTarget && wishlistImportChooserVisible() && target.listName) {
      return { ok: false, asin, reason: 'target_list_not_found' };
    }
    await waitForWishlistImport(chosenTarget ? 650 : 350);
    const afterControl = findWishlistImportAddControl();
    const changed = !addControl.isConnected || !afterControl ||
      wishlistImportElementLabel(afterControl) !== beforeLabel || !!afterControl.disabled;
    if (chosenTarget || wishlistImportSuccessVisible(target) || (changed && target.listName === 'Wish List')) {
      return { ok: true, asin, reason: chosenTarget ? 'added_to_target_list' : 'added' };
    }
    return { ok: false, asin, reason: 'add_to_list_not_confirmed' };
  }

  // -------------------------------------------------------------------
  // 12.13 Late-delivery watcher — register via message to background.
  //       Content script just hints to bg when we're on orders page.
  // -------------------------------------------------------------------

  function pushOrdersToWatcher() {
    if (!settings.flags.lateDeliveryWatch) return;
    if (!isOrdersPage()) return;
    const orders = [];
    document.querySelectorAll('.order-card, .order, .js-order-card').forEach(card => {
      const promiseEl = card.querySelector('[class*="promise"], [class*="delivery-date"], .a-size-medium.a-color-base');
      const statusEl  = card.querySelector('[class*="shipment-progress"], .delivery-box__primary-text');
      const orderId = (card.querySelector('[class*="order-id"], bdi')?.textContent || '').trim();
      const promise = (promiseEl?.textContent || '').trim();
      const status  = (statusEl?.textContent || '').trim();
      if (orderId && promise) orders.push({ orderId, promise, status, seenAt: Date.now() });
    });
    if (orders.length) {
      try { sendMessageWithTimeout({ type: 'AMZE_SEED_ORDERS', orders }); } catch (e) {}
    }
  }

  // -------------------------------------------------------------------
  // 12.14 Accessibility pack
  // -------------------------------------------------------------------

  function applyAriaFixes() {
    if (!settings.flags.ariaFixes) return;
    // Add aria-label to icon-only buttons Amazon ships unlabeled.
    document.querySelectorAll('button:not([aria-label]):not([data-amze-aria])').forEach(b => {
      if (b.textContent && b.textContent.trim().length >= 2) return;
      const svg = b.querySelector('svg, i.a-icon');
      if (!svg) return;
      b.dataset.amzeAria = '1';
      const title = b.getAttribute('title') || b.className || 'button';
      b.setAttribute('aria-label', title);
    });
  }

  // -------------------------------------------------------------------
  // 12.15 Allergen / ingredient watchlist
  // -------------------------------------------------------------------

  function scanAllergens() {
    if (!settings.flags.allergenScan) return;
    const list = (settings.allergens || '')
      .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!list.length) return;
    if (document.getElementById('amze-allergen-warn')) return;
    if (!isPdp()) return;
    const haystack = [
      (document.querySelector('#productTitle')?.textContent || ''),
      (document.querySelector('#feature-bullets')?.textContent || ''),
      (document.querySelector('#productDescription')?.textContent || ''),
      (document.querySelector('#aplus')?.textContent || ''),
      (document.querySelector('#detailBullets_feature_div')?.textContent || '')
    ].join(' ').toLowerCase();
    const hits = list.filter(term => haystack.includes(term.toLowerCase()));
    if (!hits.length) return;
    const warn = document.createElement('div');
    warn.id = 'amze-allergen-warn';
    warn.className = 'amze-pdp-badge amze-pdp-warn';
    appendText(warn, '⚠ ');
    appendStrong(warn, 'Allergen match:');
    appendText(warn, ' ');
    hits.forEach(h => {
      const chip = createTextElement('span', '', h);
      chip.style.background = 'var(--amze-bg-raise)';
      chip.style.padding = '1px 6px';
      chip.style.borderRadius = '3px';
      chip.style.marginRight = '4px';
      warn.appendChild(chip);
    });
    const target = document.querySelector('#titleSection') || document.querySelector('#centerCol');
    if (target) target.insertBefore(warn, target.firstChild);
  }

  // -------------------------------------------------------------------
  // 12.X Driver — runs all v2.0 features on every scan cycle.
  // -------------------------------------------------------------------

  function runFeaturePack() {
    if (!settings) return;
    try { autoDeclineWarranty(); } catch (e) {}
    try { forceOneTimePurchase(); } catch (e) {}
    try { autoUncheckDarkPatterns(); } catch (e) {}
    try { skipRecommendedUpgradePrompts(); } catch (e) {}
    try { disablePrimeTrialPrechecks(); } catch (e) {}
    try { inspectShippingChange(); } catch (e) {}
    try { detectFrequentlyReturnedItem(); } catch (e) {}
    try { injectExtraSortOptions(); } catch (e) {}
    try { injectCpuTamer(); } catch (e) {}
    try { annotateCountry(); } catch (e) {}
    try { revealSellerPdp(); } catch (e) {}
    try { detectCounterfeitRisk(); } catch (e) {}
    try { detectVariationBait(); } catch (e) {}
    try { renderVariantPriceMap(); } catch (e) {}
    try { logAndRenderPrice(); } catch (e) {}
    try { normalizeDealBadges(); } catch (e) {}
    try { injectPriceAlertUI(); } catch (e) {}
    try { injectCopyLinkButton(); } catch (e) {}
    try { injectOrderExportButton(); } catch (e) {}
    try { injectMarkdownReceiptButtons(); } catch (e) {}
    try { injectWishlistExportButton(); } catch (e) {}
    try { pushOrdersToWatcher(); } catch (e) {}
    try { applyAriaFixes(); } catch (e) {}
    try { scanAllergens(); } catch (e) {}
  }

  // -------------------------------------------------------------------
  // 11. Init
  // -------------------------------------------------------------------

  function init() {
    if (typeof AmzeMutationQueue !== 'undefined' && typeof AmzeMutationQueue.createWeakMutationQueue === 'function') {
      mutationQueue = AmzeMutationQueue.createWeakMutationQueue(runTargetedMutationScan, 180);
    }
    exposeMutationScanMetrics();
    applyFlagAttributes();
    schedule();
    startObserver();
    runFeaturePack();
    applyAccessibilityAttrs();
    // Mark ready so anti-FOUC releases (body opacity 1)
    document.documentElement.setAttribute('data-amze-ready', '1');
  }

  function applyAccessibilityAttrs() {
    const html = document.documentElement;
    html.toggleAttribute('data-amze-large-text',   !!settings.flags.largeText);
    html.toggleAttribute('data-amze-high-contrast', !!settings.flags.highContrast);
  }

  async function boot() {
    try {
      await hydrateLocaleFromCatalog();
      await loadSelectorPack();
      DEFAULT_SETTINGS = await loadDefaultSettings();
      settings = cloneDefaultSettings();
      getSettings(init);
    } catch (e) {
      document.documentElement.setAttribute('data-amze-ready', '1');
    }
  }

  boot();

})();
