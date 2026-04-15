# Changelog

All notable changes to AmazonEnhanced are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-04-14

Initial release.

### Added
- Chrome MV3 extension targeting 20 Amazon locales (`.com`, `.co.uk`, `.ca`, `.de`, `.fr`, `.it`, `.es`, `.nl`, `.pl`, `.se`, `.com.tr`, `.in`, `.co.jp`, `.com.au`, `.com.mx`, `.com.br`, `.sg`, `.sa`, `.ae`, `.eg`).
- **Sponsored/ad removal**: search result tiles, PDP carousels, banners, hero strips, video ad blocks, Prime upsell nags. Optional shade-instead-of-hide mode.
- **Granular declutter panel**: 13 independent section toggles (`brands related`, `inspired by browsing`, `customers also bought`, `buy it again`, `climate pledge`, `editorial recs`, `from the manufacturer`, `compare with similar`, `subscribe & save default`, cart upsells, homepage clutter, footer, inline padding).
- **Local review-quality scoring**: on-device heuristic (star polarization, 1-star share, verified sample ratio, volume). Adjusted rating displayed alongside Amazon's. No external API (fills the post-Fakespot/ReviewMeta gap).
- **Price-per-unit badges** on search tiles: auto-computes $/oz, $/kg, $/ct when Amazon omits it. Locale-safe numeric parsing (handles EU comma decimals).
- **Suspicious MSRP detection**: flags strikethrough list prices >70% above actual price.
- **Affiliate & tracking URL stripping**: removes `tag=`, `ref=`, `pd_rd_*`, `pf_rd_*`, `content-id`, etc.; canonicalizes `/dp/ASIN` links.
- **Brand filters**: hide Amazon in-house brands (Amazon Basics, Essentials, Solimo, Pinzon, Goodthreads, Wag, Mama Bear, Presto!, Ring, Blink, eero, Kindle, Fire TV, Echo, Happy Belly, Amazon Elements, Amazon Renewed, etc.); gibberish-brand heuristic (5–8 letter all-caps random names); user-defined regex blocklist.
- **Theming**: Catppuccin Mocha (default), AMOLED true-black, Light (Amazon native). Comfortable or Compact density. Anti-FOUC via `document_start` CSS + storage-driven flag attributes.
- **Popup settings UI**: 6 tabbed panels (Ads, Declutter, Reviews, Price, Brands, Theme). Live-broadcasts changes to all open Amazon tabs via background service worker — no reload.
- **Zero telemetry**: no network requests, no analytics, settings local only.
