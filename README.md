<p align="center">
  <img src="icon.svg" width="128" height="128" alt="AmazonEnhanced" />
</p>

<h1 align="center">AmazonEnhanced</h1>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.3-89b4fa?style=flat-square" alt="version" />
  <img src="https://img.shields.io/badge/license-MIT-a6e3a1?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/platform-Chrome%20MV3-f9e2af?style=flat-square" alt="platform" />
</p>

<p align="center">
  Chrome extension that de-clutters Amazon, blocks dark patterns, adds seller transparency, price history, order/wishlist export, and accessibility tools.
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
- **Force one-time purchase.** Detects pre-selected Subscribe & Save radios and switches back.
- **Auto-uncheck** gift-receipt, share-info, and add-on dark patterns at checkout.

### Transparency & trust
- **Country-of-origin badge** on PDPs + cached search-tile badges.
- **Reveal seller.** Actual third-party seller name + link near the product title.
- **Variation bait warning.** Flags listings with >3× price spread across variants.
- **Local price history.** Sparkline of every price you've seen on that ASIN. No external API, no Keepa account.
- **Review-quality scoring.** Polarization, 1-star share, verified-sample ratio, volume.

### Price tools
- Inline price-per-unit badges (auto $/oz, $/kg, $/ct; locale-safe EU decimal parsing)
- Suspicious-MSRP flag (>70% above actual)
- Affiliate/tracking URL stripper + `/dp/ASIN` canonicalization
- Extra "Sort by" options: *Most reviews*, *Newest*, *Best $/unit*

### Tools & data portability
- **Copy clean product link** button on PDPs (Markdown-formatted)
- **Order history export** (CSV / JSON) on `/your-orders` pages
- **Wishlist export** (CSV / JSON / Markdown) on wishlist pages
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

- `AmazonEnhanced-v2.0.3.zip` — extract, then **Load unpacked** in `chrome://extensions/` (Developer mode).
- `AmazonEnhanced-v2.0.3.crx` — drag into `chrome://extensions/`.

## Settings

Toolbar popup with 10 tabs: Ads, Declutter, Reviews, Price, Cart, Trust, Tools, Brands, A11y, Theme. Changes broadcast live to every open Amazon tab.

## Architecture

```
manifest.json        MV3 manifest, 20 Amazon locales
early-inject.js      document_start: theme + a11y attributes
theme.css            document_start: theme + declutter + image-mode + feature chrome
content.js           document_end: 15 feature modules + MutationObserver
background.js        Service worker: defaults, late-delivery alarm, tab broadcast
popup.html/css/js    10-tab settings UI
icons/               16/32/48/128/512 PNGs
build/pack-crx.py    CRX3 packer
```

## License

MIT — see [LICENSE](LICENSE).
