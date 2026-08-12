/**
 * Pure text classifiers for narrowly-scoped recommended-upgrade prompts.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AmzeUpgradeSkip = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isRecommendedUpgradePrompt(text) {
    const normalized = normalize(text).toLowerCase();
    return /\brecommended\b/.test(normalized) && /\bupgrade\b/.test(normalized);
  }

  function isSafeSkipAction(text) {
    const normalized = normalize(text).toLowerCase().replace(/[.!:]+$/, '');
    return /^(?:no\s*,?\s*thanks|skip(?:\s+(?:this\s+)?upgrade)?|continue\s+without\s+(?:the\s+)?upgrade|keep\s+(?:my\s+)?current(?:\s+plan)?|not\s+now|maybe\s+later|decline(?:\s+upgrade)?)$/.test(normalized);
  }

  return { isRecommendedUpgradePrompt, isSafeSkipAction };
});
