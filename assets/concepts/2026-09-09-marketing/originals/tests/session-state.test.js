const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STORAGE_KEY,
  MAX_PROCESSED_KEYS,
  createSessionState
} = require('../session-state.js');

function createStorage() {
  const values = {};
  return {
    values,
    get(key, callback) { callback({ [STORAGE_KEY]: values[STORAGE_KEY] }); },
    set(next, callback) { Object.assign(values, next); callback(); }
  };
}

test('persists bounded processed markers in session storage per document page', async () => {
  const storage = createStorage();
  const first = createSessionState(storage, 'https://amazon.test/dp/ABC|100', { persistDelayMs: 0, now: () => 123 });
  await first.hydrate();
  assert.equal(first.hasProcessed('tile-1'), false);
  first.markProcessed('tile-1');
  first.markScan('full');
  await first.flush();

  const second = createSessionState(storage, 'https://amazon.test/dp/ABC|100', { persistDelayMs: 0 });
  await second.hydrate();
  assert.equal(second.hasProcessed('tile-1'), true);
  assert.equal(second.snapshot().scans, 1);

  const otherPage = createSessionState(storage, 'https://amazon.test/dp/ABC|200', { persistDelayMs: 0 });
  await otherPage.hydrate();
  assert.equal(otherPage.hasProcessed('tile-1'), false);
});

test('caps processed markers and can reset them', async () => {
  const storage = createStorage();
  const state = createSessionState(storage, 'page', { persistDelayMs: 0 });
  await state.hydrate();
  for (let i = 0; i < MAX_PROCESSED_KEYS + 12; i++) state.markProcessed(`tile-${i}`);
  await state.flush();
  assert.equal(state.snapshot().processedCount, MAX_PROCESSED_KEYS);
  assert.equal(state.hasProcessed('tile-0'), false);
  assert.equal(state.hasProcessed(`tile-${MAX_PROCESSED_KEYS + 11}`), true);
  state.resetProcessed();
  await state.flush();
  assert.equal(state.snapshot().processedCount, 0);
});

test('falls back to in-memory state when session storage is unavailable', async () => {
  const state = createSessionState(null, 'page');
  await state.hydrate();
  state.markProcessed('tile');
  assert.equal(state.hasProcessed('tile'), true);
  await state.flush();
});
