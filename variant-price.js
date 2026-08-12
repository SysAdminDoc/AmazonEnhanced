/**
 * Pure helpers for the PDP cross-variant local price map.
 * Kept as a plain script so the MV3 extension remains build-tool free.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AmzeVariantPrice = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ASIN_RE = /^[A-Z0-9]{10}$/;

  function extractAsin(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (ASIN_RE.test(text.toUpperCase())) return text.toUpperCase();
    const urlMatch = text.match(/(?:\/dp\/|\/gp\/product\/)([A-Z0-9]{10})(?:\b|[/?#])/i);
    if (urlMatch) return urlMatch[1].toUpperCase();
    const asinMatch = text.match(/(?:amzn1\.asin[./:_-]*|\basin[=:/\s]+)([A-Z0-9]{10})\b/i);
    return asinMatch ? asinMatch[1].toUpperCase() : '';
  }

  function normalizeLabel(value, fallback = 'Variant') {
    const label = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    return label || fallback;
  }

  function mergeVariantRecords(records) {
    const byAsin = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      const asin = extractAsin(record && record.asin);
      if (!asin) continue;
      const label = normalizeLabel(record && record.label);
      const existing = byAsin.get(asin);
      if (!existing) {
        byAsin.set(asin, { asin, label });
      } else if (existing.label !== label && !existing.label.includes(label)) {
        existing.label = normalizeLabel(existing.label + ' / ' + label);
      }
    }
    return Array.from(byAsin.values());
  }

  function lowestLocalPrice(points) {
    const prices = (Array.isArray(points) ? points : [])
      .map(point => Number(point && point.p))
      .filter(price => Number.isFinite(price) && price > 0);
    return prices.length ? Math.min(...prices) : NaN;
  }

  function buildPriceIndex(entries) {
    const index = {};
    for (const entry of Array.isArray(entries) ? entries : []) {
      const asin = extractAsin(entry && entry.asin);
      const low = lowestLocalPrice(entry && entry.points);
      if (asin && Number.isFinite(low)) index[asin] = low;
    }
    return index;
  }

  function decorateVariants(variants, entries, currentAsin, currentPrice) {
    const index = buildPriceIndex(entries);
    const activeAsin = extractAsin(currentAsin);
    const activePrice = Number(currentPrice);
    return mergeVariantRecords(variants).map(variant => {
      let lowestPrice = index[variant.asin];
      let source = 'history';
      if (!Number.isFinite(lowestPrice) && variant.asin === activeAsin && Number.isFinite(activePrice) && activePrice > 0) {
        lowestPrice = activePrice;
        source = 'current';
      }
      return Object.assign({}, variant, {
        lowestPrice: Number.isFinite(lowestPrice) ? lowestPrice : NaN,
        source
      });
    });
  }

  return { extractAsin, normalizeLabel, mergeVariantRecords, lowestLocalPrice, buildPriceIndex, decorateVariants };
});
