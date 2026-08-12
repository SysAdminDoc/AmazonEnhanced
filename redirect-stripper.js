(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeRedirectStripper = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const REDIRECT_HOSTS = [
    /^(?:r|go)\.honey\.is$/i,
    /^(?:r|go)\.joinhoney\.com$/i,
    /^go\.redirectingat\.com$/i,
    /^(?:click|track)\.linksynergy\.com$/i,
    /^go\.skimresources\.com$/i,
    /^redirect\.viglink\.com$/i
  ];
  const DESTINATION_PARAMS = [
    'url', 'u', 'redirect', 'redirect_url', 'destination', 'dest',
    'target', 'to', 'out', 'link', 'href'
  ];

  function isRedirectHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return REDIRECT_HOSTS.some(pattern => pattern.test(host));
  }

  function decodeCandidate(value) {
    let decoded = String(value || '');
    for (let i = 0; i < 3; i++) {
      let next = decoded;
      try { next = decodeURIComponent(decoded.replace(/\+/g, '%20')); } catch (e) {}
      if (next === decoded) break;
      decoded = next;
    }
    return decoded;
  }

  function isAmazonHost(hostname) {
    return /(^|\.)amazon\.[a-z.]+$/i.test(String(hostname || ''));
  }

  function candidateUrls(url) {
    const candidates = [];
    for (const key of DESTINATION_PARAMS) {
      const values = url.searchParams.getAll(key);
      values.forEach(value => candidates.push(decodeCandidate(value)));
    }
    const pathCandidate = decodeCandidate(url.pathname);
    if (/https?:\/\//i.test(pathCandidate)) candidates.push(pathCandidate);
    return candidates;
  }

  function findAmazonDestination(url, depth = 0) {
    if (!url || depth > 2 || !isRedirectHost(url.hostname)) return null;
    for (const candidate of candidateUrls(url)) {
      try {
        const target = new URL(candidate, url.origin);
        if (isAmazonHost(target.hostname)) return target;
        const nested = findAmazonDestination(target, depth + 1);
        if (nested) return nested;
      } catch (e) {}
    }
    return null;
  }

  function unwrapAmazonRedirect(href, baseHref) {
    let url;
    try { url = new URL(href, baseHref); } catch (e) { return href; }
    const target = findAmazonDestination(url);
    return target ? target.toString() : href;
  }

  return { isRedirectHost, isAmazonHost, unwrapAmazonRedirect };
});
