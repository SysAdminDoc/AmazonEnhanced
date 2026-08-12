/**
 * Pure classifiers for Amazon's frequently-returned item disclosure.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AmzeReturnReasons = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  function isFrequentlyReturnedText(text) {
    const normalized = normalize(text).toLowerCase();
    return /frequently\s+returned/.test(normalized) || /returned\s+more\s+often/.test(normalized);
  }

  function isLikelyReturnReason(text) {
    const normalized = normalize(text).toLowerCase();
    if (!normalized || normalized.length < 4 || normalized.length > 180) return false;
    return /because|reason|fit|size|quality|damaged|broken|missing|different|described|packag|color|expect|condition|function|work/.test(normalized);
  }

  function extractReturnReasons(values) {
    const seen = new Set();
    const reasons = [];
    for (const value of Array.isArray(values) ? values : []) {
      const reason = normalize(value).replace(/^(?:top\s+)?reason\s*[:\-]\s*/i, '');
      if (!isLikelyReturnReason(reason)) continue;
      const key = reason.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      reasons.push(reason);
      if (reasons.length >= 5) break;
    }
    return reasons;
  }

  return { isFrequentlyReturnedText, isLikelyReturnReason, extractReturnReasons };
});
