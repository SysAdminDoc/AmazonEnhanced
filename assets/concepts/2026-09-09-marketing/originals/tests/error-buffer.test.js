const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STORAGE_KEY,
  normalizeError,
  createReporter,
  createReport,
  clear,
  read
} = require('../error-buffer.js');

function createStorage() {
  const values = {};
  return {
    values,
    get(keys, callback) { callback({ [STORAGE_KEY]: values[STORAGE_KEY] }); },
    set(next, callback) { Object.assign(values, next); callback(); },
    remove(key, callback) { delete values[key]; callback(); }
  };
}

test('normalizes bounded error details without leaking arbitrary fields', () => {
  const entry = normalizeError({
    name: 'TypeError',
    message: '  bad   value  ',
    stack: 'line 1\nline 2',
    secret: 'should not be copied'
  }, 'content:scan', 123);
  assert.deepEqual(entry, {
    at: 123,
    context: 'content:scan',
    name: 'TypeError',
    message: 'bad value',
    stack: 'line 1\nline 2'
  });
});

test('serializes reports through a bounded local queue', async () => {
  const storage = createStorage();
  const reporter = createReporter(storage, { source: 'test', maxEntries: 2, now: () => 456 });
  await reporter.record(new Error('first'), 'one');
  await reporter.record(new Error('second'), 'two');
  await reporter.record(new Error('third'), 'three');
  const entries = await read(storage);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].message, 'second');
  assert.equal(entries[1].context, 'test:three');
  assert.deepEqual(createReport(entries, { generatedAt: 789, extensionVersion: '2.0.15' }), {
    format: 'AmazonEnhanced error report',
    version: 1,
    generatedAt: 789,
    extensionVersion: '2.0.15',
    entries
  });
});

test('clears the local error buffer', async () => {
  const storage = createStorage();
  const reporter = createReporter(storage);
  await reporter.record('failure', 'test');
  await clear(storage);
  assert.deepEqual(await read(storage), []);
});

test('deduplicates repeated runtime errors inside the reporting window', async () => {
  const storage = createStorage();
  let now = 1000;
  const reporter = createReporter(storage, { source: 'test', now: () => now, dedupeWindowMs: 100 });
  await reporter.record(new Error('repeat'), 'scan');
  now += 50;
  await reporter.record(new Error('repeat'), 'scan');
  now += 100;
  await reporter.record(new Error('repeat'), 'scan');
  const entries = await read(storage);
  assert.equal(entries.length, 2);
});
