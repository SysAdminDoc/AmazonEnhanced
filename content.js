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
      hidePadding:        true
    },
    customBrands: '',            // newline-separated regex patterns
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
    '.s-image',
    '#landingImage',
    '#imgTagWrapperId img',
    '.imgTagWrapper img',
    '#altImages img',
    '.a-dynamic-image',
    '.item-view-left-col-inner img',
    '.sc-product-image'
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
        schedule();
        toast('AmazonEnhanced settings updated');
        sendResponse({ ok: true });
      } else if (msg.type === 'AMZE_GET_STATE') {
        sendResponse({ ok: true, locale: LOCALE_TLD });
      }
      return true;
    });
  } catch (e) {}

  // -------------------------------------------------------------------
  // 11. Init
  // -------------------------------------------------------------------

  function init() {
    applyFlagAttributes();
    schedule();
    startObserver();
    // Mark ready so anti-FOUC releases (body opacity 1)
    document.documentElement.setAttribute('data-amze-ready', '1');
  }

  getSettings(init);

})();
