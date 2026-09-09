const test = require('node:test');
const assert = require('node:assert/strict');
const { filterPointsByDays, historySignature } = require('../price-history.js');

const NOW = Date.UTC(2026, 7, 11);
const DAY = 24 * 60 * 60 * 1000;

test('filters local history to the selected day range and sorts points', () => {
  const points = [
    { p: 12, t: NOW - 200 * DAY },
    { p: 10, t: NOW - 10 * DAY },
    { p: 11, t: NOW - 100 * DAY },
    { p: 'bad', t: NOW - 2 * DAY }
  ];

  assert.deepEqual(filterPointsByDays(points, 90, NOW), [
    { p: 10, t: NOW - 10 * DAY }
  ]);
  assert.deepEqual(filterPointsByDays(points, 180, NOW), [
    { p: 11, t: NOW - 100 * DAY },
    { p: 10, t: NOW - 10 * DAY }
  ]);
});

test('creates a stable signature for redraw checks', () => {
  assert.equal(historySignature([{ p: 9.5, t: 20 }, { p: 10, t: 30 }]), '20:9.5|30:10');
});
