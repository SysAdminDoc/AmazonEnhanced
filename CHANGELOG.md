# Changelog

## [1.1.2] - 2026-04-14

### Fixed
- **Persistent white backgrounds on cart, checkout, and PDP widgets.** Amazon inlines `style="background:#fff"` on dozens of elements with no distinctive class. Added:
  - Nuclear CSS attribute selectors that override any inline `background:#fff`, `background-color:#fff`, `background:white`, `rgb(255,...)`, legacy `bgcolor="#FFFFFF"`, etc.
  - Broader container coverage: `#a-page`, `#pageContent`, `#dp`, `#dp-container`, `#ppd`, `#imageBlock_feature_div`, `.a-container`, `.a-padding-*`, `.a-fixed-left-grid`, `.a-fixed-right-grid`.
  - Runtime JS sweep (`killWhiteBackgrounds`) that reads computed backgrounds on `.a-box`, `.a-section`, `.a-cardui`, `.a-container`, etc. and marks any with near-white backgrounds (`R,G,B >= 230`) with `data-amze-kw="1"` so theme.css forces them dark. Capped at 400 elements per sweep. Re-runs on DOM mutations.
- **Tile mode was nearly invisible:** increased padding from 4px to 10px, rounded corners from 6px to 10px, added a subtle border + shadow so the tile frame is actually visible around images.

### Note on image modes
If product images themselves still look white, switch the **Theme → Image dark-mode** picker away from `Tile` (the default — preserves color fidelity but doesn't darken the image content). Use `Dim` to soften, `Invert` to flip every image, or `Smart` to invert only images with white backgrounds (falls back to tile on CORS-tainted canvas).

## [1.1.1] - 2026-04-14

### Fixed
- **Lavender-card bug on homepage:** image-mode `tile` rules targeted `.a-dynamic-image` which Amazon also applies to container `<div>`s, causing huge light-grey rectangles on homepage feed cards. Scoped all image-mode selectors to `img.*` only (`img.a-dynamic-image`, `img.s-image`, `img.sc-product-image`).
- **Light Prime Visa promo strip and cart subtotal sidebar:** added coverage for `.a-cardui`, `.gw-card`, `[class*="FluidCard"]`, `#hlb-message`, `#hlb-subcart`, `#sw-subtotal`, `#sw-hsa-rcx-upsell`, `#sc-buy-box`, `.sc-subtotal`, `#rcx_container`, `.rcx-carousel-card`.
- **Unreadable text on hero cards:** Amazon sometimes inlines `color: #fff` for dark-over-image layouts; force readable `--amze-text` on card text while preserving `.a-price` and link coloring.

## [1.1.0] - 2026-04-14

### Added
- **Image dark-mode system** with five modes: `off`, `tile` (default), `dim`, `invert`, `smart`.
  - `tile` wraps product images in a soft light card — no color distortion.
  - `dim` applies `brightness(0.85) contrast(1.05)` to soften harsh whites.
  - `invert` applies Dark-Reader-style `invert(0.92) hue-rotate(180deg)` to every targeted image.
  - `smart` samples corner pixels of each image via canvas; inverts only images whose background is near-white. Gracefully falls back to tile if Amazon's CDN blocks canvas reads.
  - Segmented picker added to the Theme tab in the popup.
- Broader dark-theme coverage: search autocomplete dropdown, modals and popovers, account/orders pages, checkout page, cart tables, review cards, side refinement panels, price variant swatches, badges (Bestseller, Amazon's Choice), focus ring, text selection, horizontal rules.
- Star-rating filter preserves warm gold color on dark themes.

### Changed
- README and popup copy simplified; removed marketing phrasing.

## [1.0.0] - 2026-04-14

Initial release.

- Chrome MV3 extension targeting 20 Amazon locales.
- Sponsored/ad removal: search tiles, PDP carousels, banners, hero strips, video blocks, Prime upsell nags. Optional shade mode.
- 13 independent section-declutter toggles.
- Local review-quality scoring on product pages.
- Price-per-unit badges with locale-safe parsing.
- Suspicious-MSRP detection for strikethrough list prices >70% above actual.
- Amazon URL cleanup: strips `tag`, `ref_`, `pd_rd_*`, `pf_rd_*`; canonicalizes `/dp/ASIN`.
- Brand filters: Amazon in-house brand list, gibberish-brand heuristic, user regex blocklist.
- Themes: Catppuccin Mocha (default), AMOLED, Light. Comfortable/Compact density. Anti-FOUC.
- Popup with 6 tabs (Ads, Declutter, Reviews, Price, Brands, Theme). Live-broadcasts changes to all open Amazon tabs.
