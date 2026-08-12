(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeFeatureModules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MODULES = [
    { flag: 'pricePerUnit', files: ['unit-price.js'] },
    { flag: 'priceHistory', files: ['price-history.js', 'price-history-io.js'] },
    { flag: 'dealBadgeNormalizer', files: ['price-history.js'] },
    { flag: 'variantPriceMap', files: ['variant-price.js'] },
    { flag: 'skipRecommendedUpgrade', files: ['upgrade-skip.js'] },
    { flag: 'disablePrimeTrial', files: ['prime-trial.js'] },
    { flag: 'warnShippingChange', files: ['shipping-diff.js'] },
    { flag: 'frequentlyReturnedWarn', files: ['return-reasons.js'] },
    { flag: 'wishlistImport', files: ['wishlist-import.js'] },
    { flag: 'orderExport', files: ['invoice-export.js', 'zip-store.js', 'receipt-markdown.js'] }
  ];

  const ALLOWED_FILES = new Set(MODULES.flatMap(module => module.files));

  function getFiles(flags) {
    const enabled = flags && typeof flags === 'object' ? flags : {};
    const files = [];
    for (const module of MODULES) {
      if (!enabled[module.flag]) continue;
      for (const file of module.files) if (!files.includes(file)) files.push(file);
    }
    return files;
  }

  function filterAllowedFiles(files) {
    return Array.from(new Set(files || [])).filter(file => ALLOWED_FILES.has(file));
  }

  return { getFiles, filterAllowedFiles, allowedFiles: Array.from(ALLOWED_FILES) };
});
