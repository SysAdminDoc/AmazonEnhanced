/**
 * AmazonEnhanced — popup.js
 * Binds the settings form to chrome.storage.local and broadcasts changes
 * to all open Amazon tabs via the background service worker.
 */
(function () {
  'use strict';

  let DEFAULT_SETTINGS = null;
  let current = null;
  let clearConfirmTimer = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  async function loadDefaultSettings() {
    const res = await fetch(chrome.runtime.getURL('defaults.json'));
    if (!res.ok) throw new Error('Failed to load defaults.json');
    return res.json();
  }

  function cloneDefaultSettings() {
    return structuredClone(DEFAULT_SETTINGS);
  }

  function mergeSettings(saved) {
    const merged = Object.assign(cloneDefaultSettings(), saved || {});
    merged.flags = Object.assign({}, DEFAULT_SETTINGS.flags, (saved && saved.flags) || {});
    return merged;
  }

  function load() {
    chrome.storage.local.get(['amzeSettings'], (r) => {
      current = mergeSettings(r && r.amzeSettings);
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
    const al = $('#amze-allergens');
    if (al) al.value = current.allergens || '';
  }

  function persistAndBroadcast() {
    chrome.storage.local.set({ amzeSettings: current }, () => {
      try {
        chrome.runtime.sendMessage({ type: 'AMZE_BROADCAST_SETTINGS', settings: current });
      } catch (e) {}
    });
  }

  function clearDataCaches() {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type: 'AMZE_CLEAR_LOCAL_DATA' }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false });
          } else {
            resolve(response || { ok: false });
          }
        });
      } catch (e) {
        resolve({ ok: false });
      }
    });
  }

  function resetClearDataButton(btn, status) {
    delete btn.dataset.confirming;
    btn.disabled = false;
    btn.textContent = 'Clear local data';
    if (status && !status.textContent) status.textContent = '';
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
    // Allergens textarea (debounced)
    const al = $('#amze-allergens');
    if (al) {
      let t;
      al.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          current.allergens = al.value;
          persistAndBroadcast();
        }, 350);
      });
    }

    // Reset
    const reset = $('#amze-reset');
    if (reset) {
      reset.addEventListener('click', () => {
        current = cloneDefaultSettings();
        renderForm();
        persistAndBroadcast();
      });
    }

    const clearData = $('#amze-clear-data');
    const clearStatus = $('#amze-clear-status');
    if (clearData) {
      clearData.addEventListener('click', async () => {
        if (clearData.dataset.confirming !== '1') {
          clearData.dataset.confirming = '1';
          clearData.textContent = 'Click again to clear';
          if (clearStatus) clearStatus.textContent = 'Clears local price, origin, and watched-order caches. Settings stay unchanged.';
          clearTimeout(clearConfirmTimer);
          clearConfirmTimer = setTimeout(() => resetClearDataButton(clearData, clearStatus), 5000);
          return;
        }

        clearTimeout(clearConfirmTimer);
        clearData.disabled = true;
        if (clearStatus) clearStatus.textContent = 'Clearing local data...';
        const result = await clearDataCaches();
        delete clearData.dataset.confirming;
        clearData.disabled = false;
        clearData.textContent = 'Clear local data';
        if (clearStatus) {
          clearStatus.textContent = result.ok
            ? 'Local data cleared. Settings were kept.'
            : 'Could not clear local data. Reload the popup and try again.';
        }
      });
    }

    // Version display
    const v = $('#amze-version');
    if (v && chrome.runtime && chrome.runtime.getManifest) {
      v.textContent = 'v' + chrome.runtime.getManifest().version;
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      DEFAULT_SETTINGS = await loadDefaultSettings();
      current = cloneDefaultSettings();
      wireUp();
      load();
    } catch (e) {
      document.body.dataset.amzeDefaultsError = '1';
    }
  });
})();
