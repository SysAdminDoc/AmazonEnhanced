<p align="center">
  <img src="icon.svg" width="128" height="128" alt="AmazonEnhanced" />
</p>

<h1 align="center">AmazonEnhanced</h1>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-89b4fa?style=flat-square" alt="version" />
  <img src="https://img.shields.io/badge/license-MIT-a6e3a1?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/platform-Chrome%20MV3-f9e2af?style=flat-square" alt="platform" />
  <img src="https://img.shields.io/badge/locales-20-f38ba8?style=flat-square" alt="locales" />
  <img src="https://img.shields.io/badge/telemetry-none-cba6f7?style=flat-square" alt="telemetry" />
</p>

<p align="center">
  <strong>De-clutter Amazon.</strong><br/>
  Native dark theme, sponsored-result removal, local review-quality scoring,
  price-per-unit tools, Amazon-brand filters, and privacy hygiene — all in one Manifest V3 extension.
</p>

---

## Why

The Amazon-enhancement market is fragmented into single-purpose tools: one extension hides sponsored results, another does a dark theme, another analyzes reviews. With **Fakespot** and **ReviewMeta** both shut down in 2025/2026, there is also no first-class review-analysis option left. AmazonEnhanced bundles the essentials — locally, with zero telemetry.

## Features

### Ads & sponsored removal
- **Multi-locale sponsored result removal** (search page + PDP carousels + infinite scroll)
- **Optional shade mode** keeps tiles visible but dimmed + red outlined
- **Video-ad suppression** on product pages (shoppable videos, sponsored video carousels)
- **Prime trial / upsell nag** removal
- **Hero banner / promo strip** removal

### Section declutter (granular toggles)
Each of these can be individually hidden:
- `Brands related to this category`
- `Inspired by your browsing`
- `Customers also bought / viewed`
- `Buy it again` rails
- `Climate Pledge Friendly` widgets
- `Editorial recommendations`
- `From the manufacturer` A+ content
- `Compare with similar items` widget
- `Subscribe & Save` default-on upsell
- Cart upsells / saved-for-later clutter
- Homepage carousels & hero widgets
- Footer / back-to-top
- Inline search-result whitespace padding

### Reviews & trust (flagship)
- **Local review-quality score** — on-device heuristic that measures:
  - Star-polarization spike (1★ + 5★ share)
  - One-star share (paid-review red flag threshold)
  - Verified-purchase ratio in visible sample
  - Total review volume
- **Adjusted rating** — shown next to Amazon's displayed rating when suspicious patterns are detected
- Panel injects above the review list on every PDP
- No external API — no reviews leave your browser

### Price tools
- **Inline price-per-unit badges** on search tiles (auto-computes $/oz, $/kg, $/ct when Amazon doesn't show it; handles EU comma decimals correctly)
- **Suspicious MSRP detector** — flags strikethrough list prices that are > 70% above actual price
- **Affiliate / tracking URL stripping** — removes `tag=`, `ref=`, `pd_rd_*`, `pf_rd_*`, etc. and shortens `/dp/` links

### Brand & seller filters
- **Hide Amazon in-house brands** — Amazon Basics, Essentials, Solimo, Pinzon, Goodthreads, Wag, Mama Bear, Happy Belly, Presto!, Amazon Elements, Ring, Blink, eero, etc.
- **Gibberish-brand heuristic** — filters 5–8 letter all-caps random-looking brand names (drop-shipper pattern)
- **User-defined blocklist** — regex patterns, one per line

### Theming
- **Catppuccin Mocha** dark (default, hand-tuned, not inverted)
- **AMOLED** true-black variant
- **Light** — Amazon native, with features only
- **Density** — Comfortable (default) or Compact
- **Anti-FOUC** — theme applied at `document_start`, body opacity held until ready

### Privacy
- No telemetry
- No external APIs
- Settings stored in `chrome.storage.local` only
- Open source (MIT)

## Locale coverage

`.com` `.co.uk` `.ca` `.de` `.fr` `.it` `.es` `.nl` `.pl` `.se` `.com.tr` `.in` `.co.jp` `.com.au` `.com.mx` `.com.br` `.sg` `.sa` `.ae` `.eg`

## Install (unpacked)

1. Clone or download this repo.
2. Open `chrome://extensions/`.
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** and select the `AmazonEnhanced/` folder.
5. Pin the extension from the toolbar puzzle icon for quick access.
6. Visit Amazon. Click the extension icon to open settings.

## Settings

Open the toolbar popup. Six tabs:

- **Ads** — sponsored, video ads, banners, Prime nags
- **Declutter** — every section toggle
- **Reviews** — enable/disable local scoring
- **Price** — unit price, MSRP warnings, link stripping
- **Brands** — Amazon-brand, gibberish, custom blocklist (regex)
- **Theme** — Mocha / AMOLED / Light, density, toast preference

Changes broadcast live to all open Amazon tabs.

## Architecture

```
AmazonEnhanced/
  manifest.json        MV3 manifest, 20 Amazon locales
  early-inject.js      document_start: anti-FOUC theme attr injection
  theme.css            document_start: theme variables + declutter rules (flag-gated)
  content.js           document_end: runtime feature orchestrator, MutationObserver
  background.js        Service worker, defaults seed, tab broadcast
  popup.html/css/js    Settings UI (6 tabs)
  icon.svg             Source logo
  icons/               16/32/48/128/512 PNGs
```

- **Early-inject pattern**: at `document_start`, `<html>` receives `data-amze-theme` and per-feature `data-amze-<flag>` attributes. `theme.css` is scoped entirely by those attributes, so toggling a flag activates or deactivates CSS rules without reflow.
- **Runtime pattern**: `content.js` runs at `document_end`, scans result tiles, attaches observer, handles sponsored removal, brand filter, price-per-unit, MSRP warn, affiliate strip, and review scoring. Debounced to 180 ms for infinite scroll.
- **Messaging**: popup → background (`AMZE_BROADCAST_SETTINGS`) → all Amazon tabs (`AMZE_SETTINGS_UPDATED`). Live update, no page reload.

## Privacy

AmazonEnhanced makes zero network requests of its own. All features run locally using the already-loaded Amazon DOM. Settings are stored in `chrome.storage.local` and are never synced, transmitted, or logged.

## License

MIT — see [LICENSE](LICENSE).
