(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeInvoiceExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_INVOICE_EXPORTS = 50;
  const INVOICE_FETCH_DELAY_MS = 2500;
  const ORDER_ID_RE = /\b([A-Z0-9]{3}-\d{7}-\d{7})\b/i;

  function normalizeText(value, limit = 240) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function normalizeOrderId(value) {
    const match = String(value || '').match(ORDER_ID_RE);
    if (match) return match[1].toUpperCase();
    return normalizeText(value, 80).replace(/[^A-Z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  }

  function isVisible(element) {
    if (!element || element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    if (typeof getComputedStyle !== 'function') return true;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function cardOrderId(card) {
    const dataId = card.getAttribute('data-order-id') || card.getAttribute('data-orderid');
    const scoped = card.querySelector('[class*="order-id"], [data-order-id], [data-orderid]');
    const text = [dataId, scoped && scoped.textContent, card.textContent].filter(Boolean).join(' ');
    const match = text.match(ORDER_ID_RE);
    return match ? match[1].toUpperCase() : normalizeOrderId(dataId || '');
  }

  function cardTitle(card) {
    return normalizeText(card.querySelector('.yohtmlc-item .a-link-normal, .a-fixed-left-grid .a-link-normal, h3 a, [class*="item-title"]')?.textContent || '');
  }

  function linkLabel(anchor) {
    return [anchor.getAttribute('aria-label'), anchor.getAttribute('title'), anchor.textContent]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function isInvoiceLink(anchor) {
    const href = String(anchor.getAttribute('href') || '');
    const label = linkLabel(anchor);
    return /invoice|tax invoice|view\s*(?:\/|or)?\s*print|print invoice/i.test(label) ||
      /invoice|print\.html|orderID=.*(?:print|invoice)/i.test(href);
  }

  function resolveSameOriginUrl(href, pageHref) {
    try {
      const page = new URL(pageHref);
      const target = new URL(href, pageHref);
      if (target.protocol !== page.protocol || target.origin !== page.origin) return '';
      return target.href;
    } catch (e) {
      return '';
    }
  }

  function buildInvoiceFallbackUrl(orderId, pageHref) {
    const id = normalizeOrderId(orderId);
    if (!id) return '';
    try {
      const url = new URL('/gp/css/summary/print.html', pageHref);
      url.searchParams.set('ie', 'UTF8');
      url.searchParams.set('orderID', id);
      url.searchParams.set('print', '1');
      return url.href;
    } catch (e) {
      return '';
    }
  }

  function extractInvoiceCandidatesFromCard(card, pageHref) {
    if (!isVisible(card)) return [];
    const orderId = cardOrderId(card);
    const title = cardTitle(card);
    const links = Array.from(card.querySelectorAll('a[href]'))
      .filter(isInvoiceLink)
      .map(anchor => resolveSameOriginUrl(anchor.getAttribute('href'), pageHref))
      .filter(Boolean);
    const uniqueLinks = Array.from(new Set(links));
    if (!uniqueLinks.length) {
      const fallback = buildInvoiceFallbackUrl(orderId, pageHref);
      return fallback ? [{ orderId, title, href: fallback, source: 'order-id-fallback' }] : [];
    }
    return uniqueLinks.map(href => ({ orderId, title, href, source: 'visible-link' }));
  }

  function extractInvoiceCandidatesFromPage(doc, pageHref, maxItems = MAX_INVOICE_EXPORTS) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return [];
    const cards = Array.from(doc.querySelectorAll('.order-card, .order, .js-order-card, [data-order-id]'));
      
    const candidates = [];
    const seen = new Set();
    cards.forEach(card => {
      extractInvoiceCandidatesFromCard(card, pageHref).forEach(candidate => {
        if (seen.has(candidate.href)) return;
        seen.add(candidate.href);
        candidates.push(candidate);
      });
    });
    return candidates.slice(0, maxItems);
  }

  function buildInvoiceFilename(candidate, occurrence = 1) {
    const id = normalizeOrderId(candidate && candidate.orderId) || 'order';
    const suffix = occurrence > 1 ? `-${occurrence}` : '';
    return `amazon-invoice-${id}${suffix}.pdf`;
  }

  function looksLikePdf(bytes) {
    if (!bytes || bytes.length < 5) return false;
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  }

  function isPdfContentType(contentType) {
    return /application\/pdf/i.test(String(contentType || ''));
  }

  return {
    MAX_INVOICE_EXPORTS,
    INVOICE_FETCH_DELAY_MS,
    normalizeOrderId,
    isInvoiceLink,
    resolveSameOriginUrl,
    buildInvoiceFallbackUrl,
    extractInvoiceCandidatesFromCard,
    extractInvoiceCandidatesFromPage,
    buildInvoiceFilename,
    looksLikePdf,
    isPdfContentType
  };
});
