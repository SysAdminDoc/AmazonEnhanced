/**
 * Pure text classifiers for Prime free-trial controls.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AmzePrimeTrial = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isPrimeTrialText(text) {
    const normalized = normalize(text);
    return /\bprime\b/.test(normalized) &&
      (/\btrial\b/.test(normalized) || /\b30\s*[- ]?\s*day/.test(normalized) || /free(?:\s+for)?\s+(?:one\s+)?(?:month|period)/.test(normalized));
  }

  function isPrimeTrialDeclineText(text) {
    return /^(?:no\s*,?\s*thanks|continue\s+without\s+(?:prime|the\s+trial)|skip(?:\s+(?:the\s+)?trial)?|not\s+now|maybe\s+later|decline|do\s+not\s+(?:start|join|try)|no\s+prime(?:\s+trial)?)\.?$/.test(normalize(text));
  }

  return { isPrimeTrialText, isPrimeTrialDeclineText };
});
