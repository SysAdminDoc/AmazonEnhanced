const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_LABELS, isSponsoredLabelText } = require('../sponsored-detection.js');

test('accepts explicit sponsored labels across supported languages', () => {
  for (const label of DEFAULT_LABELS) {
    assert.equal(isSponsoredLabelText(label), true, label);
  }
});

test('does not classify ordinary secondary metadata as sponsored', () => {
  for (const label of ['2K+ bought in past month', "Amazon's Choice", 'Limited time deal', 'Arrives tomorrow', '']) {
    assert.equal(isSponsoredLabelText(label), false, label);
  }
});

test('uses exact locale-scoped labels when a marketplace set is supplied', () => {
  assert.equal(isSponsoredLabelText('Gesponsert', ['Gesponsert', 'Sponsored']), true);
  assert.equal(isSponsoredLabelText('Sponsorisé', ['Gesponsert', 'Sponsored']), false);
  assert.equal(isSponsoredLabelText('  SPONSORED  ', ['Sponsored']), true);
  assert.equal(isSponsoredLabelText('Sponsored product', ['Sponsored']), false);
});
