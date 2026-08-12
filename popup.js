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
  const PRICE_HISTORY_IO = globalThis.AmzePriceHistoryIO || {};
  const ERROR_REPORTER = globalThis.AmzeErrorBuffer && globalThis.AmzeErrorBuffer.createReporter
    ? globalThis.AmzeErrorBuffer.createReporter(chrome.storage.local, { source: 'popup' })
    : null;
  if (ERROR_REPORTER && globalThis.AmzeErrorBuffer.attachGlobalListeners) {
    globalThis.AmzeErrorBuffer.attachGlobalListeners(globalThis, ERROR_REPORTER, 'popup');
  }

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

  function syncSwitchAria(input) {
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-checked', String(!!input.checked));
  }

  function activateTab(btn, moveFocus) {
    $$('.amze-tab').forEach(t => {
      const active = t === btn;
      t.classList.toggle('amze-tab-active', active);
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;
    });

    $$('.amze-pane').forEach(p => {
      const active = p.dataset.pane === btn.dataset.tab;
      p.classList.toggle('amze-pane-active', active);
      if (active) {
        p.removeAttribute('hidden');
        if (moveFocus) p.focus({ preventScroll: true });
      } else {
        p.setAttribute('hidden', '');
      }
    });
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
      syncSwitchAria(i);
    });
    // Meta switches (e.g., toastsEnabled)
    $$('input[data-meta]').forEach(i => {
      i.checked = !!current[i.dataset.meta];
      syncSwitchAria(i);
    });
    // Custom brand textarea
    const ta = $('#amze-brands');
    if (ta) ta.value = current.customBrands || '';
    const al = $('#amze-allergens');
    if (al) al.value = current.allergens || '';
    const token = $('#amze-oc-token');
    if (token) token.value = current.openCorporatesToken || '';
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

  function mergeImportedPriceHistory(entries) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type: 'AMZE_IDB_MERGE_PRICE_HISTORY', entries }, response => {
          if (chrome.runtime.lastError) resolve({ ok: false, imported: 0 });
          else resolve(response || { ok: false, imported: 0 });
        });
      } catch (e) {
        resolve({ ok: false, imported: 0 });
      }
    });
  }

  function requestErrorReport() {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type: 'AMZE_GET_ERROR_REPORT' }, response => {
          if (chrome.runtime.lastError) resolve({ ok: false, report: null });
          else resolve(response || { ok: false, report: null });
        });
      } catch (e) {
        resolve({ ok: false, report: null });
      }
    });
  }

  function clearErrorBuffer() {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type: 'AMZE_CLEAR_ERROR_BUFFER' }, response => {
          if (chrome.runtime.lastError) resolve({ ok: false });
          else resolve(response || { ok: false });
        });
      } catch (e) {
        resolve({ ok: false });
      }
    });
  }

  function downloadJson(value, filename) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        activateTab(btn, true);
      });
    });
    const activeTab = $('.amze-tab-active') || $('.amze-tab');
    if (activeTab) activateTab(activeTab, false);

    // Flag checkboxes
    $$('input[data-flag]').forEach(i => {
      syncSwitchAria(i);
      i.addEventListener('change', () => {
        current.flags[i.dataset.flag] = i.checked;
        syncSwitchAria(i);
        persistAndBroadcast();
      });
    });

    // Meta checkboxes
    $$('input[data-meta]').forEach(i => {
      syncSwitchAria(i);
      i.addEventListener('change', () => {
        current[i.dataset.meta] = i.checked;
        syncSwitchAria(i);
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
    const ocToken = $('#amze-oc-token');
    if (ocToken) {
      let t;
      ocToken.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          current.openCorporatesToken = ocToken.value.trim();
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
          if (clearStatus) clearStatus.textContent = 'Clears local price, seller/origin, watched-order, and error caches. Settings stay unchanged.';
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

    const importButton = $('#amze-import-price-history');
    const importFile = $('#amze-price-history-import-file');
    const importStatus = $('#amze-import-status');
    if (importButton && importFile) {
      importButton.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', async () => {
        const file = importFile.files && importFile.files[0];
        if (!file) return;
        importButton.disabled = true;
        if (importStatus) importStatus.textContent = 'Reading price history...';
        try {
          const parsed = typeof PRICE_HISTORY_IO.parsePriceHistoryImport === 'function'
            ? PRICE_HISTORY_IO.parsePriceHistoryImport(await file.text())
            : null;
          if (!parsed || !parsed.entries.length) throw new Error('No usable price history found.');
          const result = await mergeImportedPriceHistory(parsed.entries);
          if (!result.ok) throw new Error('The extension could not save the imported history.');
          if (importStatus) importStatus.textContent = `Imported history for ${result.imported} ASIN${result.imported === 1 ? '' : 's'}.`;
        } catch (error) {
          if (importStatus) importStatus.textContent = error.message || 'Could not import price history.';
        } finally {
          importButton.disabled = false;
          importFile.value = '';
        }
      });
    }

    const exportErrors = $('#amze-export-errors');
    const clearErrors = $('#amze-clear-errors');
    const errorStatus = $('#amze-error-status');
    if (exportErrors) {
      exportErrors.addEventListener('click', async () => {
        exportErrors.disabled = true;
        if (errorStatus) errorStatus.textContent = 'Collecting the local error buffer...';
        const result = await requestErrorReport();
        exportErrors.disabled = false;
        if (!result.ok || !result.report) {
          if (errorStatus) errorStatus.textContent = 'Could not collect the error report. Reload the popup and try again.';
          return;
        }
        downloadJson(result.report, `amazonenhanced-error-report-${Date.now()}.json`);
        if (errorStatus) errorStatus.textContent = `Downloaded ${result.report.entries.length} recorded error${result.report.entries.length === 1 ? '' : 's'}.`;
      });
    }
    if (clearErrors) {
      clearErrors.addEventListener('click', async () => {
        clearErrors.disabled = true;
        const result = await clearErrorBuffer();
        clearErrors.disabled = false;
        if (errorStatus) errorStatus.textContent = result.ok
          ? 'Local error buffer cleared.'
          : 'Could not clear the local error buffer.';
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
