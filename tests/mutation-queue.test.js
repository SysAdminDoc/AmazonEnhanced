const test = require('node:test');
const assert = require('node:assert/strict');
const { createWeakMutationQueue } = require('../mutation-queue.js');

test('coalesces duplicate roots and drains a batch on demand', () => {
  const batches = [];
  const queue = createWeakMutationQueue(roots => batches.push(roots), 100000);
  const first = {};
  const second = {};
  assert.equal(queue.addMany([first, first, second]), 2);
  assert.equal(queue.add(first), false);
  assert.equal(queue.getStats().duplicateRoots, 2);
  const drained = queue.drain();
  assert.deepEqual(drained, [first, second]);
  assert.deepEqual(batches, [[first, second]]);
  assert.equal(queue.getStats().pendingRoots, 0);
  queue.cancel();
});

test('allows a root to be queued again after its previous batch drains', () => {
  const batches = [];
  const queue = createWeakMutationQueue(roots => batches.push(roots), 100000);
  const root = {};
  assert.equal(queue.add(root), true);
  queue.drain();
  assert.equal(queue.add(root), true);
  queue.drain();
  assert.equal(batches.length, 2);
  assert.equal(queue.getStats().drainBatches, 2);
});
