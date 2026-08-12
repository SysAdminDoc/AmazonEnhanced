const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_INVOICE_EXPORTS,
  INVOICE_FETCH_DELAY_MS,
  normalizeOrderId,
  resolveSameOriginUrl,
  buildInvoiceFallbackUrl,
  extractInvoiceCandidatesFromPage,
  buildInvoiceFilename,
  looksLikePdf,
  isPdfContentType
} = require('../invoice-export.js');

test('normalizes standard Amazon order IDs and safe fallback names', () => {
  assert.equal(normalizeOrderId('Order # 123-4567890-1234567'), '123-4567890-1234567');
  assert.equal(normalizeOrderId('Legacy order 42'), 'Legacy-order-42');
  assert.equal(buildInvoiceFilename({ orderId: '123-4567890-1234567' }), 'amazon-invoice-123-4567890-1234567.pdf');
  assert.equal(buildInvoiceFilename({ orderId: '123-4567890-1234567' }, 2), 'amazon-invoice-123-4567890-1234567-2.pdf');
});

test('restricts invoice fetch URLs to the current Amazon origin', () => {
  assert.equal(
    resolveSameOriginUrl('/gp/css/summary/print.html?orderID=123', 'https://www.amazon.com/your-orders'),
    'https://www.amazon.com/gp/css/summary/print.html?orderID=123'
  );
  assert.equal(resolveSameOriginUrl('https://example.com/invoice.pdf', 'https://www.amazon.com/your-orders'), '');
  assert.match(buildInvoiceFallbackUrl('123-4567890-1234567', 'https://www.amazon.co.uk/your-orders'), /amazon\.co\.uk\/gp\/css\/summary\/print\.html\?ie=UTF8&orderID=123-4567890-1234567&print=1/);
});

test('recognizes PDF signatures and content types', () => {
  assert.equal(looksLikePdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])), true);
  assert.equal(looksLikePdf(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c])), false);
  assert.equal(isPdfContentType('application/pdf; charset=binary'), true);
  assert.equal(isPdfContentType('text/html'), false);
});

test('extracts same-origin invoice links and falls back to the order print URL', () => {
  class FakeElement {
    constructor({ attrs = {}, text = '', links = [] } = {}) {
      this.attrs = attrs;
      this.textContent = text;
      this.links = links;
    }
    getAttribute(name) { return this.attrs[name] || null; }
    querySelector() { return null; }
    querySelectorAll(selector) { return selector === 'a[href]' ? this.links : []; }
  }
  const invoiceLink = new FakeElement({ attrs: { href: '/gp/css/summary/print.html?orderID=123-4567890-1234567' }, text: 'Invoice' });
  const linkedCard = new FakeElement({ text: 'Order # 123-4567890-1234567', links: [invoiceLink] });
  const fallbackCard = new FakeElement({ text: 'Order # 222-4567890-1234567' });
  const doc = { querySelectorAll: () => [linkedCard, fallbackCard] };
  const candidates = extractInvoiceCandidatesFromPage(doc, 'https://www.amazon.com/your-orders');
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].source, 'visible-link');
  assert.equal(candidates[1].source, 'order-id-fallback');
  assert.ok(candidates[1].href.includes('orderID=222-4567890-1234567'));
});

test('keeps the invoice queue bounded and deliberately delayed', () => {
  assert.equal(MAX_INVOICE_EXPORTS, 50);
  assert.ok(INVOICE_FETCH_DELAY_MS >= 2000);
});
