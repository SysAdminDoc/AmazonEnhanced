# AmazonEnhanced — Roadmap

Chrome MV3 extension that de-clutters Amazon, blocks dark patterns, adds seller transparency, local price history, review-quality scoring, and order/wishlist export across 20 locales.

## Planned Features

### Core detection
- Add `.com.sa`, `.com.ng`, `.com.co`, `.cl`, `.pe` locales once Amazon rolls storefronts
- PDP seller-identity enrichment — resolve marketplace seller to LLC / country via Open Corporates lookup (opt-in, rate-limited)
- Counterfeit-risk heuristic — flags mismatched brand vs seller-name patterns
- Deal-badge normalizer — strip "Limited time deal" when the baseline price matches the "deal" price over the last 30 days
- Fresh/Whole Foods support — port price-per-unit badges to the grocery UI

### Price intelligence
- Keepa-style 90/180/365-day sparkline — all local, never leaves the browser
- CSV export of the full ASIN price history
- Cross-variant price map on PDPs (every color/size × its lowest seen)
- Import price history from older installs / other browsers (JSON round-trip)
- "Alert when under $X" — uses `chrome.alarms` + PDP re-fetch, local only

### Dark patterns
- Auto-skip "Recommended upgrade" at cart
- Detect and disable Amazon Prime 30-day-trial pre-check at checkout
- Warn when shipping slot silently changes tier (Same-Day → Prime std)
- Flag "frequently returned" items with reason breakdown when Amazon exposes it

### Data portability
- Wishlist import back into a new Amazon account (paste JSON → fill cart)
- Order-history export: invoice PDFs in a single ZIP (respect Amazon rate limits)
- `.ics` export of delivery dates for Google/Outlook Calendar
- Markdown "receipt" of any order for sysadmin expense reports

### Performance / Architecture
- Move the MutationObserver to a WeakRef-backed debounced queue — measured tab CPU reduction target 30%+
- Split content.js feature modules into dynamic imports so only active features load
- Shadow DOM for every injected UI to stop Amazon's CSS from leaking
- Service worker warm-start via `chrome.alarms` to survive MV3 suspend

## Competitive Research
- **Amazon Unsponsor** ([Chrome Web Store](https://chromewebstore.google.com/detail/amazon-unsponsor/kfaknphcidikmjhmmfmphghhlcoknflj)) — shade or remove sponsored; brittle against Amazon layout shifts; reviews cite amazon.sg and Brave reliability issues.
- **Amazon Shopping Companion & Ad Blocker** — combines ad blocking with CamelCamelCamel, FakeSpot/ReviewMeta, Google Shopping comparison. Worth matching the "external review sanity" flow via our local scorer.
- **eBay & Amazon Adblocker** — aggressive removal on search + PDP; good reference for what gets missed.
- **"Amazon Ads Blocker" by 10Xprofit** — flagged in Jan 2026 as malware injecting affiliate tag `10xprofit-20` into every link. Our extension's affiliate-stripper is the opposite play; call this out in README trust section.

## Nice-to-Haves
- Firefox MV2 port (much of the content-script code already works)
- Review-corpus sampler — pulls 100 reviews, runs local heuristics, surfaces top/bottom verbatims
- Detect and hide "Buy Again" bloat in the nav bar
- Block Sizzle IntelliJ-style animated PDP ads
- Diff two PDPs side-by-side (useful for A/B-priced duplicate listings)
- Local-only "stuff I bought too much of" — counts repeat orders of the same ASIN and suggests unsubscribe from Subscribe & Save

## Open-Source Research (Round 2)

### Related OSS Projects
- **Shift8/null-fake** — https://github.com/shift8web/null-fake — Open-source Fakespot replacement after Mozilla shutdown (Jul 2025); review-scoring Chrome extension, MIT.
- **FakeFind** — https://github.com/FakeFind-ai (Show HN https://news.ycombinator.com/item?id=44892336) — Cross-site review trust-score on Amazon/Walmart/eBay/BestBuy/Etsy.
- **Keepa** (closed, but reference) — price-history integration pattern worth emulating via local-only sparklines AmazonEnhanced already has.
- **Honey blockers & affiliate-strip extensions** on the `amazon` GitHub topic — https://github.com/topics/amazon — multiple community scripts for stripping affiliate tags and blocking Honey's attribution hijack.
- **dpastoor/keepa-history** patterns — price-history CSV import/export for users migrating off Keepa.
- **Savino** (chromewebstore + repo linked from tracefuse comparison) — smart product-sort with weighted rating/review-count/price trade-offs.
- **Fakespot legacy datasets** — some mirrored review-quality heuristics are on GitHub as forks; worth auditing for algorithm ideas even if the projects are archived.

### Features to Borrow
- **Cross-site review scoring** (FakeFind) — extend AmazonEnhanced's review-quality scoring to Walmart/Target/BestBuy/Etsy with a shared scoring kernel, so the same extension works at all major retailers.
- **Trust Score 1–10 + short summary** (FakeFind) — condense polarization/verified/volume into a single 1–10 badge near the title, not just detailed dials.
- **Weighted multi-axis sorter** (Savino) — add a "Smart sort" that lets users set sliders for rating-weight / review-count-weight / price-weight / trust-score-weight and re-ranks search results client-side.
- **Honey attribution-strip on affiliate click-through** (Honey-blocker scripts) — detect Honey's `r.honey.is` redirects and strip them before navigation, preserving the original affiliate (if any) so the extension can't hijack a click.
- **CSV import of Keepa / CCC history** — let refugees from Keepa/CamelCamelCamel import their historical price data so AmazonEnhanced's sparkline isn't empty on day-1 ASINs.
- **Review-corpus local cache** (Null Fake) — keep the last N scraped review blobs per ASIN client-side, so trust scores survive Amazon A/B-testing that hides the review-read button.
- **Sponsored-brand shelf detection across locales** (21+ locales on the `amazon` topic) — unified selector pack maintained as JSON rather than hardcoded per-locale CSS.
- **Prime-video ad-nag suppressor** — borrow from the wider `amazon`/declutter topic forks; Prime Video now injects dark-pattern upsells that the current AE scope misses.

### Patterns & Architectures Worth Studying
- **Null Fake's content-script architecture** — reverse-engineered post-Fakespot; reviews are fetched in background worker, scored, then overlaid via declarative rules. A clean MV3 pattern that avoids forcing the page to re-render.
- **FakeFind's cross-site scoring kernel** — a single Python/WASM or JS scoring module shared by the web-app and the extension, so the algorithm doesn't drift across platforms.
- **Savino's weighted-rerank as a pure function** — re-ranking lives in a pure function that takes `ProductCard[]` and weights; DOM writes happen in a separate pass, which avoids YouTube/Amazon "pick up tiles that aren't really cards" pitfalls.
- **Affiliate-strip done via `webRequest.onBeforeRequest` redirect** — intercept at the request layer rather than after-the-fact `href` rewriting, to prevent brief attribution to other parties during the navigation.
- **Per-locale JSON selector packs updated via update-URL** — ship selectors as a signed JSON bundle the extension refreshes daily without a full extension update, so Amazon A/B rollouts don't brick features for a week.

## Implementation Deep Dive (Round 3)

### Reference Implementations to Study
- **vkalway/de-sponsor-amazon-public** — https://github.com/vkalway/de-sponsor-amazon-public — privacy-first MV3-style extension; clean manifest, selector table separated from logic — good shape reference.
- **Finickyflame/amazon-unsponsored** — https://github.com/Finickyflame/amazon-unsponsored — long-running extension; commit history shows Amazon selector churn (useful for "what breaks after site refreshes").
- **Stefan-Code/amazon-sponsored-items-blocker** — https://github.com/Stefan-Code/amazon-sponsored-items-blocker — multi-locale (`.com`/`.co.uk`/`.de`) userscript; reference for our 20-locale coverage.
- **Amazon Sponsored Products Remover (Greasy Fork)** — https://greasyfork.org/en/scripts/388822-amazon-sponsored-products-remover/code — stats menu via `GM_registerMenuCommand` + logging; pattern we can mirror with `chrome.contextMenus`.
- **vmt-github/Amazon-Product-Cleaner** — https://github.com/vmt-github/Amazon-Product-Cleaner — hides both sponsored items AND Amazon Basics; useful for our Amazon-brand filter toggle.
- **desrod/disable-amazon-rufus-userscript** — https://github.com/desrod/disable-amazon-rufus-userscript — specifically kills Rufus + reclaims left rail; already-in-market parallel for our declutter toggles.
- **gsabater's cleanAmazon.user.js** — https://gist.github.com/gsabater/d7767ee5d21069a814967ecfa81bd415 — affiliate-param stripper; exact regex set we should adopt.

### Known Pitfalls from Similar Projects
- **Selector drift across locales** — `.s-label-popover-default` works on `.com` but not `.co.jp`; maintain a per-TLD selector map, don't assume parity. See Finickyflame issues.
- **Incomplete sponsored removal on Brave/AdGuard** — other blockers mutate the DOM first, leaving our selectors pointed at nodes already gone; guard with `?.remove()`, never `node.parentNode.removeChild`.
- **Review-quality scoring false positives** — post-Fakespot, many extensions still use naive 5-star histogram heuristics; Amazon's own "verified purchase" + timestamp clustering is more signal. Reference: https://chrome-stats.com/d/kfaknphcidikmjhmmfmphghhlcoknflj (Unsponsor review feedback).
- **Price-per-unit calc on variant changes** — Amazon's variant picker swaps DOM without page reload; mutate-observe `#productTitle` ancestor, not just `document`.
- **Affiliate tag re-insertion** — Amazon's own JS re-adds `tag=` if cleared; strip on `beforeunload`/click, not on load. See gsabater's gist.
- **`ytd-rich-item-renderer`-style CSS `:has()` overmatch** — Amazon uses generic class names; `:has([aria-label*="Sponsored"])` can catch non-sponsored rows if aria localization leaks.
- **MV3 compliance gap** — most GH references are MV2 userscripts; our MV3 port needs `declarativeNetRequest` for the affiliate-param rewrite rather than runtime URL mutation.

### Library Integration Checklist
- **chrome.declarativeNetRequest** MV3 API; entrypoint `chrome.declarativeNetRequest.updateDynamicRules`; gotcha: 5000 dynamic rule cap — our affiliate strip can be 1 rule with `redirect.transform.queryTransform.removeParams`.
- **chrome.scripting.insertCSS** MV3; entrypoint standard; gotcha: `origin:"USER"` so `!important` wins; use per-locale manifest match patterns.
- **@types/chrome** pin `>=0.0.260`; gotcha: DNR types lag.
- **DOMPurify** pin `>=3.1` (review-summary rendering); gotcha: sanitize before any innerHTML near Amazon's DOM.
- **Intl.NumberFormat** native; gotcha: price-per-unit needs per-locale decimal/thousands separator — don't regex.
- **rollup / esbuild** pin `>=0.25`; gotcha: emit separate entries per Amazon locale manifest match if selectors diverge enough.
- **webextension-polyfill** `>=0.12` if we ship Firefox; gotcha: Firefox's MV3 still lacks DNR `redirect.transform` — fall back to `webRequestBlocking` with `browser_specific_settings`.
