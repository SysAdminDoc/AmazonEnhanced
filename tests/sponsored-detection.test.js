const test = require('node:test');
const assert = require('node:assert/strict');
const { isSponsoredLabelText } = require('../sponsored-detection.js');

test('accepts explicit sponsored labels across supported languages', () => {
  for (const label of ['Sponsored', 'AD', 'Gesponsert', 'Sponsorisé', 'Sponsorizzato', 'Patrocinado', 'スポンサー', 'प्रायोजित']) {
    assert.equal(isSponsoredLabelText(label), true, label);
  }
});

test('does not classify ordinary secondary metadata as sponsored', () => {
  for (const label of ['2K+ bought in past month', "Amazon's Choice", 'Limited time deal', 'Arrives tomorrow', '']) {
    assert.equal(isSponsoredLabelText(label), false, label);
  }
});
