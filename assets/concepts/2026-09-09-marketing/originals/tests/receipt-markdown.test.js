const test = require('node:test');
const assert = require('node:assert/strict');
const { formatReceiptMarkdown, buildReceiptFilename } = require('../receipt-markdown.js');

test('formats an individual order as a safe Markdown receipt', () => {
  const markdown = formatReceiptMarkdown({
    orderId: '123-4567890-1234567',
    date: 'June 27, 2026',
    total: '$42.50',
    items: ['A | B', 'Second item * special']
  });
  assert.match(markdown, /^# Amazon order 123-4567890-1234567/m);
  assert.match(markdown, /\| Total \| \$42\.50 \|/);
  assert.ok(markdown.includes('A \\| B'));
  assert.ok(markdown.includes('Second item \\* special'));
  assert.match(markdown, /Exported locally by AmazonEnhanced/);
});

test('builds a stable receipt filename from the order ID', () => {
  assert.equal(buildReceiptFilename({ orderId: '123-4567890-1234567' }), 'amazon-order-123-4567890-1234567.md');
  assert.equal(buildReceiptFilename({ orderId: '' }), 'amazon-order-order.md');
});
