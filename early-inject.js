/**
 * AmazonEnhanced — early-inject.js
 * Runs at document_start. Sets theme attribute before paint to prevent FOUC.
 * Reads settings synchronously from chrome.storage.local; applies data-amze-theme
 * attribute on <html> so theme.css variables activate immediately.
 */
(function () {
  'use strict';

  // Apply placeholder until storage responds (default = dark)
  try {
    document.documentElement.setAttribute('data-amze-theme', 'dark');
    document.documentElement.setAttribute('data-amze-ready', '0');
  } catch (e) {}

  const APPLY_TIMEOUT_MS = 300;
  let applied = false;

  function apply(settings) {
    if (applied) return;
    applied = true;
    const theme = (settings && settings.theme) || 'dark';
    const density = (settings && settings.density) || 'comfortable';
    const imageMode = (settings && settings.imageMode) || 'tile';
    const html = document.documentElement;
    html.setAttribute('data-amze-theme', theme);
    html.setAttribute('data-amze-density', density);
    html.setAttribute('data-amze-image-mode', imageMode);

    // Cluster feature flags into body-level attributes so theme.css can branch.
    const flags = (settings && settings.flags) || {};
    for (const key of Object.keys(flags)) {
      if (flags[key]) html.setAttribute('data-amze-' + key, '1');
    }
    if (flags.largeText)    html.setAttribute('data-amze-large-text', '');
    if (flags.highContrast) html.setAttribute('data-amze-high-contrast', '');
    html.setAttribute('data-amze-ready', '1');
  }

  try {
    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['amzeSettings'], (r) => {
        apply(r && r.amzeSettings);
      });
    }
  } catch (e) {
    // Extension context not available; fall back to default.
  }

  // Safety net: if storage never responds, mark ready with defaults.
  setTimeout(() => apply(null), APPLY_TIMEOUT_MS);
})();
