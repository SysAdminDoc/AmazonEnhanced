# AmazonEnhanced — Working Notes

## Overview
Chrome MV3 extension for Amazon UX enhancement, ad/sponsor removal, local review-quality scoring, price-per-unit tools, Amazon-brand filtering, and theming. Single-purpose competitors are fragmented; AmazonEnhanced bundles them in one package with zero telemetry.

## Version: v1.0.0 (2026-04-14)

## Stack
- Pure Manifest V3 (service worker, no background page).
- No build tooling. Vanilla JS/CSS/HTML. Ship readable.
- ImageMagick (`magick`) for icon PNG rendering from `icon.svg`.

## Architecture
- **`manifest.json`** — 20 Amazon locale match patterns. Permissions: `storage`, `alarms`. Host permissions scoped to Amazon only.
- **`early-inject.js`** (document_start) — reads `chrome.storage.local['amzeSettings']` synchronously and sets `data-amze-theme`, `data-amze-density`, and per-feature `data-amze-<flag>` attrs on `<html>`. Anti-FOUC: `data-amze-ready="0"` keeps body opacity 0 until ready.
- **`theme.css`** (document_start) — Catppuccin Mocha + AMOLED + Light. All rules scoped by `html[data-amze-theme="..."]` and per-flag `html[data-amze-<flag>="1"]`. Declutter rules live here so toggling a flag activates/deactivates without reflow.
- **`content.js`** (document_end) — Runtime orchestrator:
  - Sponsored tile detection (selector + label text fallback)
  - Brand-based filter (Amazon-brand list + regex blocklist + gibberish heuristic)
  - Price-per-unit inference (title regex → canonical unit → per-unit badge)
  - List-price inflation warning (>70% MSRP gap)
  - Local review scoring heuristic (polarization, 1-star share, verified ratio)
  - Affiliate param stripper + `/dp/ASIN` canonicalization
  - MutationObserver (debounced 180ms) for infinite scroll
- **`background.js`** — seeds defaults, broadcasts settings from popup to all Amazon tabs.
- **`popup.html/css/js`** — 6-tab settings UI: Ads / Declutter / Reviews / Price / Brands / Theme. Changes persist to `chrome.storage.local` and broadcast live.

## Key paths
- `content.js:103` — DEFAULT_SETTINGS (source of truth; must match `background.js` + `popup.js`)
- `content.js:239` — UNIT_MAP (add new units here)
- `content.js:224` — AMAZON_BRANDS list
- `theme.css:240` — sponsored removal selectors (add new `data-cel-widget` patterns as Amazon rotates them)

## Gotchas
- `DEFAULT_SETTINGS` is duplicated in **three** files (`content.js`, `background.js`, `popup.js`). On any flag add/remove, update all three.
- Amazon rotates `data-cel-widget` / `cel_widget_id` values; when sponsored tiles start slipping through, inspect DOM and append new selectors to `theme.css` section 3 and `SPONSORED_SELECTORS` in `content.js`.
- `structuredClone` is used in `content.js` + `popup.js` — requires Chrome 98+ (fine for MV3 minimum).
- `data-amze-processed` is set on every tile. When settings change, `content.js` message handler clears this flag so tiles are re-evaluated.
- Locale number parsing: `parseNumber()` auto-detects US vs EU decimal by which of `.` or `,` appears last. Important for `.de`/`.fr`/`.es` price parsing.
- Anti-FOUC: `body { opacity: 0 }` only when `data-amze-ready="0"` AND theme is dark/amoled. Light theme doesn't hide body.
- **Never use `backdrop-filter: blur()`** in content-script CSS (global rule).
- MV3 service worker can be killed at any time; don't store state in `background.js` module scope except as cache; authoritative state lives in `chrome.storage.local`.

## Build & release
- No build. ZIP the directory (exclude `*.mhtml`, `*.zip`, `*.crx`, `*.pem`, `.git`):
  ```bash
  cd ~/repos/AmazonEnhanced
  zip -r AmazonEnhanced-v1.0.0.zip . -x "*.mhtml" "*.zip" "*.crx" "*.pem" ".git/*" "*.bak"
  ```
- CRX packing: reuse existing `.pem` (preserves extension ID). See global memory `chrome-extensions.md`.

## Reference MHTMLs (local only, not shipped)
`~/repos/AmazonEnhanced/` contains 4 Amazon page snapshots used to validate selectors:
- `Amazon.com. Spend less. Smile more..mhtml` — homepage
- `Amazon.com_ Treadmill ...Product Types.mhtml` — search/category results
- `Amazon.com Shopping Cart.mhtml` — cart page
- `Your Account.mhtml` — account page

## Status
- v1.0.0 shipped with 25 flags + 3 themes across 20 locales. Not yet tested in-browser end-to-end; first install will likely surface some Amazon selector drift needing small theme.css additions.
- Potential next work: price-history sparkline (needs local cache), seller-country lookup with cached DB, minimal-homepage mode (replace DOM vs just hide), review-filter shortcuts panel.
