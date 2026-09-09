(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeErrorBuffer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'amzeErrorBuffer';
  const MAX_ENTRIES = 100;
  const MAX_MESSAGE_LENGTH = 500;
  const MAX_STACK_LENGTH = 2000;
  const MAX_CONTEXT_LENGTH = 120;

  function clamp(value, length, preserveLines = false) {
    let text = String(value == null ? '' : value).trim();
    if (!preserveLines) text = text.replace(/\s+/g, ' ');
    return text.slice(0, length);
  }

  function normalizeError(error, context = 'runtime', now = Date.now()) {
    const source = error && typeof error === 'object' ? error : null;
    const message = clamp(source && source.message !== undefined ? source.message : error, MAX_MESSAGE_LENGTH) || 'Unknown error';
    const stack = clamp(source && source.stack, MAX_STACK_LENGTH, true);
    const entry = {
      at: Number.isFinite(now) ? now : Date.now(),
      context: clamp(context || 'runtime', MAX_CONTEXT_LENGTH),
      name: clamp(source && source.name || 'Error', 80),
      message
    };
    if (stack) entry.stack = stack;
    return entry;
  }

  function normalizeEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.filter(entry => entry && typeof entry === 'object' && entry.message)
      .slice(-MAX_ENTRIES)
      .map(entry => ({
        at: Number.isFinite(entry.at) ? entry.at : 0,
        context: clamp(entry.context || 'runtime', MAX_CONTEXT_LENGTH),
        name: clamp(entry.name || 'Error', 80),
        message: clamp(entry.message, MAX_MESSAGE_LENGTH),
        ...(entry.stack ? { stack: clamp(entry.stack, MAX_STACK_LENGTH, true) } : {})
      }));
  }

  function callStorage(storage, method, args) {
    if (!storage || typeof storage[method] !== 'function') return Promise.reject(new Error('storage_unavailable'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      const callback = value => finish(resolve, value);
      try {
        const result = storage[method](...args, callback);
        if (result && typeof result.then === 'function') result.then(value => finish(resolve, value), error => finish(reject, error));
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  function read(storage) {
    return callStorage(storage, 'get', [STORAGE_KEY])
      .then(result => normalizeEntries(result && result[STORAGE_KEY]));
  }

  function write(storage, entries) {
    return callStorage(storage, 'set', [{ [STORAGE_KEY]: normalizeEntries(entries) }]);
  }

  function clear(storage) {
    return callStorage(storage, 'remove', [STORAGE_KEY]);
  }

  function createReporter(storage, options = {}) {
    const source = clamp(options.source || 'extension', MAX_CONTEXT_LENGTH);
    const maxEntries = Math.max(1, Math.min(MAX_ENTRIES, Number(options.maxEntries) || MAX_ENTRIES));
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const dedupeWindowMs = Math.max(0, Number(options.dedupeWindowMs ?? 3000));
    const recentKeys = new Map();
    let queue = Promise.resolve();

    function record(error, context = 'runtime') {
      const timestamp = now();
      const entry = normalizeError(error, `${source}:${context}`, timestamp);
      const key = `${entry.context}\u0000${entry.name}\u0000${entry.message}`;
      const previous = recentKeys.get(key);
      if (dedupeWindowMs && previous !== undefined && timestamp - previous < dedupeWindowMs) return Promise.resolve(null);
      recentKeys.set(key, timestamp);
      if (recentKeys.size > MAX_ENTRIES * 2) {
        recentKeys.delete(recentKeys.keys().next().value);
      }
      queue = queue.then(async () => {
        const entries = await read(storage);
        entries.push(entry);
        await write(storage, entries.slice(-maxEntries));
        return entry;
      }).catch(() => null);
      return queue;
    }

    return {
      record,
      flush: () => queue
    };
  }

  function attachGlobalListeners(target, reporter, context) {
    if (!target || !reporter || typeof target.addEventListener !== 'function') return () => {};
    const onError = event => reporter.record(
      event && event.error ? event.error : { name: 'ErrorEvent', message: event && event.message },
      `${context || 'global'}:error`
    );
    const onRejection = event => reporter.record(
      event && event.reason ? event.reason : { name: 'UnhandledRejection', message: 'Unhandled promise rejection' },
      `${context || 'global'}:unhandledrejection`
    );
    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onRejection);
    return () => {
      target.removeEventListener?.('error', onError);
      target.removeEventListener?.('unhandledrejection', onRejection);
    };
  }

  function createReport(entries, metadata = {}) {
    return {
      format: 'AmazonEnhanced error report',
      version: 1,
      generatedAt: Number.isFinite(metadata.generatedAt) ? metadata.generatedAt : Date.now(),
      extensionVersion: clamp(metadata.extensionVersion || '', 40),
      entries: normalizeEntries(entries)
    };
  }

  return {
    STORAGE_KEY,
    MAX_ENTRIES,
    normalizeError,
    normalizeEntries,
    read,
    write,
    clear,
    createReporter,
    attachGlobalListeners,
    createReport
  };
});
