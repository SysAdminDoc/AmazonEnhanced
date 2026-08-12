const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isRedirectHost,
  isAmazonHost,
  unwrapAmazonRedirect
} = require('../redirect-stripper.js');

test('recognizes Honey and common attribution redirect hosts', () => {
  assert.equal(isRedirectHost('r.honey.is'), true);
  assert.equal(isRedirectHost('go.redirectingat.com'), true);
  assert.equal(isRedirectHost('example.com'), false);
});

test('unwraps encoded Amazon destinations without accepting unrelated targets', () => {
  const target = 'https://www.amazon.com/dp/B000000001?tag=sample';
  const href = `https://r.honey.is/v2/redirect?url=${encodeURIComponent(target)}`;
  assert.equal(unwrapAmazonRedirect(href), target);
  assert.equal(unwrapAmazonRedirect(`https://r.honey.is/v2/redirect?url=${encodeURIComponent('https://example.com/')}`), href.replace(/\?.*$/, '?url=' + encodeURIComponent('https://example.com/')));
});

test('handles nested destination parameters and Amazon locale hosts', () => {
  const nested = `https://go.redirectingat.com/?u=${encodeURIComponent('https://r.honey.is/?u=' + encodeURIComponent('https://www.amazon.co.uk/gp/product/B000000002'))}`;
  assert.equal(unwrapAmazonRedirect(nested), 'https://www.amazon.co.uk/gp/product/B000000002');
  assert.equal(isAmazonHost('www.amazon.co.jp'), true);
  assert.equal(isAmazonHost('amazon-example.com'), false);
});
