/**
 * Pure helpers for comparing checkout shipping selections.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AmzeShippingDiff = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizeShippingText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  }

  function compareShippingSnapshots(previous, current) {
    if (!previous || !current) return [];
    const changes = [];
    const previousTier = normalizeShippingText(previous.tier);
    const currentTier = normalizeShippingText(current.tier);
    const previousSlot = normalizeShippingText(previous.slot);
    const currentSlot = normalizeShippingText(current.slot);
    if (previousTier && currentTier && previousTier !== currentTier) {
      changes.push({ field: 'shipping tier', before: previousTier, after: currentTier });
    }
    if (previousSlot && currentSlot && previousSlot !== currentSlot) {
      changes.push({ field: 'delivery slot', before: previousSlot, after: currentSlot });
    }
    return changes;
  }

  return { normalizeShippingText, compareShippingSnapshots };
});
