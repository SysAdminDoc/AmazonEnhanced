/**
 * Import/export helpers for local price history.
 * The format is intentionally plain JSON so it can move between installs.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AmzePriceHistoryIO = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const FORMAT = 'AmazonEnhanced price history';
  const VERSION = 1;
  const MAX_POINTS_PER_ASIN = 60;
  const ASIN_RE = /^[A-Z0-9]{10}$/;

  function extractAsin(value) {
    const text = String(value || '').trim();
    if (ASIN_RE.test(text.toUpperCase())) return text.toUpperCase();
    const match = text.match(/(?:\/dp\/|\/gp\/product\/|amzn1\.asin[./:_-]*)([A-Z0-9]{10})\b/i);
    return match ? match[1].toUpperCase() : '';
  }

  function normalizeTimestamp(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function normalizePrice(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = parseFloat(String(value || '').replace(/[^\d.,-]/g, '').replace(/,(?=\d{2}$)/, '.').replace(/,/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function rawEntries(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.entries)) return payload.entries;
    if (payload && Array.isArray(payload.history)) return payload.history;
    if (!payload || typeof payload !== 'object') return [];
    return Object.entries(payload).map(([asin, points]) => ({ asin, points }));
  }

  function normalizeHistoryEntries(payload, maxPoints = Infinity) {
    const byAsin = new Map();
    for (const raw of rawEntries(payload)) {
      const asin = extractAsin(raw && (raw.asin || raw.id || raw.key));
      const points = Array.isArray(raw) ? raw : raw && (raw.points || raw.history || raw.values);
      if (!asin || !Array.isArray(points)) continue;
      const existing = byAsin.get(asin) || new Map();
      for (const point of points) {
        const p = normalizePrice(point && (point.p ?? point.price ?? point.value));
        const t = normalizeTimestamp(point && (point.t ?? point.timestamp ?? point.date));
        if (!p || !t) continue;
        existing.set(`${t}:${p}`, { p, t });
      }
      byAsin.set(asin, existing);
    }

    return Array.from(byAsin.entries()).map(([asin, pointMap]) => {
      let points = Array.from(pointMap.values()).sort((a, b) => a.t - b.t);
      if (Number.isFinite(maxPoints)) points = points.slice(-maxPoints);
      return { asin, points };
    }).filter(entry => entry.points.length);
  }

  function mergeHistoryEntries(existing, imported) {
    return normalizeHistoryEntries([
      ...normalizeHistoryEntries(existing),
      ...normalizeHistoryEntries(imported)
    ], MAX_POINTS_PER_ASIN);
  }

  function serializePriceHistory(entries, exportedAt = Date.now()) {
    return JSON.stringify({
      format: FORMAT,
      version: VERSION,
      exportedAt,
      entries: normalizeHistoryEntries(entries)
    }, null, 2);
  }

  function parsePriceHistoryImport(text) {
    let payload;
    try {
      payload = JSON.parse(String(text || ''));
    } catch (error) {
      throw new Error('The selected file is not valid JSON.');
    }
    const entries = normalizeHistoryEntries(payload);
    if (!entries.length) throw new Error('The selected JSON contains no usable price history.');
    return { entries, version: Number(payload && payload.version) || 0 };
  }

  return {
    FORMAT,
    VERSION,
    MAX_POINTS_PER_ASIN,
    normalizeHistoryEntries,
    mergeHistoryEntries,
    serializePriceHistory,
    parsePriceHistoryImport
  };
});
