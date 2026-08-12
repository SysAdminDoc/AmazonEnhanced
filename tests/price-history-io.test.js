const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_POINTS_PER_ASIN,
  mergeHistoryEntries,
  serializePriceHistory,
  parsePriceHistoryImport
} = require('../price-history-io.js');

test('round-trips versioned JSON and keeps full stored points', () => {
  const json = serializePriceHistory([{ asin: 'B012345678', points: [{ p: 12.5, t: 100 }, { p: 10, t: 200 }] }], 300);
  const parsed = parsePriceHistoryImport(json);
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.entries, [{ asin: 'B012345678', points: [{ p: 12.5, t: 100 }, { p: 10, t: 200 }] }]);
});

test('accepts legacy ASIN-to-points objects and merges duplicate points', () => {
  const imported = parsePriceHistoryImport(JSON.stringify({
    B012345678: [{ p: 12, t: 100 }, { p: 11, t: 200 }]
  }));
  const merged = mergeHistoryEntries(
    [{ asin: 'B012345678', points: [{ p: 12, t: 100 }, { p: 9, t: 300 }] }],
    imported.entries
  );
  assert.deepEqual(merged, [{
    asin: 'B012345678',
    points: [{ p: 12, t: 100 }, { p: 11, t: 200 }, { p: 9, t: 300 }]
  }]);
});

test('caps merged history at the existing per-ASIN storage limit', () => {
  const points = Array.from({ length: MAX_POINTS_PER_ASIN + 5 }, (_, i) => ({ p: i + 1, t: i + 1 }));
  const merged = mergeHistoryEntries([], [{ asin: 'B012345678', points }]);
  assert.equal(merged[0].points.length, MAX_POINTS_PER_ASIN);
  assert.equal(merged[0].points[0].t, 6);
});
