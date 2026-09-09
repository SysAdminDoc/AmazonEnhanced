(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzePurchaseSummary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_ENTRIES = 500;
  const MAX_ORDER_IDS = 120;

  function clean(value, maxLength = 180) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  function normalizeAsin(value) {
    const text = String(value || '').toUpperCase();
    const direct = text.match(/\b([A-Z0-9]{10})\b/);
    if (direct) return direct[1];
    const url = text.match(/(?:\/dp\/|\/gp\/product\/)([A-Z0-9]{10})/);
    return url ? url[1] : '';
  }

  function normalizeQuantity(value) {
    const quantity = Number(value);
    return Number.isFinite(quantity) && quantity > 0 ? Math.min(99, Math.floor(quantity)) : 1;
  }

  function normalizeOrder(order, index = 0) {
    const source = order && typeof order === 'object' ? order : {};
    const orderId = clean(source.orderId || source.id || `page-order-${index}`, 80);
    const items = [];
    (Array.isArray(source.items) ? source.items : []).forEach(item => {
      const value = typeof item === 'string' ? { title: item } : item;
      const asin = normalizeAsin(value && (value.asin || value.url || value.href));
      if (!asin) return;
      items.push({
        asin,
        title: clean(value && value.title),
        quantity: normalizeQuantity(value && value.quantity),
        subscription: !!(value && value.subscription)
      });
    });
    return { orderId, date: clean(source.date, 100), items };
  }

  function normalizeEntry(entry) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const asin = normalizeAsin(source.asin);
    if (!asin) return null;
    return {
      asin,
      title: clean(source.title),
      purchaseCount: normalizeQuantity(source.purchaseCount || 0) === 1 && Number(source.purchaseCount) === 0 ? 0 : Math.max(0, Math.floor(Number(source.purchaseCount) || 0)),
      subscriptionCount: Math.max(0, Math.floor(Number(source.subscriptionCount) || 0)),
      orderIds: Array.from(new Set((Array.isArray(source.orderIds) ? source.orderIds : []).map(id => clean(id, 80)).filter(Boolean))).slice(-MAX_ORDER_IDS),
      lastPurchasedAt: Number.isFinite(source.lastPurchasedAt) ? source.lastPurchasedAt : 0,
      updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : Date.now()
    };
  }

  function mergePurchaseSummary(existing, orders, now = Date.now()) {
    const byAsin = new Map();
    (Array.isArray(existing) ? existing : []).forEach(entry => {
      const normalized = normalizeEntry(entry);
      if (normalized) byAsin.set(normalized.asin, normalized);
    });
    (Array.isArray(orders) ? orders : []).map(normalizeOrder).forEach(order => {
      order.items.forEach(item => {
        let entry = byAsin.get(item.asin);
        if (!entry) {
          entry = {
            asin: item.asin,
            title: item.title,
            purchaseCount: 0,
            subscriptionCount: 0,
            orderIds: [],
            lastPurchasedAt: 0,
            updatedAt: now
          };
          byAsin.set(item.asin, entry);
        }
        const dedupeKey = `${order.orderId}:${item.asin}`;
        if (entry.orderIds.includes(dedupeKey)) return;
        entry.orderIds.push(dedupeKey);
        if (entry.orderIds.length > MAX_ORDER_IDS) entry.orderIds = entry.orderIds.slice(-MAX_ORDER_IDS);
        entry.purchaseCount += item.quantity;
        if (item.subscription) entry.subscriptionCount += item.quantity;
        if (item.title) entry.title = item.title;
        const parsedDate = Date.parse(order.date);
        entry.lastPurchasedAt = Math.max(entry.lastPurchasedAt, Number.isFinite(parsedDate) ? parsedDate : now);
        entry.updatedAt = now;
      });
    });
    return Array.from(byAsin.values())
      .sort((a, b) => b.purchaseCount - a.purchaseCount || b.updatedAt - a.updatedAt)
      .slice(0, MAX_ENTRIES);
  }

  function summarizeEntries(entries, minPurchases = 2) {
    return (Array.isArray(entries) ? entries : [])
      .map(normalizeEntry)
      .filter(entry => entry && entry.purchaseCount >= Math.max(2, Number(minPurchases) || 2))
      .sort((a, b) => b.purchaseCount - a.purchaseCount || b.updatedAt - a.updatedAt)
      .map(entry => Object.assign({}, entry, {
        suggestion: entry.subscriptionCount
          ? 'Review Subscribe & Save frequency or cancel if this is more than you need.'
          : 'Consider Subscribe & Save only if this repeat purchase is intentional.'
      }));
  }

  return {
    MAX_ENTRIES,
    MAX_ORDER_IDS,
    normalizeAsin,
    normalizeQuantity,
    normalizeOrder,
    normalizeEntry,
    mergePurchaseSummary,
    summarizeEntries
  };
});
