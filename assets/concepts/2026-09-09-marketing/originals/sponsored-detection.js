(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeSponsoredDetection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_LABELS = Object.freeze([
    'Sponsored', 'Ad', 'Gesponsert', 'Sponsorisé', 'Commandité',
    'Sponsorizzato', 'Patrocinado', 'Patrocinados', 'Gesponsord',
    'Sponsorowane', 'Sponsrad', 'Sponsorlu', 'スポンサー', 'प्रायोजित',
    'إعلان', 'برعاية'
  ]);

  function normalizeLabel(value) {
    return String(value || '')
      .normalize('NFKC')
      .trim()
      .replace(/\s+/gu, ' ')
      .toLocaleLowerCase();
  }

  function isSponsoredLabelText(value, labels = DEFAULT_LABELS) {
    const normalized = normalizeLabel(value);
    if (!normalized) return false;
    const allowed = Array.isArray(labels) && labels.length ? labels : DEFAULT_LABELS;
    return allowed.some(label => normalizeLabel(label) === normalized);
  }

  return { DEFAULT_LABELS, normalizeLabel, isSponsoredLabelText };
});
