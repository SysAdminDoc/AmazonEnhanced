const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeShippingText, compareShippingSnapshots } = require('../shipping-diff.js');

test('normalizes checkout text before comparing', () => {
  assert.equal(normalizeShippingText('  Prime   Delivery\nTomorrow  '), 'Prime Delivery Tomorrow');
});

test('reports shipping tier and delivery slot changes independently', () => {
  assert.deepEqual(compareShippingSnapshots(
    { tier: 'Standard delivery', slot: 'Tomorrow, 8 AM - 12 PM' },
    { tier: 'Expedited delivery', slot: 'Friday, 8 AM - 12 PM' }
  ), [
    { field: 'shipping tier', before: 'Standard delivery', after: 'Expedited delivery' },
    { field: 'delivery slot', before: 'Tomorrow, 8 AM - 12 PM', after: 'Friday, 8 AM - 12 PM' }
  ]);
});

test('does not report missing fields as changes', () => {
  assert.deepEqual(compareShippingSnapshots(
    { tier: 'Standard delivery', slot: '' },
    { tier: 'Standard delivery', slot: 'Tomorrow' }
  ), []);
});
