/**
 * AmazonEnhanced — popup.js
 * Accessible settings shell, local persistence, and live settings broadcast.
 */
(function () {
  'use strict';

  const OPEN_CORPORATES_ORIGIN = 'https://api.opencorporates.com/*';
  const POPUP_TAB_KEY = 'amzePopupTab';
  const PRICE_HISTORY_IO = globalThis.AmzePriceHistoryIO || {};
  const ERROR_REPORTER = globalThis.AmzeErrorBuffer && globalThis.AmzeErrorBuffer.createReporter
    ? globalThis.AmzeErrorBuffer.createReporter(chrome.storage.local, { source: 'popup' })
    : null;

  let DEFAULT_SETTINGS = null;
  let current = null;
  let sellerToken = '';
  let clearConfirmTimer = null;
  let resetConfirmTimer = null;
  let saveSequence = 0;

  if (ERROR_REPORTER && globalThis.AmzeErrorBuffer.attachGlobalListeners) {
    globalThis.AmzeErrorBuffer.attachGlobalListeners(globalThis, ERROR_REPORTER, 'popup');
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function reportPopupError(error, context) {
    if (ERROR_REPORTER && typeof ERROR_REPORTER.record === 'function') {
      ERROR_REPORTER.record(error, context || 'popup').catch(() => {});
    }
  }

  function lastRuntimeError() {
    try {
      return chrome.runtime && chrome.runtime.lastError;
    } catch (error) {
      return null;
    }
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(keys, result => {
          const error = lastRuntimeError();
          if (error) reject(error);
          else resolve(result || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(value, () => {
          const error = lastRuntimeError();
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.remove(keys, () => {
          const error = lastRuntimeError();
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function sendRuntimeMessage(message) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, response => {
          if (lastRuntimeError()) resolve({ ok: false, error: 'runtime_unavailable' });
          else resolve(response || { ok: false, error: 'empty_response' });
        });
      } catch (error) {
        reportPopupError(error, 'message:' + (message && message.type || 'unknown'));
        resolve({ ok: false, error: 'runtime_unavailable' });
      }
    });
  }

  function containsOpenCorporatesPermission() {
    return new Promise(resolve => {
      if (!chrome.permissions || typeof chrome.permissions.contains !== 'function') {
        resolve(false);
        return;
      }
      try {
        chrome.permissions.contains({ origins: [OPEN_CORPORATES_ORIGIN] }, granted => {
          resolve(!lastRuntimeError() && !!granted);
        });
      } catch (error) {
        reportPopupError(error, 'permissions:contains');
        resolve(false);
      }
    });
  }

  function requestOpenCorporatesPermission() {
    return new Promise(resolve => {
      if (!chrome.permissions || typeof chrome.permissions.request !== 'function') {
        resolve(false);
        return;
      }
      try {
        chrome.permissions.request({ origins: [OPEN_CORPORATES_ORIGIN] }, granted => {
          resolve(!lastRuntimeError() && !!granted);
        });
      } catch (error) {
        reportPopupError(error, 'permissions:request');
        resolve(false);
      }
    });
  }

  function removeOpenCorporatesPermission() {
    return new Promise(resolve => {
      if (!chrome.permissions || typeof chrome.permissions.remove !== 'function') {
        resolve(false);
        return;
      }
      try {
        chrome.permissions.remove({ origins: [OPEN_CORPORATES_ORIGIN] }, removed => {
          resolve(!lastRuntimeError() && !!removed);
        });
      } catch (error) {
        reportPopupError(error, 'permissions:remove');
        resolve(false);
      }
    });
  }

  async function loadDefaultSettings() {
    const response = await fetch(chrome.runtime.getURL('defaults.json'));
    if (!response.ok) throw new Error('Failed to load defaults.json');
    return response.json();
  }

  function cloneDefaultSettings() {
    return structuredClone(DEFAULT_SETTINGS);
  }

  function mergeSettings(saved) {
    const merged = Object.assign(cloneDefaultSettings(), saved || {});
    merged.flags = Object.assign({}, DEFAULT_SETTINGS.flags, (saved && saved.flags) || {});
    if (merged.flags.hideSponsored && merged.flags.shadeSponsored) {
      merged.flags.shadeSponsored = false;
    }
    delete merged.openCorporatesToken;
    return merged;
  }

  function setSaveStatus(text, state) {
    const status = $('#amze-save-status');
    if (!status) return;
    status.textContent = text;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
  }

  function applyPopupAppearance() {
    if (!current) return;
    document.documentElement.dataset.amzeTheme = current.theme || 'dark';
    document.documentElement.dataset.amzeDensity = current.density || 'comfortable';
  }

  function syncSwitchAria(input) {
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-checked', String(!!input.checked));
  }

  function syncDependentFields() {
    const brandField = $('#amze-brands');
    const allergenField = $('#amze-allergens');
    const tokenField = $('#amze-oc-token');
    const permissionStatus = $('#amze-oc-permission-status');

    if (brandField) brandField.disabled = !current.flags.hideCustomBrands;
    if (allergenField) allergenField.disabled = !current.flags.allergenScan;
    if (tokenField) tokenField.disabled = !current.flags.sellerLookup;
    if (permissionStatus && permissionStatus.dataset.state !== 'error') {
      permissionStatus.textContent = current.flags.sellerLookup
        ? 'Permission granted. The token is stored separately from page-visible settings.'
        : 'Enable seller lookup to grant access to OpenCorporates.';
      permissionStatus.dataset.state = current.flags.sellerLookup ? 'success' : '';
    }
  }

  function renderForm() {
    applyPopupAppearance();
    $$('input[name="amze-theme"]').forEach(input => {
      input.checked = input.value === current.theme;
    });
    $$('.amze-seg-btn[data-density]').forEach(button => {
      const active = button.dataset.density === current.density;
      button.classList.toggle('amze-seg-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $$('.amze-seg-btn[data-image]').forEach(button => {
      const active = button.dataset.image === (current.imageMode || 'tile');
      button.classList.toggle('amze-seg-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $$('input[data-flag]').forEach(input => {
      input.checked = !!current.flags[input.dataset.flag];
      syncSwitchAria(input);
    });
    $$('input[data-meta]').forEach(input => {
      input.checked = !!current[input.dataset.meta];
      syncSwitchAria(input);
    });

    const brands = $('#amze-brands');
    const allergens = $('#amze-allergens');
    const token = $('#amze-oc-token');
    if (brands) brands.value = current.customBrands || '';
    if (allergens) allergens.value = current.allergens || '';
    if (token) token.value = sellerToken;
    syncDependentFields();
  }

  function activateTab(button, persist) {
    if (!button) return;
    $$('.amze-tab').forEach(tab => {
      const active = tab === button;
      tab.classList.toggle('amze-tab-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $$('.amze-pane').forEach(pane => {
      const active = pane.dataset.pane === button.dataset.tab;
      pane.classList.toggle('amze-pane-active', active);
      pane.toggleAttribute('hidden', !active);
    });
    const content = $('.amze-content');
    if (content) content.scrollTop = 0;
    if (persist) {
      storageSet({ [POPUP_TAB_KEY]: button.dataset.tab })
        .catch(error => reportPopupError(error, 'tab:persist'));
    }
  }

  async function getSellerToken() {
    const response = await sendRuntimeMessage({ type: 'AMZE_GET_SELLER_LOOKUP_TOKEN' });
    return response.ok ? String(response.token || '') : '';
  }

  function setSellerToken(value) {
    return sendRuntimeMessage({
      type: 'AMZE_SET_SELLER_LOOKUP_TOKEN',
      token: String(value || '')
    });
  }

  async function load() {
    const stored = await storageGet(['amzeSettings', POPUP_TAB_KEY]);
    const legacyToken = String(stored.amzeSettings && stored.amzeSettings.openCorporatesToken || '').trim();
    current = mergeSettings(stored.amzeSettings);
    if (legacyToken) {
      await setSellerToken(legacyToken);
      await storageSet({ amzeSettings: current });
    }
    sellerToken = await getSellerToken();

    if (current.flags.sellerLookup && !await containsOpenCorporatesPermission()) {
      current.flags.sellerLookup = false;
      await storageSet({ amzeSettings: current });
    }

    renderForm();
    const requestedTab = stored[POPUP_TAB_KEY];
    const tab = requestedTab
      ? $('.amze-tab[data-tab="' + requestedTab + '"]')
      : $('.amze-tab-active');
    activateTab(tab || $('.amze-tab'), false);
    setSaveStatus('Saved', 'saved');
  }

  async function persistAndBroadcast() {
    const sequence = ++saveSequence;
    setSaveStatus('Saving…', 'saving');
    try {
      delete current.openCorporatesToken;
      await storageSet({ amzeSettings: current });
      const response = await sendRuntimeMessage({
        type: 'AMZE_BROADCAST_SETTINGS',
        settings: current
      });
      if (sequence !== saveSequence) return response;
      if (response.ok) setSaveStatus('Saved', 'saved');
      else setSaveStatus('Saved; protection error', 'error');
      return response;
    } catch (error) {
      reportPopupError(error, 'settings:persist');
      if (sequence === saveSequence) setSaveStatus('Couldn’t save', 'error');
      return { ok: false, error: 'storage_failed' };
    }
  }

  function clearDataCaches() {
    return sendRuntimeMessage({ type: 'AMZE_CLEAR_LOCAL_DATA' });
  }

  function mergeImportedPriceHistory(entries) {
    return sendRuntimeMessage({ type: 'AMZE_IDB_MERGE_PRICE_HISTORY', entries });
  }

  function requestErrorReport() {
    return sendRuntimeMessage({ type: 'AMZE_GET_ERROR_REPORT' });
  }

  function clearErrorBuffer() {
    return sendRuntimeMessage({ type: 'AMZE_CLEAR_ERROR_BUFFER' });
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

  function resetClearDataButton(button, status) {
    delete button.dataset.confirming;
    button.disabled = false;
    button.textContent = 'Clear local data';
    if (status && !status.textContent) status.textContent = '';
  }

  function wireTabs() {
    const tabs = $$('.amze-tab');
    tabs.forEach((button, index) => {
      button.addEventListener('click', () => activateTab(button, true));
      button.addEventListener('keydown', event => {
        let nextIndex = null;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = tabs.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        tabs[nextIndex].focus();
        activateTab(tabs[nextIndex], true);
      });
    });
    activateTab($('.amze-tab-active') || tabs[0], false);
  }

  function wireSettings() {
    $$('input[data-flag]').forEach(input => {
      syncSwitchAria(input);
      input.addEventListener('change', async () => {
        const flag = input.dataset.flag;
        if (flag === 'sellerLookup' && input.checked) {
          setSaveStatus('Requesting access…', 'saving');
          const granted = await requestOpenCorporatesPermission();
          if (!granted) {
            input.checked = false;
            syncSwitchAria(input);
            const helper = $('#amze-oc-permission-status');
            if (helper) {
              helper.textContent = 'OpenCorporates access was not granted; seller lookup remains off.';
              helper.dataset.state = 'error';
            }
            setSaveStatus('Access not granted', 'error');
            return;
          }
          const helper = $('#amze-oc-permission-status');
          if (helper) delete helper.dataset.state;
        }

        current.flags[flag] = input.checked;
        if (flag === 'hideSponsored' && input.checked) current.flags.shadeSponsored = false;
        if (flag === 'shadeSponsored' && input.checked) current.flags.hideSponsored = false;
        if (flag === 'sellerLookup' && !input.checked) {
          removeOpenCorporatesPermission().catch(() => {});
        }
        renderForm();
        await persistAndBroadcast();
      });
    });

    $$('input[data-meta]').forEach(input => {
      syncSwitchAria(input);
      input.addEventListener('change', async () => {
        current[input.dataset.meta] = input.checked;
        syncSwitchAria(input);
        await persistAndBroadcast();
      });
    });

    $$('input[name="amze-theme"]').forEach(input => {
      input.addEventListener('change', async () => {
        if (!input.checked) return;
        current.theme = input.value;
        renderForm();
        await persistAndBroadcast();
      });
    });

    $$('.amze-seg-btn[data-density]').forEach(button => {
      button.addEventListener('click', async () => {
        current.density = button.dataset.density;
        renderForm();
        await persistAndBroadcast();
      });
    });

    $$('.amze-seg-btn[data-image]').forEach(button => {
      button.addEventListener('click', async () => {
        current.imageMode = button.dataset.image;
        renderForm();
        await persistAndBroadcast();
      });
    });

    [
      ['#amze-brands', 'customBrands'],
      ['#amze-allergens', 'allergens']
    ].forEach(binding => {
      const field = $(binding[0]);
      const key = binding[1];
      if (!field) return;
      let timer;
      field.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          current[key] = field.value;
          await persistAndBroadcast();
        }, 350);
      });
    });

    const token = $('#amze-oc-token');
    if (token) {
      let timer;
      token.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          sellerToken = token.value.trim();
          setSaveStatus('Saving…', 'saving');
          const response = await setSellerToken(sellerToken);
          setSaveStatus(response.ok ? 'Saved' : 'Couldn’t save', response.ok ? 'saved' : 'error');
        }, 350);
      });
    }
  }

  function wireReset() {
    const reset = $('#amze-reset');
    if (!reset) return;
    reset.addEventListener('click', async () => {
      if (reset.dataset.confirming !== '1') {
        reset.dataset.confirming = '1';
        reset.textContent = 'Reset?';
        setSaveStatus('Click Reset again', 'saving');
        clearTimeout(resetConfirmTimer);
        resetConfirmTimer = setTimeout(() => {
          delete reset.dataset.confirming;
          reset.textContent = 'Reset';
          setSaveStatus('Saved', 'saved');
        }, 5000);
        return;
      }

      clearTimeout(resetConfirmTimer);
      delete reset.dataset.confirming;
      reset.textContent = 'Reset';
      current = cloneDefaultSettings();
      sellerToken = '';
      await Promise.all([
        setSellerToken(''),
        removeOpenCorporatesPermission(),
        storageRemove(POPUP_TAB_KEY).catch(() => null)
      ]);
      renderForm();
      activateTab($('#amze-tab-ads'), false);
      await persistAndBroadcast();
    });
  }

  function wireDataActions() {
    const clearData = $('#amze-clear-data');
    const clearStatus = $('#amze-clear-status');
    if (clearData) {
      clearData.addEventListener('click', async () => {
        if (clearData.dataset.confirming !== '1') {
          clearData.dataset.confirming = '1';
          clearData.textContent = 'Click again to clear';
          if (clearStatus) clearStatus.textContent = 'Clears local history and caches. Settings and your API token stay unchanged.';
          clearTimeout(clearConfirmTimer);
          clearConfirmTimer = setTimeout(() => resetClearDataButton(clearData, clearStatus), 5000);
          return;
        }
        clearTimeout(clearConfirmTimer);
        clearData.disabled = true;
        if (clearStatus) clearStatus.textContent = 'Clearing local data…';
        const result = await clearDataCaches();
        resetClearDataButton(clearData, clearStatus);
        if (clearStatus) {
          clearStatus.textContent = result.ok
            ? 'Local history and caches cleared.'
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
        if (importStatus) importStatus.textContent = 'Reading price history…';
        try {
          const parsed = typeof PRICE_HISTORY_IO.parsePriceHistoryImport === 'function'
            ? PRICE_HISTORY_IO.parsePriceHistoryImport(await file.text())
            : null;
          if (!parsed || !parsed.entries.length) throw new Error('No usable price history found.');
          const result = await mergeImportedPriceHistory(parsed.entries);
          if (!result.ok) throw new Error('The extension could not save the imported history.');
          if (importStatus) {
            importStatus.textContent = 'Imported history for ' + result.imported + ' ASIN'
              + (result.imported === 1 ? '' : 's') + '.';
          }
        } catch (error) {
          reportPopupError(error, 'price-history:import');
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
        if (errorStatus) errorStatus.textContent = 'Collecting the local error buffer…';
        const result = await requestErrorReport();
        exportErrors.disabled = false;
        if (!result.ok || !result.report) {
          if (errorStatus) errorStatus.textContent = 'Could not collect the error report.';
          return;
        }
        downloadJson(result.report, 'amazonenhanced-error-report-' + Date.now() + '.json');
        if (errorStatus) {
          errorStatus.textContent = 'Downloaded ' + result.report.entries.length + ' recorded error'
            + (result.report.entries.length === 1 ? '' : 's') + '.';
        }
      });
    }
    if (clearErrors) {
      clearErrors.addEventListener('click', async () => {
        clearErrors.disabled = true;
        const result = await clearErrorBuffer();
        clearErrors.disabled = false;
        if (errorStatus) {
          errorStatus.textContent = result.ok
            ? 'Local error buffer cleared.'
            : 'Could not clear the local error buffer.';
        }
      });
    }
  }

  function wireUp() {
    wireTabs();
    wireSettings();
    wireReset();
    wireDataActions();
    const version = $('#amze-version');
    if (version && chrome.runtime && chrome.runtime.getManifest) {
      version.textContent = 'v' + chrome.runtime.getManifest().version;
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      DEFAULT_SETTINGS = await loadDefaultSettings();
      current = cloneDefaultSettings();
      wireUp();
      await load();
    } catch (error) {
      reportPopupError(error, 'boot');
      document.body.dataset.amzeDefaultsError = '1';
      setSaveStatus('Couldn’t load', 'error');
    }
  });
})();
