(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeNetworkRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const AMAZON_DOMAINS = Object.freeze([
    'amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de', 'amazon.fr',
    'amazon.it', 'amazon.es', 'amazon.nl', 'amazon.pl', 'amazon.se',
    'amazon.com.tr', 'amazon.in', 'amazon.co.jp', 'amazon.com.au',
    'amazon.com.mx', 'amazon.com.br', 'amazon.sg', 'amazon.sa',
    'amazon.ae', 'amazon.eg'
  ]);

  // Only attribution and analytics keys belong here. Product/search state such
  // as keywords, psc, sr, and th must survive cleaning.
  const STRIP_PARAMS = Object.freeze([
    'tag', 'ref', 'ref_',
    'pd_rd_w', 'pd_rd_wg', 'pd_rd_r', 'pd_rd_i', 'pd_rd_m', 'pd_rd_s',
    'pd_rd_t', 'pd_rd_plhdr',
    'pf_rd_p', 'pf_rd_r', 'pf_rd_s', 'pf_rd_t', 'pf_rd_i', 'pf_rd_m',
    'pf_rd_c', 'pf_rd_w', 'pf_rd_wg', 'pf_rd_plhdr',
    'content-id', 'qid', '_encoding', 'dib', 'dib_tag', 'sprefix', 'linkCode'
  ]);

  const AFFILIATE_RULE_IDS = Object.freeze(AMAZON_DOMAINS.map((_domain, index) => index + 1));
  const AD_RULE_IDS = Object.freeze([1001, 1002, 1003, 1004, 1005, 1006, 1007]);
  const MANAGED_RULE_IDS = Object.freeze([...AFFILIATE_RULE_IDS, ...AD_RULE_IDS]);
  const AMAZON_INITIATORS = Object.freeze([...AMAZON_DOMAINS, 'primevideo.com']);
  const AD_RESOURCE_TYPES = Object.freeze([
    'script', 'image', 'stylesheet', 'sub_frame', 'xmlhttprequest', 'media',
    'font', 'ping', 'websocket', 'other'
  ]);

  const AD_FILTERS = Object.freeze([
    '||amazon-adsystem.com/',
    '||sponsored-ads.amazon.com/',
    '||pagead2.googlesyndication.com/pagead/',
    '||advertising.amazon.dev/',
    '||ara.paa-reporting-advertising.amazon/',
    '||unagi-na.amazon.com/1/events/com.amazon.eel.SponsoredProductsEventTracking.prod',
    '||m.media-amazon.com/images/G/01/ad-feedback/'
  ]);

  function isAmazonHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
    return AMAZON_DOMAINS.some(domain => host === domain || host.endsWith('.' + domain));
  }

  function buildAffiliateRules(enabled) {
    if (!enabled) return [];
    return AMAZON_DOMAINS.map((domain, index) => ({
      id: AFFILIATE_RULE_IDS[index],
      priority: 1,
      action: {
        type: 'redirect',
        redirect: {
          transform: {
            queryTransform: { removeParams: [...STRIP_PARAMS] }
          }
        }
      },
      condition: {
        urlFilter: `||${domain}/`,
        resourceTypes: ['main_frame', 'sub_frame']
      }
    }));
  }

  function buildAdBlockRules(enabled) {
    if (!enabled) return [];
    return AD_FILTERS.map((urlFilter, index) => ({
      id: AD_RULE_IDS[index],
      priority: 2,
      action: { type: 'block' },
      condition: {
        urlFilter,
        // This dedicated ad-event service can issue beacons without a stable
        // page initiator. Other filters stay scoped to Amazon browsing tabs.
        ...(urlFilter === '||advertising.amazon.dev/'
          ? {}
          : { initiatorDomains: [...AMAZON_INITIATORS] }),
        resourceTypes: [...AD_RESOURCE_TYPES]
      }
    }));
  }

  function buildDynamicRules(options = {}) {
    return [
      ...buildAffiliateRules(!!options.stripAffiliate),
      ...buildAdBlockRules(!!options.hideSponsored)
    ];
  }

  return {
    AMAZON_DOMAINS,
    STRIP_PARAMS,
    AFFILIATE_RULE_IDS,
    AD_RULE_IDS,
    MANAGED_RULE_IDS,
    AD_FILTERS,
    isAmazonHost,
    buildAffiliateRules,
    buildAdBlockRules,
    buildDynamicRules
  };
});
