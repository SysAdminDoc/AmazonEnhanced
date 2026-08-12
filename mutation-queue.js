(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeMutationQueue = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createWeakMutationQueue(onDrain, wait = 180) {
    const weakRefs = typeof WeakRef === 'function';
    const queued = new WeakMap();
    const refs = [];
    const strongFallback = new Set();
    let timer = null;
    const stats = {
      enqueueCalls: 0,
      rootsQueued: 0,
      duplicateRoots: 0,
      drainedRoots: 0,
      collectedRoots: 0,
      drainBatches: 0
    };

    function add(root) {
      if (!root || (typeof root !== 'object' && typeof root !== 'function')) return false;
      stats.enqueueCalls++;
      if (queued.get(root)) {
        stats.duplicateRoots++;
        return false;
      }
      queued.set(root, true);
      stats.rootsQueued++;
      if (weakRefs) refs.push(new WeakRef(root));
      else strongFallback.add(root);
      return true;
    }

    function addMany(roots) {
      let added = 0;
      for (const root of (roots || [])) if (add(root)) added++;
      if (added && timer === null) timer = setTimeout(drain, wait);
      return added;
    }

    function drain() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      const roots = [];
      if (weakRefs) {
        while (refs.length) {
          const root = refs.shift().deref();
          if (!root) {
            stats.collectedRoots++;
            continue;
          }
          queued.set(root, false);
          roots.push(root);
        }
      } else {
        for (const root of strongFallback) {
          queued.set(root, false);
          roots.push(root);
        }
        strongFallback.clear();
      }
      if (!roots.length) return [];
      stats.drainBatches++;
      stats.drainedRoots += roots.length;
      onDrain(roots);
      return roots;
    }

    function cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (weakRefs) {
        refs.forEach(ref => {
          const root = ref.deref();
          if (root) queued.set(root, false);
        });
      } else {
        strongFallback.forEach(root => queued.set(root, false));
      }
      refs.length = 0;
      strongFallback.clear();
    }

    function getStats() {
      return Object.assign({ weakRefs }, stats, { pendingRoots: weakRefs ? refs.length : strongFallback.size });
    }

    return { add, addMany, drain, cancel, getStats };
  }

  return { createWeakMutationQueue };
});
