<p align="center">
  <img src="icon.png" width="128" height="128" alt="AmazonEnhanced" />
</p>

<h1 align="center">AmazonEnhanced</h1>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.15-89b4fa?style=flat-square" alt="version" />
  <img src="https://img.shields.io/badge/license-MIT-a6e3a1?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/platform-Chrome%20%2B%20Firefox%20MV3-f9e2af?style=flat-square" alt="platform" />
</p>

<p align="center">
  Chrome extension that de-clutters Amazon, blocks dark patterns, adds seller transparency, price history, order/wishlist portability, and accessibility tools.
</p>

---

## Features

### Ads & sponsored
- Sponsored-result removal (search pages, PDP carousels, infinite scroll)
- Optional shade mode (keeps tiles visible but dimmed + outlined)
- Video-ad and Prime-upsell nag removal
- Hero banner / promo strip removal

### Section declutter
13 independent toggles: Brands related, Inspired by browsing, Customers also bought, Buy it again, Climate Pledge, Editorial, From the manufacturer, Compare, Subscribe & Save default, cart upsells, homepage clutter, footer, inline padding.

### Cart, checkout & dark patterns
- **Auto-decline warranty / protection plan.** SquareTrade/Allstate upsell: "No thanks" is selected automatically.
- **Skip recommended upgrades.** Cart and post-add-to-cart prompts with explicit "No thanks" / "Continue without upgrade" actions are declined automatically.
- **Disable Prime free-trial pre-checks.** A checked 30-day/free-trial Prime control is cleared at checkout, or an explicit no-trial radio option is selected.
- **Shipping-change warning.** Compares the settled checkout shipping tier and delivery slot and warns if either changes later.
- **Frequently returned warning.** Surfaces Amazon's explicit frequent-return disclosure and nearby reason breakdown when available.
- **Force one-time purchase.** Detects pre-selected Subscribe & Save radios and switches back.
- **Auto-uncheck** gift-receipt, share-info, and add-on dark patterns at checkout.

### Transparency & trust
- **Country-of-origin badge** on PDPs + cached search-tile badges.
- **Reveal seller.** Actual third-party seller name + link near the product title.
- **OpenCorporates seller lookup.** Optional, token-backed, rate-limited seller entity lookup.
- **Counterfeit-risk warning.** Flags brand / marketplace-seller name mismatches.
- **Variation bait warning.** Flags listings with >3× price spread across variants.
- **Variant local price map.** Shows every color / size option with its lowest price seen in this browser.
- **Local price history.** IndexedDB-backed sparkline of every price you've seen on that ASIN, with 90 / 180 / 365-day range controls. No external API, no Keepa account.
- Price history JSON import/export for moving local history between browser installs; the PDP sparkline exports the full current-ASIN history.
- **Review-quality scoring.** Polarization, 1-star share, verified-sample ratio, volume.
- **Visible review excerpts.** Caches up to 20 visible review bodies per ASIN locally and surfaces distinct top-rated and lowest-rated excerpts beside the review analysis.

### Price tools
- Inline price-per-unit badges (auto $/oz, $/kg, $/ct; locale-safe EU decimal parsing), including Fresh / Whole Foods product cards
- Suspicious-MSRP flag (>70% above actual)
- Local deal-badge normalizer when "Limited time deal" matches the 30-day local baseline
- Affiliate/tracking URL stripper + `/dp/ASIN` canonicalization
- Price drop alerts from local price history
- Extra "Sort by" options: *Most reviews*, *Newest*, *Best $/unit*
- Weighted smart sort with live sliders for rating, review count, price, unit price, and trust score; rankings apply to currently loaded search results only

### Tools & data portability
- **Copy clean product link** button on PDPs (Markdown-formatted)
- **Order history export** (CSV / JSON) on `/your-orders` pages
- **Invoice PDF ZIP export** for visible order cards; fetches same-origin invoice candidates one at a time with a 2.5-second delay, includes only `%PDF` responses, and reports unavailable/non-invoice orders
- **Individual Markdown receipts** from a one-click action on each visible order card
- **Wishlist export** (CSV / JSON / Markdown) on wishlist pages
- **Wishlist import** from an AmazonEnhanced JSON export, using a user-started, rate-limited queue of Amazon's visible Add to List controls; keep the source wishlist tab open while it runs
- **Late-delivery watcher** — background alarm notifies you when a promised delivery date passes without "Delivered"
- **CPU Tamer** — throttles Amazon's background `setInterval`s when the tab is hidden

### Brand & seller filters
- Hide Amazon in-house brands (Amazon Basics, Essentials, Solimo, Pinzon, Goodthreads, Wag, Mama Bear, Ring, Blink, eero, etc.)
- Gibberish-brand heuristic (5–8 letter all-caps random names)
- User-defined regex blocklist

### Accessibility & safety
- Large-text mode (17px body)
- High-contrast mode (yellow on black, cyan links, green prices)
- ARIA fixes for Amazon's icon-only buttons
- Allergen / ingredient watchlist (user-defined terms, banner on match)

### Theme
- Catppuccin Mocha (default) · AMOLED · Light
- Comfortable or Compact density
- Anti-FOUC
- Image dark-mode: Off · Tile · Dim · Darken · Invert · Smart (canvas corner-sample to detect white backgrounds)

## Locale coverage

`.com` `.co.uk` `.ca` `.de` `.fr` `.it` `.es` `.nl` `.pl` `.se` `.com.tr` `.in` `.co.jp` `.com.au` `.com.mx` `.com.br` `.sg` `.sa` `.ae` `.eg`

## Install

From the [Releases page](https://github.com/SysAdminDoc/AmazonEnhanced/releases):

- `AmazonEnhanced-v2.0.15.zip` — extract, then **Load unpacked** in `chrome://extensions/` (Developer mode).
- `AmazonEnhanced-v2.0.15.crx` — secondary package for enterprise/self-host tooling that accepts CRX files.
- `AmazonEnhanced-v2.0.15.xpi` — Firefox package; install from `about:addons` when using a signed build or a Firefox development profile.

- `AmazonEnhanced-v2.0.15-edge.zip` — Microsoft Edge Add-ons package; upload this ZIP through Partner Center.

The Firefox package uses a fixed Gecko add-on ID, a background event page fallback, Firefox's `sidebar_action` equivalent for the price-history panel, and Mozilla's `webextension-polyfill` 0.12.0 runtime. Build it with `python build/pack-firefox.py`.
The Edge package keeps the Chromium MV3 service worker and side panel unchanged. Build it with `python build/pack-edge.py`; for local testing, open `edge://extensions`, enable Developer mode, and choose **Load unpacked** on the repository directory.

## Settings

Toolbar popup with 10 tabs: Ads, Declutter, Reviews, Price, Cart, Trust, Tools, Brands, A11y, Theme. Changes broadcast live to every open Amazon tab.

## Privacy

AmazonEnhanced stores settings, local price history, sampled review excerpts, seller/origin cache entries, watched-order dates, the bounded error buffer, custom brand rules, OpenCorporates API token, and allergen terms only in the browser profile. It does not send analytics, telemetry, browsing history, shopping data, or affiliate data to external services. Invoice PDF ZIP export fetches same-origin invoice candidates through the signed-in Amazon page session and assembles the ZIP locally; it does not upload invoices. If OpenCorporates seller lookup is enabled, seller names are sent to OpenCorporates with your local API token. The Tools tab includes local price-history JSON import, a manual local error-report export, and local data-clear actions.

## Architecture

```
manifest.json        MV3 manifest, 20 Amazon locales
locales.json         Amazon locale/domain/pattern source of truth
_locales/en/         Chrome Web Store name/description strings
browser-polyfill.min.js Mozilla browser/browser.* compatibility runtime
early-inject.js      document_start: theme + a11y attributes
theme.css            document_start: theme + declutter + image-mode + feature chrome
content.js           document_end: feature runtime + MutationObserver
feature-modules.js   active-flag-to-bundle map for conditional content injection
smart-sort.js        bounded weighted ranking kernel for visible search results
mutation-queue.js    WeakRef-backed debounced mutation roots and profiling counters
shadow-ui.js         isolated Shadow DOM host lifecycle for injected PDP UI
shadow-ui.css        isolated styles for Shadow DOM PDP panels and controls
review-corpus.js     bounded local visible-review normalization and excerpt selection
error-buffer.js      bounded local runtime-error buffer and report formatter
session-state.js     bounded chrome.storage.session scan markers per document
service-worker-warm.js periodic MV3 service-worker wake/alarm helper
wishlist-import.js   JSON parser and bounded ASIN helpers for wishlist import
invoice-export.js    visible order invoice-link discovery and PDF validation
zip-store.js         dependency-free store-only ZIP writer
receipt-markdown.js  local Markdown receipt formatter and safe filenames
background.js        Service worker: defaults, IDB caches, alarms, DNR, tab broadcast
popup.html/css/js    10-tab settings UI
icons/               16/32/48/128/512 PNGs
build/pack-crx.py    CRX3 packer
build/pack-firefox.py XPI packer with Firefox manifest adaptation and 20-locale validation
build/pack-edge.py   Edge Add-ons ZIP packer with MV3 and 20-locale validation
build/release.js     esbuild per-file minifier and deterministic release ZIP builder
```

Feature helper bundles are injected into the isolated content-script world only after the active settings flags are known; the static content entry point keeps the settings/observer core small. For performance profiling on an Amazon page, inspect `window.__amzeMutationMetrics` in the console. It records full-document versus targeted scan counts and elapsed work, plus queue coalescing statistics; counters reset when the content script reloads.

For a minified release tree, run `npm ci` and then `npm run build:release`. The command writes ignored output to `dist/` and creates a deterministic `AmazonEnhanced-v<version>-release.zip`; source files remain readable and the runtime's per-file module boundaries are preserved.

## License

MIT — see [LICENSE](LICENSE).
