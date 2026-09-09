const assert = require('node:assert/strict');
const test = require('node:test');
const { matchesExtensionManifest } = require('./extension-identity.js');
const expected = require('../manifest.json');

test('accepts the installed release manifest with resolved localized strings', () => {
  assert.equal(matchesExtensionManifest({ ...expected, name: 'AmazonEnhanced', description: 'Localized text' }, expected), true);
});

test('rejects a built-in browser extension that also uses background.js', () => {
  assert.equal(matchesExtensionManifest({ manifest_version: 3, name: 'google.com', version: '1.0', background: { service_worker: 'background.js' } }, expected), false);
});

for (const [field, value] of Object.entries({ version: '0.0.1', homepage_url: 'https://example.com/', background: { service_worker: 'other.js' }, action: { default_popup: 'other.html' }, manifest_version: 2 })) {
  test(`rejects a candidate with a different ${field}`, () => {
    assert.equal(matchesExtensionManifest({ ...expected, [field]: value }, expected), false);
  });
}

test('rejects a missing manifest', () => {
  assert.equal(matchesExtensionManifest(undefined, expected), false);
});
