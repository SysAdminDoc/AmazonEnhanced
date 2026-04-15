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

  // -------------------------------------------------------------------
  // 1. Defaults + storage
  // -------------------------------------------------------------------

  const DEFAULT_SETTINGS = {
    theme: 'dark',               // 'dark' | 'amoled' | 'light'
    density: 'comfortable',      // 'comfortable' | 'compact'
    imageMode: 'tile',           // 'off' | 'tile' | 'dim' | 'invert' | 'smart'
    flags: {
      hideSponsored:      true,
      shadeSponsored:     false,
      hideVideoAds:       true,
      hidePrimeNag:       true,
      hideBanners:        true,
      hideAmazonBrands:   false,
      hideCustomBrands:   false,
      hideCN:             false,
      reviewScore:        true,
      pricePerUnit:       true,
      listPriceWarn:      true,
      stripAffiliate:     true,
      hideBrandsRelated:  true,
      hideInspired:       true,
      hideAlsoBought:     true,
      hideBuyAgain:       false,
      hideClimate:        false,
      hideEditorial:      true,
      hideManufacturer:   false,
      hideCompare:        false,
      hideSubSave:        true,
      hideCartUpsell:     true,
      hideHomeClutter:    true,
      hideFooter:         false,
      hidePadding:        true,
      // v2.0.0 — dark-pattern pack
      autoDeclineWarranty:     true,
      forceOneTimePurchase:    true,
      autoUncheckDarkPatterns: true,
      extraSortOptions:        true,
      cpuTamer:                false,
      // v2.0.0 — transparency pack
      countryBadge:            true,
      revealSeller:            true,
      variationBait:           true,
      priceHistory:            true,
      // v2.0.0 — tools / data portability
      copyCleanLink:           true,
      orderExport:             true,
      wishlistExport:          true,
      lateDeliveryWatch:       false,
      // v2.0.0 — accessibility
      largeText:               false,
      highContrast:            false,
      ariaFixes:               true,
      // v2.0.0 — safety
      allergenScan:            false
    },
    customBrands: '',            // newline-separated regex patterns
    allergens: '',               // newline-separated allergen terms
    toastsEnabled: true
  };

  let settings = structuredClone(DEFAULT_SETTINGS);
  const LOCALE_TLD = (() => {
    const h = location.hostname;
    const m = h.match(/amazon\.(.+)$/);
    return m ? m[1] : 'com';
  })();

  function getSettings(cb) {
    try {
      chrome.storage.local.get(['amzeSettings'], (r) => {
        if (r && r.amzeSettings) {
          settings = Object.assign({}, DEFAULT_SETTINGS, r.amzeSettings);
          settings.flags = Object.assign({}, DEFAULT_SETTINGS.flags, r.amzeSettings.flags || {});
        }
        cb();
      });
    } catch (e) {
      cb();
    }
  }

  function saveSettings() {
    try { chrome.storage.local.set({ amzeSettings: settings }); } catch (e) {}
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
    el.textContent = msg;
    document.body && document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function debounce(fn, wait) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, arguments), wait);
    };
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
  // -------------------------------------------------------------------

  const SPONSORED_SELECTORS = [
    '[data-component-type="sp-sponsored-result"]',
    '.AdHolder',
    '[data-cel-widget*="MAIN-SPONSORED"]',
    '[cel_widget_id*="MAIN-SPONSORED"]'
  ].join(',');

  function isSponsoredTile(el) {
    if (!el) return false;
    if (el.matches && el.matches(SPONSORED_SELECTORS)) return true;
    // Fallback: look for "Sponsored" label inside the tile.
    const label = el.querySelector && el.querySelector('.s-sponsored-label-info-icon, .puis-label-popover-default, [aria-label*="Sponsored" i]');
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

  function processResultTile(el) {
    if (!el || el.dataset.amzeProcessed) return;
    el.dataset.amzeProcessed = '1';

    const flags = settings.flags;

    // Sponsored handling
    if (isSponsoredTile(el)) {
      if (flags.hideSponsored) {
        el.remove();
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
  }

  // -------------------------------------------------------------------
  // 5. Price-per-unit inference (result tile level + PDP)
  // -------------------------------------------------------------------

  // Units we can normalize to a canonical form. Keys are regex sources.
  const UNIT_MAP = [
    // Weight
    { re: /\b([\d.,]+)\s*(oz|ounce|ounces)\b/i, unit: 'oz' },
    { re: /\b([\d.,]+)\s*(lb|lbs|pound|pounds)\b/i, unit: 'oz', factor: 16 },
    { re: /\b([\d.,]+)\s*(g|gram|grams)\b/i, unit: 'g' },
    { re: /\b([\d.,]+)\s*(kg|kilogram|kilograms)\b/i, unit: 'g', factor: 1000 },
    { re: /\b([\d.,]+)\s*(mg|milligram|milligrams)\b/i, unit: 'g', factor: 0.001 },
    // Volume
    { re: /\b([\d.,]+)\s*(fl\.?\s*oz|fluid\s*ounce|fluid\s*ounces)\b/i, unit: 'floz' },
    { re: /\b([\d.,]+)\s*(ml|milliliter|milliliters)\b/i, unit: 'ml' },
    { re: /\b([\d.,]+)\s*(l|liter|liters|litre|litres)\b/i, unit: 'ml', factor: 1000 },
    { re: /\b([\d.,]+)\s*(gal|gallon|gallons)\b/i, unit: 'floz', factor: 128 },
    // Count
    { re: /\bpack\s*of\s*([\d.,]+)\b/i, unit: 'ct' },
    { re: /\b([\d.,]+)\s*(count|ct|pcs|pieces|capsules|tablets|rolls|sheets|pods|bags|bars|cans|bottles|tissues|pairs)\b/i, unit: 'ct' },
    { re: /\b([\d.,]+)\s*[-x]\s*pack\b/i, unit: 'ct' },
    // Length
    { re: /\b([\d.,]+)\s*(ft|foot|feet)\b/i, unit: 'ft' },
    { re: /\b([\d.,]+)\s*(m|meter|meters|metre|metres)\b/i, unit: 'ft', factor: 3.28084 }
  ];

  function extractQuantity(title) {
    if (!title) return null;
    for (const spec of UNIT_MAP) {
      const m = title.match(spec.re);
      if (m) {
        const raw = parseNumber(m[1]);
        if (isNaN(raw)) continue;
        const qty = raw * (spec.factor || 1);
        return { qty, unit: spec.unit };
      }
    }
    return null;
  }

  function extractTilePrice(el) {
    const priceEl = el.querySelector('.a-price .a-offscreen, .a-price-whole');
    if (!priceEl) return NaN;
    return parseNumber(priceEl.textContent);
  }

  function extractTileTitle(el) {
    const titleEl = el.querySelector('h2 span, h2 a span, .s-link-style span');
    return titleEl ? (titleEl.textContent || '').trim() : '';
  }

  function formatUnitPrice(price, qty, unit) {
    if (!isFinite(price) || !isFinite(qty) || qty <= 0) return '';
    const per = price / qty;
    // Pick a nicer display scale.
    if (unit === 'g' && qty >= 1000) {
      return `${(price / (qty / 1000)).toFixed(2)}/kg`;
    }
    if (unit === 'ml' && qty >= 1000) {
      return `${(price / (qty / 1000)).toFixed(2)}/L`;
    }
    if (unit === 'oz' && qty >= 16) {
      return `${(price / (qty / 16)).toFixed(2)}/lb`;
    }
    if (per < 0.01) return `${(per * 100).toFixed(2)}¢/${unit}`;
    return `${per.toFixed(2)}/${unit}`;
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
    badge.title = 'AmazonEnhanced — price per unit';
    host.parentElement.appendChild(badge);
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
    badge.title = 'AmazonEnhanced — list price is ' + discountPct.toFixed(0) + '% higher; likely inflated';
    const host = strikeEl.parentElement && strikeEl.parentElement.parentElement;
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
    panel.innerHTML = `
      <h3>
        <span>AmazonEnhanced review analysis</span>
        <span class="amze-badge ${cls === 'amze-score-good' ? 'amze-badge-review-good' : cls === 'amze-score-mixed' ? 'amze-badge-review-mixed' : 'amze-badge-review-bad'}">${bucket}</span>
      </h3>
      <div class="amze-score ${cls}">${adjusted.toFixed(1)} <span style="font-size:13px;color:var(--amze-text-muted);font-weight:400;">adjusted / ${isFinite(shownRating) ? shownRating.toFixed(1) : '–'} shown</span></div>
      <div class="amze-metrics">
        <div class="amze-metric"><strong>${pct[0]}%</strong> 5★ &nbsp;·&nbsp; <strong>${pct[4]}%</strong> 1★</div>
        <div class="amze-metric">Polarization: <strong>${polarization}%</strong></div>
        <div class="amze-metric">Mid-ratings (2–4★): <strong>${middle}%</strong></div>
        <div class="amze-metric">Total reviews: <strong>${isFinite(totalNum) ? Math.round(totalNum).toLocaleString() : '–'}</strong></div>
        ${verifiedRatio !== null ? `<div class="amze-metric">Verified in sample: <strong>${Math.round(verifiedRatio * 100)}%</strong> (${verified}/${sampleSize})</div>` : ''}
        <div class="amze-metric" style="grid-column:1/-1;color:var(--amze-text-muted);font-size:11px;margin-top:4px;">
          Local heuristic only. Flags suspicious polarization, 1-star spikes, and MSRP inflation — but can't detect every paid-review pattern.
        </div>
      </div>
    `;

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

  function scanImagesForSmart() {
    if (settings.imageMode !== 'smart') return;
    // Add crossorigin hint BEFORE the image loads to maximize canvas readability.
    const imgs = document.querySelectorAll(IMAGE_SELECTORS);
    imgs.forEach(img => {
      if (img.complete && img.naturalWidth > 0) {
        processImageForSmartInvert(img);
      } else {
        img.addEventListener('load', () => processImageForSmartInvert(img), { once: true });
      }
    });
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
  //     Runs once per element via data-amze-kw-checked.
  // -------------------------------------------------------------------

  const KW_SELECTORS = [
    '.a-box', '.a-box-inner', '.a-section', '.a-cardui', '.a-cardui-body',
    '.a-container', '.a-row', '.a-popover', '.a-popover-inner',
    'div[role="main"]', '.a-padding-medium', '.a-padding-small',
    '.a-padding-large', '.a-fixed-left-grid', '.a-fixed-right-grid',
    '.a-fixed-right-grid-col', '.a-fixed-left-grid-col'
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
    let processed = 0;
    for (const el of nodes) {
      if (el.dataset.amzeKwChecked === '1') continue;
      el.dataset.amzeKwChecked = '1';
      // Skip tiny elements (icons, spacers).
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 20) continue;
      // Skip form controls & media.
      if (/^(INPUT|TEXTAREA|SELECT|BUTTON|IMG|SVG|VIDEO|IFRAME|CANVAS)$/i.test(el.tagName)) continue;
      let bg;
      try { bg = getComputedStyle(el).backgroundColor; } catch (e) { continue; }
      if (!bg) continue;
      // Normalize: ignore transparent/no-bg.
      if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue;
      // Quick match against known whites.
      const normalized = bg.replace(/\s+/g, '').toLowerCase();
      let white = false;
      if (normalized === 'rgb(255,255,255)' || normalized === 'rgba(255,255,255,1)') {
        white = true;
      } else {
        // Near-white threshold (Amazon uses #eaeded, #f7f7f7, etc. for some panels).
        const m = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (m) {
          const r = +m[1], g = +m[2], b = +m[3];
          if (r >= 230 && g >= 230 && b >= 230) white = true;
        }
      }
      if (white) {
        el.setAttribute('data-amze-kw', '1');
        processed++;
        if (processed > 400) break; // safety cap per sweep
      }
    }
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
    const anchors = scope.querySelectorAll('a[href*="amazon."]:not([data-amze-cleaned])');
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

  function scanTiles(root) {
    const scope = (root && root.querySelectorAll) ? root : document;
    const tiles = scope.querySelectorAll('.s-result-item, [data-component-type="s-search-result"], [data-component-type="sp-sponsored-result"]');
    tiles.forEach(processResultTile);
  }

  const schedule = debounce(() => {
    scanTiles(document);
    stripAffiliate(document);
    scoreReviews();
    scanImagesForSmart();
    killWhiteBackgrounds();
  }, 180);

  function startObserver() {
    const mo = new MutationObserver((muts) => {
      // Fast path: only re-scan when added nodes include candidate tiles.
      let hit = false;
      for (const mut of muts) {
        if (mut.addedNodes && mut.addedNodes.length) { hit = true; break; }
      }
      if (hit) schedule();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  // -------------------------------------------------------------------
  // 10. Messaging from popup
  // -------------------------------------------------------------------

  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'AMZE_SETTINGS_UPDATED') {
        settings = Object.assign({}, DEFAULT_SETTINGS, msg.settings);
        settings.flags = Object.assign({}, DEFAULT_SETTINGS.flags, msg.settings.flags || {});
        applyFlagAttributes();
        // Re-scan fresh tiles under new rules.
        document.querySelectorAll('[data-amze-processed]').forEach(el => delete el.dataset.amzeProcessed);
        document.querySelectorAll('.amze-hidden-by-brand').forEach(el => el.classList.remove('amze-hidden-by-brand'));
        // Reset image-smart markers so the new mode re-evaluates.
        document.querySelectorAll('[data-amze-img]').forEach(el => {
          delete el.dataset.amzeImg;
          el.removeAttribute('data-amze-invert');
        });
        // Reset white-bg sweep markers.
        document.querySelectorAll('[data-amze-kw-checked]').forEach(el => {
          delete el.dataset.amzeKwChecked;
          el.removeAttribute('data-amze-kw');
        });
        // Re-run v2.0 features under new flags.
        document.querySelectorAll('[data-amze-country="1"]').forEach(el => delete el.dataset.amzeCountry);
        document.documentElement.toggleAttribute('data-amze-large-text',   !!settings.flags.largeText);
        document.documentElement.toggleAttribute('data-amze-high-contrast', !!settings.flags.highContrast);
        schedule();
        try { runFeaturePack(); } catch (e) {}
        toast('AmazonEnhanced settings updated');
        sendResponse({ ok: true });
      } else if (msg.type === 'AMZE_GET_STATE') {
        sendResponse({ ok: true, locale: LOCALE_TLD });
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
      const key = 'amzeOrigins';
      const r = await new Promise(res => chrome.storage.local.get([key], res));
      const map = r[key] || {};
      map[asin] = { country, ts: Date.now() };
      await new Promise(res => chrome.storage.local.set({ [key]: map }, res));
    } catch (e) {}
  }
  async function readOriginCache() {
    try {
      const r = await new Promise(res => chrome.storage.local.get(['amzeOrigins'], res));
      return r.amzeOrigins || {};
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
        cacheOrigin(asin, origin);
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
    badge.innerHTML = `<strong>Country of Origin:</strong> ${country}`;
    title.parentElement.insertBefore(badge, title.nextSibling);
  }

  // -------------------------------------------------------------------
  // 12.7 Reveal seller (SoldBy-clone)
  // -------------------------------------------------------------------

  function revealSellerPdp() {
    if (!settings.flags.revealSeller) return;
    if (!isPdp()) return;
    if (document.getElementById('amze-seller-reveal')) return;
    const merchantEl = document.querySelector('#sellerProfileTriggerId, #merchant-info a');
    if (!merchantEl) return;
    const name = (merchantEl.textContent || '').trim();
    const href = merchantEl.href;
    const panel = document.createElement('div');
    panel.id = 'amze-seller-reveal';
    panel.className = 'amze-pdp-badge';
    panel.innerHTML = `
      <strong>Sold by:</strong> ${name}
      ${href ? `<a href="${href}" target="_blank" rel="noreferrer noopener" style="margin-left:8px;font-size:11px;">View seller page →</a>` : ''}
    `;
    const target = document.querySelector('#titleSection, #centerCol .a-row');
    if (target) target.parentElement.insertBefore(panel, target.nextSibling);
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
      warn.innerHTML = `⚠ <strong>Variation price spread:</strong> this listing groups ${prices.length} variants ranging <strong>${min.toFixed(2)}</strong> to <strong>${max.toFixed(2)}</strong> (${ratio.toFixed(1)}× spread). Reviews may apply to very different products.`;
      const target = document.querySelector('#titleSection') || document.querySelector('#centerCol');
      if (target) target.insertBefore(warn, target.firstChild);
    }
  }

  // -------------------------------------------------------------------
  // 12.9 Local price history sparkline
  // -------------------------------------------------------------------

  async function readPriceHistory() {
    try {
      const r = await new Promise(res => chrome.storage.local.get(['amzePriceHistory'], res));
      return r.amzePriceHistory || {};
    } catch (e) { return {}; }
  }
  async function writePriceHistory(map) {
    try { await new Promise(res => chrome.storage.local.set({ amzePriceHistory: map }, res)); } catch (e) {}
  }

  async function logAndRenderPrice() {
    if (!settings.flags.priceHistory) return;
    if (!isPdp()) return;
    const asin = getAsin();
    const priceEl = document.querySelector('#corePrice_feature_div .a-offscreen, #priceblock_ourprice, #priceblock_dealprice, .a-price .a-offscreen');
    const price = priceEl ? parseNumber(priceEl.textContent) : NaN;
    if (!asin || !isFinite(price)) return;
    const map = await readPriceHistory();
    map[asin] = map[asin] || [];
    const last = map[asin][map[asin].length - 1];
    if (!last || Math.abs(last.p - price) > 0.01 || (Date.now() - last.t) > 86400000) {
      map[asin].push({ p: price, t: Date.now() });
      // Cap to last 60 entries per ASIN
      if (map[asin].length > 60) map[asin] = map[asin].slice(-60);
      await writePriceHistory(map);
    }
    renderSparkline(asin, map[asin]);
  }

  function renderSparkline(asin, points) {
    if (document.getElementById('amze-sparkline')) return;
    if (!points || points.length < 2) return;
    const prices = points.map(p => p.p);
    const min = Math.min(...prices), max = Math.max(...prices);
    const range = max - min || 1;
    const w = 280, h = 48;
    const stepX = w / (points.length - 1);
    let d = '';
    points.forEach((pt, i) => {
      const x = i * stepX;
      const y = h - ((pt.p - min) / range) * (h - 6) - 3;
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
    });
    const current = prices[prices.length - 1];
    const panel = document.createElement('div');
    panel.id = 'amze-sparkline';
    panel.className = 'amze-pdp-badge';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div>
          <div style="font-size:11px;color:var(--amze-text-muted,#9399b2);">AmazonEnhanced — your price history (${points.length} pts)</div>
          <div style="font-size:12px;margin-top:2px;">Low <strong>$${min.toFixed(2)}</strong> · High <strong>$${max.toFixed(2)}</strong> · Now <strong>$${current.toFixed(2)}</strong></div>
        </div>
        <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="flex-shrink:0;">
          <path d="${d}" fill="none" stroke="var(--amze-accent,#89b4fa)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    `;
    const target = document.querySelector('#corePriceDisplay_desktop_feature_div, #price, #centerCol');
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
    wrap.innerHTML = `
      <div class="amze-export-title">Export orders</div>
      <button id="amze-order-export-btn" type="button" class="amze-action-btn">CSV</button>
      <button id="amze-order-export-json" type="button" class="amze-action-btn">JSON</button>
    `;
    host.parentElement.insertBefore(wrap, host);
    document.getElementById('amze-order-export-btn').addEventListener('click', () => exportOrders('csv'));
    document.getElementById('amze-order-export-json').addEventListener('click', () => exportOrders('json'));
  }

  function extractOrdersFromCurrentPage() {
    const out = [];
    const orders = document.querySelectorAll('.order-card, .order, .js-order-card');
    orders.forEach(card => {
      const orderId = (card.querySelector('[class*="order-id"], .a-col-right .a-size-mini .a-color-secondary')?.textContent || '').trim();
      const total = (card.querySelector('[class*="total"], .a-col-right .a-size-base')?.textContent || '').trim();
      const date = (card.querySelector('[class*="order-date"], .a-col-left .a-size-base')?.textContent || '').trim();
      const items = [];
      card.querySelectorAll('.yohtmlc-item, .a-fixed-left-grid').forEach(it => {
        const title = (it.querySelector('.a-link-normal, h3')?.textContent || '').trim();
        if (title) items.push(title);
      });
      if (orderId || total || items.length) {
        out.push({ orderId, date, total, items });
      }
    });
    return out;
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

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  }

  // -------------------------------------------------------------------
  // 12.12 Wishlist export
  // -------------------------------------------------------------------

  function injectWishlistExportButton() {
    if (!settings.flags.wishlistExport) return;
    if (!isWishlistPage()) return;
    if (document.getElementById('amze-wl-export-btn')) return;
    const host = document.querySelector('#profile-list-name, #wl-list-info, main, #left-nav');
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.className = 'amze-export-wrap';
    wrap.innerHTML = `
      <div class="amze-export-title">Export wishlist</div>
      <button id="amze-wl-export-btn" type="button" class="amze-action-btn">CSV</button>
      <button id="amze-wl-export-json" type="button" class="amze-action-btn">JSON</button>
      <button id="amze-wl-export-md" type="button" class="amze-action-btn">Markdown</button>
    `;
    host.parentElement.insertBefore(wrap, host);
    document.getElementById('amze-wl-export-btn').addEventListener('click', () => exportWishlist('csv'));
    document.getElementById('amze-wl-export-json').addEventListener('click', () => exportWishlist('json'));
    document.getElementById('amze-wl-export-md').addEventListener('click', () => exportWishlist('md'));
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
      try { chrome.runtime.sendMessage({ type: 'AMZE_SEED_ORDERS', orders }); } catch (e) {}
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
    warn.innerHTML = `⚠ <strong>Allergen match:</strong> ${hits.map(h => `<span style="background:var(--amze-bg-raise);padding:1px 6px;border-radius:3px;margin-right:4px;">${h}</span>`).join('')}`;
    const target = document.querySelector('#titleSection') || document.querySelector('#centerCol');
    if (target) target.insertBefore(warn, target.firstChild);
  }

  // -------------------------------------------------------------------
  // 12.X Driver — runs all v2.0 features on every scan cycle.
  // -------------------------------------------------------------------

  function runFeaturePack() {
    try { autoDeclineWarranty(); } catch (e) {}
    try { forceOneTimePurchase(); } catch (e) {}
    try { autoUncheckDarkPatterns(); } catch (e) {}
    try { injectExtraSortOptions(); } catch (e) {}
    try { injectCpuTamer(); } catch (e) {}
    try { annotateCountry(); } catch (e) {}
    try { revealSellerPdp(); } catch (e) {}
    try { detectVariationBait(); } catch (e) {}
    try { logAndRenderPrice(); } catch (e) {}
    try { injectCopyLinkButton(); } catch (e) {}
    try { injectOrderExportButton(); } catch (e) {}
    try { injectWishlistExportButton(); } catch (e) {}
    try { pushOrdersToWatcher(); } catch (e) {}
    try { applyAriaFixes(); } catch (e) {}
    try { scanAllergens(); } catch (e) {}
  }

  // Run the v2.0 feature pack on every DOM mutation batch, debounced
  // separately from the v1 scanner so runtime stays fast.
  const runFeaturePackDebounced = debounce(runFeaturePack, 200);
  const featurePackObserver = new MutationObserver(() => runFeaturePackDebounced());
  featurePackObserver.observe(document.documentElement, { childList: true, subtree: true });

  // -------------------------------------------------------------------
  // 11. Init
  // -------------------------------------------------------------------

  function init() {
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

  getSettings(init);

})();
