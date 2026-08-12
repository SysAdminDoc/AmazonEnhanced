/**
 * Small, side-effect-free helpers for selecting local price-history ranges.
 * Kept as a plain script so the MV3 extension remains build-tool free.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AmzePriceHistory = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const RANGE_DAYS = [90, 180, 365];
  const DAY_MS = 24 * 60 * 60 * 1000;

  function historySignature(points) {
    return (Array.isArray(points) ? points : [])
      .map(point => `${Number(point && point.t) || 0}:${Number(point && point.p) || 0}`)
      .join('|');
  }

  function filterPointsByDays(points, days, now = Date.now()) {
    if (!Array.isArray(points)) return [];
    const range = Number(days);
    const cutoff = now - (Number.isFinite(range) && range > 0 ? range : 365) * DAY_MS;
    return points
      .filter(point => point && Number.isFinite(Number(point.t)) && Number.isFinite(Number(point.p)) && Number(point.t) >= cutoff)
      .map(point => ({ p: Number(point.p), t: Number(point.t) }))
      .sort((a, b) => a.t - b.t);
  }

  return { DAY_MS, RANGE_DAYS, filterPointsByDays, historySignature };
});
