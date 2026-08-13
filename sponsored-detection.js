(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeSponsoredDetection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SPONSORED_LABEL_RE = /^(?:sponsored|ad|gesponsert|sponsorisé|sponsorizzato|patrocinado|スポンサー|प्रायोजित)\s*$/iu;

  function isSponsoredLabelText(value) {
    return SPONSORED_LABEL_RE.test(String(value || '').trim());
  }

  return { isSponsoredLabelText };
});
