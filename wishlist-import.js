(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeWishlistImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_IMPORT_ITEMS = 500;
  const ASIN_RE = /^[A-Z0-9]{10}$/;

  function extractAsin(value) {
    const text = String(value || '').trim();
    if (ASIN_RE.test(text.toUpperCase())) return text.toUpperCase();
    const direct = text.match(/(?:\/dp\/|\/gp\/product\/|[?&](?:asin|ASIN)=)([A-Z0-9]{10})(?:[/?&#]|$)/i);
    if (direct) return direct[1].toUpperCase();
    try {
      const url = new URL(text);
      const pathMatch = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      if (pathMatch) return pathMatch[1].toUpperCase();
      const queryAsin = url.searchParams.get('asin');
      if (queryAsin && ASIN_RE.test(queryAsin.toUpperCase())) return queryAsin.toUpperCase();
    } catch (e) {}
    return '';
  }

  function normalizeText(value, limit) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function normalizeWishlistItem(raw) {
    if (typeof raw === 'string') {
      const asin = extractAsin(raw);
      return asin ? { asin, title: '', price: '', url: '' } : null;
    }
    if (!raw || typeof raw !== 'object') return null;
    const sourceUrl = raw.url || raw.link || raw.href || '';
    const asin = extractAsin(raw.asin || raw.ASIN || sourceUrl);
    if (!asin) return null;
    return {
      asin,
      title: normalizeText(raw.title || raw.name || raw.productTitle, 300),
      price: normalizeText(raw.price || raw.currentPrice, 80),
      url: normalizeText(sourceUrl, 500)
    };
  }

  function getRawItems(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    for (const key of ['items', 'entries', 'wishlist', 'products']) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    const mapped = Object.entries(payload);
    if (mapped.length && mapped.every(([, value]) => value && typeof value === 'object' && !Array.isArray(value))) {
      return mapped.map(([asin, value]) => Object.assign({ asin }, value));
    }
    return [];
  }

  function normalizeWishlistItems(payload, maxItems = MAX_IMPORT_ITEMS) {
    const seen = new Set();
    const items = [];
    for (const raw of getRawItems(payload)) {
      const item = normalizeWishlistItem(raw);
      if (!item || seen.has(item.asin)) continue;
      seen.add(item.asin);
      items.push(item);
    }
    if (!items.length) throw new Error('No valid wishlist items found');
    if (items.length > maxItems) throw new Error(`Wishlist import is limited to ${maxItems} items`);
    return items;
  }

  function parseWishlistImport(text, maxItems = MAX_IMPORT_ITEMS) {
    let payload;
    try {
      payload = JSON.parse(String(text || ''));
    } catch (e) {
      throw new Error('Wishlist JSON is not valid');
    }
    return normalizeWishlistItems(payload, maxItems);
  }

  function buildProductUrl(host, asin) {
    const key = extractAsin(asin);
    const cleanHost = String(host || '').trim().replace(/^https?:\/\//i, '').split('/')[0];
    if (!key || !cleanHost) return '';
    return `https://${cleanHost}/dp/${key}`;
  }

  return {
    MAX_IMPORT_ITEMS,
    extractAsin,
    normalizeWishlistItem,
    normalizeWishlistItems,
    parseWishlistImport,
    buildProductUrl
  };
});
