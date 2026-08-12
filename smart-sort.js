(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeSmartSort = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FIELDS = ['rating', 'reviewCount', 'price', 'unitPrice', 'trustScore'];
  const LOWER_IS_BETTER = new Set(['price', 'unitPrice']);
  const DEFAULT_WEIGHTS = Object.freeze({
    rating: 30,
    reviewCount: 20,
    price: 15,
    unitPrice: 20,
    trustScore: 15
  });

  function clampWeight(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
  }

  function normalizeWeights(weights) {
    const source = weights && typeof weights === 'object' ? weights : {};
    return FIELDS.reduce((result, field) => {
      result[field] = clampWeight(source[field]);
      return result;
    }, {});
  }

  function metricValue(field, value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return field === 'reviewCount' ? Math.log1p(Math.max(0, number)) : number;
  }

  function normalizedMetrics(items) {
    const values = Object.fromEntries(FIELDS.map(field => [field, []]));
    (Array.isArray(items) ? items : []).forEach(item => {
      FIELDS.forEach(field => {
        const value = metricValue(field, item && item[field]);
        if (value !== null) values[field].push(value);
      });
    });
    const ranges = Object.fromEntries(FIELDS.map(field => {
      const source = values[field];
      if (!source.length) return [field, null];
      const min = Math.min(...source);
      const max = Math.max(...source);
      return [field, { min, max }];
    }));
    return (Array.isArray(items) ? items : []).map(item => {
      const result = {};
      FIELDS.forEach(field => {
        const value = metricValue(field, item && item[field]);
        const range = ranges[field];
        if (value === null || !range) {
          result[field] = null;
          return;
        }
        const span = range.max - range.min;
        const normalized = span > 0 ? (value - range.min) / span : 0.5;
        result[field] = LOWER_IS_BETTER.has(field) ? 1 - normalized : normalized;
      });
      return result;
    });
  }

  function rankItems(items, weights) {
    const source = Array.isArray(items) ? items : [];
    const normalized = normalizeWeights(weights);
    const metricRows = normalizedMetrics(source);
    return source.map((item, index) => {
      let weighted = 0;
      let totalWeight = 0;
      FIELDS.forEach(field => {
        const value = metricRows[index][field];
        const weight = normalized[field];
        if (value === null || weight <= 0) return;
        weighted += value * weight;
        totalWeight += weight;
      });
      return Object.assign({}, item, {
        score: totalWeight ? weighted / totalWeight : 0,
        originalIndex: index
      });
    }).sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);
  }

  return { FIELDS, DEFAULT_WEIGHTS, normalizeWeights, normalizedMetrics, rankItems };
});
