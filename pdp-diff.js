(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzePdpDiff = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_SNAPSHOTS = 200;
  const MAX_TEXT_LENGTH = 180;
  const FIELDS = [
    ['title', 'Title'],
    ['price', 'Price'],
    ['unitPrice', 'Unit price'],
    ['brand', 'Brand'],
    ['seller', 'Seller'],
    ['availability', 'Availability'],
    ['shipping', 'Shipping'],
    ['variant', 'Variant']
  ];

  function clean(value, maxLength = MAX_TEXT_LENGTH) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  function normalizeAsin(value) {
    const match = String(value || '').toUpperCase().match(/\b([A-Z0-9]{10})\b/);
    return match ? match[1] : '';
  }

  function normalizeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
  }

  function normalizeSnapshot(snapshot, now = Date.now()) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const asin = normalizeAsin(source.asin);
    if (!asin) return null;
    return {
      asin,
      title: clean(source.title, 220),
      brand: clean(source.brand, 100),
      price: normalizeNumber(source.price),
      unitPrice: normalizeNumber(source.unitPrice),
      seller: clean(source.seller, 140),
      availability: clean(source.availability, 120),
      shipping: clean(source.shipping, 180),
      variant: clean(source.variant, 120),
      updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : now
    };
  }

  function titleTokens(value) {
    return new Set(clean(value, 240).toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(token => token.length >= 3 && !/^(with|from|the|and|for|pack|new|amazon)$/.test(token)));
  }

  function similarity(a, b) {
    const left = titleTokens(a);
    const right = titleTokens(b);
    if (!left.size || !right.size) return 0;
    let overlap = 0;
    left.forEach(token => { if (right.has(token)) overlap++; });
    return overlap / Math.min(left.size, right.size);
  }

  function isLikelyDuplicate(current, candidate) {
    const left = normalizeSnapshot(current);
    const right = normalizeSnapshot(candidate);
    if (!left || !right || left.asin === right.asin) return false;
    const titleScore = similarity(left.title, right.title);
    if (titleScore < 0.65) return false;
    if (left.brand && right.brand && left.brand.toLowerCase() !== right.brand.toLowerCase()) return false;
    return true;
  }

  function findDuplicateCandidates(current, snapshots, max = 5) {
    const normalized = normalizeSnapshot(current);
    if (!normalized) return [];
    return (Array.isArray(snapshots) ? snapshots : [])
      .map(snapshot => normalizeSnapshot(snapshot))
      .filter(snapshot => snapshot && isLikelyDuplicate(normalized, snapshot))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, Math.min(10, Number(max) || 5)));
  }

  function displayValue(snapshot, field) {
    const value = snapshot && snapshot[field];
    if (value === null || value === undefined || value === '') return 'Not recorded';
    if (field === 'price' || field === 'unitPrice') return `$${Number(value).toFixed(2)}`;
    return String(value);
  }

  function diffSnapshots(left, right) {
    const a = normalizeSnapshot(left);
    const b = normalizeSnapshot(right);
    if (!a || !b) return [];
    return FIELDS.map(([field, label]) => ({
      field,
      label,
      left: displayValue(a, field),
      right: displayValue(b, field),
      changed: displayValue(a, field) !== displayValue(b, field)
    }));
  }

  return {
    MAX_SNAPSHOTS,
    FIELDS,
    normalizeAsin,
    normalizeSnapshot,
    similarity,
    isLikelyDuplicate,
    findDuplicateCandidates,
    displayValue,
    diffSnapshots
  };
});
