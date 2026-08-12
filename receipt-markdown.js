(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeReceiptMarkdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function clean(value, limit = 300) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function escapeCell(value) {
    return clean(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  }

  function safeFilenamePart(value) {
    return clean(value, 80).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'order';
  }

  function formatReceiptMarkdown(record) {
    const orderId = clean(record && record.orderId, 80);
    const date = clean(record && record.date, 100);
    const total = clean(record && record.total, 100);
    const items = Array.isArray(record && record.items)
      ? record.items.map(item => typeof item === 'string' ? item : item && item.title).map(item => clean(item)).filter(Boolean)
      : [];
    const title = orderId ? `# Amazon order ${orderId}` : '# Amazon order receipt';
    const lines = [title, '', '| Field | Value |', '| --- | --- |'];
    if (date) lines.push(`| Order date | ${escapeCell(date)} |`);
    if (total) lines.push(`| Total | ${escapeCell(total)} |`);
    if (!date && !total) lines.push('| Details | Not shown on this order card |');
    lines.push('', '## Items');
    if (items.length) items.forEach(item => lines.push(`- ${item.replace(/([\\`*_{}\[\]()<>#+.!|])/g, '\\$1')}`));
    else lines.push('- Item details were not visible on this order card.');
    lines.push('', '> Exported locally by AmazonEnhanced.');
    return lines.join('\n') + '\n';
  }

  function buildReceiptFilename(record) {
    const id = safeFilenamePart(record && record.orderId);
    return `amazon-order-${id}.md`;
  }

  return { formatReceiptMarkdown, buildReceiptFilename };
});
