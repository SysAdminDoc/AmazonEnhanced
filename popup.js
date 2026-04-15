/**
 * AmazonEnhanced — popup.js
 * Binds the settings form to chrome.storage.local and broadcasts changes
 * to all open Amazon tabs via the background service worker.
 */
(function () {
  'use strict';

  const DEFAULT_SETTINGS = {
    theme: 'dark',
    density: 'comfortable',
    imageMode: 'tile',
    flags: {
      hideSponsored: true, shadeSponsored: false, hideVideoAds: true, hidePrimeNag: true,
      hideBanners: true, hideAmazonBrands: false, hideCustomBrands: false, hideCN: false,
      reviewScore: true, pricePerUnit: true, listPriceWarn: true, stripAffiliate: true,
      hideBrandsRelated: true, hideInspired: true, hideAlsoBought: true, hideBuyAgain: false,
      hideClimate: false, hideEditorial: true, hideManufacturer: false, hideCompare: false,
      hideSubSave: true, hideCartUpsell: true, hideHomeClutter: true, hideFooter: false,
      hidePadding: true
    },
    customBrands: '',
    toastsEnabled: true
  };

  let current = structuredClone(DEFAULT_SETTINGS);

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function load() {
    chrome.storage.local.get(['amzeSettings'], (r) => {
      if (r.amzeSettings) {
        current = Object.assign({}, DEFAULT_SETTINGS, r.amzeSettings);
        current.flags = Object.assign({}, DEFAULT_SETTINGS.flags, r.amzeSettings.flags || {});
      }
      renderForm();
    });
  }

  function renderForm() {
    // Theme
    $$('input[name="amze-theme"]').forEach(r => {
      r.checked = r.value === current.theme;
    });
    // Density segmented
    $$('.amze-seg-btn[data-density]').forEach(b => {
      b.classList.toggle('amze-seg-active', b.dataset.density === current.density);
    });
    // Image mode segmented
    $$('.amze-seg-btn[data-image]').forEach(b => {
      b.classList.toggle('amze-seg-active', b.dataset.image === (current.imageMode || 'tile'));
    });
    // Flag switches
    $$('input[data-flag]').forEach(i => {
      i.checked = !!current.flags[i.dataset.flag];
    });
    // Meta switches (e.g., toastsEnabled)
    $$('input[data-meta]').forEach(i => {
      i.checked = !!current[i.dataset.meta];
    });
    // Custom brand textarea
    const ta = $('#amze-brands');
    if (ta) ta.value = current.customBrands || '';
  }

  function persistAndBroadcast() {
    chrome.storage.local.set({ amzeSettings: current }, () => {
      try {
        chrome.runtime.sendMessage({ type: 'AMZE_BROADCAST_SETTINGS', settings: current });
      } catch (e) {}
    });
  }

  function wireUp() {
    // Tabs
    $$('.amze-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.amze-tab').forEach(t => t.classList.remove('amze-tab-active'));
        $$('.amze-pane').forEach(p => p.classList.remove('amze-pane-active'));
        btn.classList.add('amze-tab-active');
        const pane = $(`.amze-pane[data-pane="${btn.dataset.tab}"]`);
        if (pane) pane.classList.add('amze-pane-active');
      });
    });

    // Flag checkboxes
    $$('input[data-flag]').forEach(i => {
      i.addEventListener('change', () => {
        current.flags[i.dataset.flag] = i.checked;
        persistAndBroadcast();
      });
    });

    // Meta checkboxes
    $$('input[data-meta]').forEach(i => {
      i.addEventListener('change', () => {
        current[i.dataset.meta] = i.checked;
        persistAndBroadcast();
      });
    });

    // Theme radios
    $$('input[name="amze-theme"]').forEach(r => {
      r.addEventListener('change', () => {
        if (r.checked) {
          current.theme = r.value;
          persistAndBroadcast();
        }
      });
    });

    // Density segmented
    $$('.amze-seg-btn[data-density]').forEach(b => {
      b.addEventListener('click', () => {
        current.density = b.dataset.density;
        $$('.amze-seg-btn[data-density]').forEach(x => x.classList.toggle('amze-seg-active', x === b));
        persistAndBroadcast();
      });
    });

    // Image-mode segmented
    $$('.amze-seg-btn[data-image]').forEach(b => {
      b.addEventListener('click', () => {
        current.imageMode = b.dataset.image;
        $$('.amze-seg-btn[data-image]').forEach(x => x.classList.toggle('amze-seg-active', x === b));
        persistAndBroadcast();
      });
    });

    // Custom brands textarea (debounced)
    const ta = $('#amze-brands');
    if (ta) {
      let t;
      ta.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          current.customBrands = ta.value;
          persistAndBroadcast();
        }, 350);
      });
    }

    // Reset
    const reset = $('#amze-reset');
    if (reset) {
      reset.addEventListener('click', () => {
        current = structuredClone(DEFAULT_SETTINGS);
        renderForm();
        persistAndBroadcast();
      });
    }

    // Version display
    const v = $('#amze-version');
    if (v && chrome.runtime && chrome.runtime.getManifest) {
      v.textContent = 'v' + chrome.runtime.getManifest().version;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireUp();
    load();
  });
})();
