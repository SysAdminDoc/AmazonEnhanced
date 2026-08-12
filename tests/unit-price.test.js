const test = require('node:test');
const assert = require('node:assert/strict');
const { extractQuantity, formatUnitPrice } = require('../unit-price.js');

test('parses grocery weight, volume, pack, and dozen quantities', () => {
  assert.deepEqual(extractQuantity('Organic milk, 1 quart'), { qty: 32, unit: 'floz' });
  assert.deepEqual(extractQuantity('Bananas 2 lb bag'), { qty: 32, unit: 'oz' });
  assert.deepEqual(extractQuantity('Sparkling water, pack of 12'), { qty: 12, unit: 'ct' });
  assert.deepEqual(extractQuantity('Large brown eggs, dozen'), { qty: 12, unit: 'ct' });
});

test('formats the normalized quantity at a useful grocery scale', () => {
  assert.equal(formatUnitPrice(4.99, 32, 'floz'), '0.16/floz');
  assert.equal(formatUnitPrice(8.00, 32, 'oz'), '4.00/lb');
  assert.equal(formatUnitPrice(2.49, 12, 'ct'), '0.21/ct');
});
