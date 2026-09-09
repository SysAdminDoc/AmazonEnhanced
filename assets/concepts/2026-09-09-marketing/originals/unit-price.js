/**
 * Shared price-per-unit parsing used by the content script and Node tests.
 * Kept as a plain script so the MV3 extension does not need a build step.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AmzeUnitPrice = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
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
    { re: /\b([\d.,]+)\s*(qt|quart|quarts)\b/i, unit: 'floz', factor: 32 },
    { re: /\b([\d.,]+)\s*(pt|pint|pints)\b/i, unit: 'floz', factor: 16 },
    { re: /\b([\d.,]+)\s*(cup|cups)\b/i, unit: 'floz', factor: 8 },
    // Count
    { re: /\bpack\s*of\s*([\d.,]+)\b/i, unit: 'ct' },
    { re: /\b([\d.,]+)\s*(dozen)\b/i, unit: 'ct', factor: 12 },
    { re: /\b([\d.,]+)\s*(count|ct|pcs|pieces|capsules|tablets|rolls|sheets|pods|bags|bars|cans|bottles|tissues|pairs|packs|cartons|jars|loaves|pouches|trays|sticks|slices)\b/i, unit: 'ct' },
    { re: /\b([\d.,]+)\s*[-x]\s*pack\b/i, unit: 'ct' },
    { re: /\bdozen\b/i, unit: 'ct', amount: 12 },
    // Length
    { re: /\b([\d.,]+)\s*(ft|foot|feet)\b/i, unit: 'ft' },
    { re: /\b([\d.,]+)\s*(m|meter|meters|metre|metres)\b/i, unit: 'ft', factor: 3.28084 }
  ];

  function parseNumber(str) {
    if (!str) return NaN;
    const cleaned = String(str).replace(/[^\d.,-]/g, '');
    if (!cleaned) return NaN;
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    let normalized;
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
    const n = parseFloat(normalized);
    return isNaN(n) ? NaN : n;
  }

  function extractQuantity(text) {
    if (!text) return null;
    for (const spec of UNIT_MAP) {
      const match = String(text).match(spec.re);
      if (!match) continue;
      const raw = spec.amount !== undefined ? spec.amount : parseNumber(match[1]);
      if (isNaN(raw)) continue;
      return { qty: raw * (spec.factor || 1), unit: spec.unit };
    }
    return null;
  }

  function formatUnitPrice(price, qty, unit) {
    if (!isFinite(price) || !isFinite(qty) || qty <= 0) return '';
    const per = price / qty;
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

  return { extractQuantity, formatUnitPrice, parseNumber };
});
